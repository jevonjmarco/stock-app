const SHEETS = {
  suppliers: 'SUPPLIER_MASTER',
  products: 'PRODUK_MASTER',
  opening: 'STOK_AWAL',
  txn: 'TRANSAKSI_STOK',
  opname: 'OPNAME_FISIK',
  wa: 'WA_DRAFT',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

function base64Url(bytes) {
  let string = btoa(String.fromCharCode(...new Uint8Array(bytes)));
  return string.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function pemToArrayBuffer(pem) {
  const normalized = String(pem)
    .trim()
    .replace(/^"|"$/g, '')
    .replace(/\\n/g, '\n');

  const clean = normalized
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\s+/g, '');

  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function getAccessToken(env) {
  const header = { alg: 'RS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const claim = {
    iss: env.GOOGLE_CLIENT_EMAIL,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  };
  const enc = new TextEncoder();
  const unsigned = `${base64Url(enc.encode(JSON.stringify(header)))}.${base64Url(enc.encode(JSON.stringify(claim)))}`;
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToArrayBuffer(env.GOOGLE_PRIVATE_KEY),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, enc.encode(unsigned));
  const jwt = `${unsigned}.${base64Url(signature)}`;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || 'Gagal membuat access token Google');
  return data.access_token;
}

async function gsFetch(env, path, options = {}) {
  const token = await getAccessToken(env);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${env.GOOGLE_SHEET_ID}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || 'Google Sheets API error');
  return data;
}

async function getRange(env, range) {
  const data = await gsFetch(env, `/values/${encodeURIComponent(range)}`);
  return data.values || [];
}

async function appendRow(env, range, row) {
  return gsFetch(env, `/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`, {
    method: 'POST',
    body: JSON.stringify({ values: [row] }),
  });
}

function rowsToObjects(rows) {
  const [header, ...data] = rows;
  if (!header) return [];
  return data.filter((row) => row.some((x) => x !== '')).map((row) => {
    const obj = {};
    header.forEach((key, idx) => { obj[key] = row[idx] ?? ''; });
    return obj;
  });
}

function groupBy(array, key) {
  return array.reduce((acc, item) => {
    const group = item[key];
    if (!acc[group]) acc[group] = [];
    acc[group].push(item);
    return acc;
  }, {});
}

function computeStock(products, openings, txns, opnames) {
  const latestOpname = {};
  opnames.forEach((row) => {
    const current = latestOpname[row.Product_ID];
    if (!current || `${row.Tanggal_Input}` >= `${current.Tanggal_Input}`) latestOpname[row.Product_ID] = row;
  });

  return products.map((product) => {
    const productId = product.Product_ID;
    const opening = openings
      .filter((x) => x.Product_ID === productId)
      .reduce((sum, x) => sum + Number(x.Qty_Awal || 0), 0);
    const sums = { IN: 0, OUT: 0, REJECT: 0, EXPIRED: 0 };
    txns.filter((x) => x.Product_ID === productId).forEach((x) => {
      const type = `${x.Jenis || ''}`.toUpperCase();
      if (sums[type] !== undefined) sums[type] += Number(x.Qty || 0);
    });
    const stok = opening + sums.IN - sums.OUT - sums.REJECT - sums.EXPIRED;
    const lastOp = latestOpname[productId];
    const qtyFisik = lastOp ? Number(lastOp.Qty_Fisik || 0) : null;
    const selisih = qtyFisik === null ? null : qtyFisik - stok;
    let status = stok <= 0 ? 'HABIS' : stok <= 3 ? 'MENIPIS' : 'AMAN';
    if (selisih !== null && selisih !== 0) status = 'SELISIH';
    return {
      product_id: productId,
      supplier_id: product.Supplier_ID,
      nama_supplier: product.Nama_Supplier,
      nama_produk: product.Nama_Produk,
      stok_awal: opening,
      in_qty: sums.IN,
      out_qty: sums.OUT,
      reject_qty: sums.REJECT,
      expired_qty: sums.EXPIRED,
      stok_sistem: stok,
      qty_fisik: qtyFisik,
      selisih,
      status,
    };
  });
}

function buildWaDrafts(suppliers, products, txns, date) {
  const bySupplier = groupBy(txns.filter((x) => `${x.Tanggal_Input}` === date), 'Supplier_ID');
  return suppliers
    .filter((supplier) => supplier.Aktif === 'YA')
    .map((supplier) => {
      const rows = bySupplier[supplier.Supplier_ID] || [];
      const items = { OUT: [], REJECT: [], EXPIRED: [] };
      rows.forEach((row) => {
        const type = `${row.Jenis}`.toUpperCase();
        if (!items[type]) return;
        const product = products.find((p) => p.Product_ID === row.Product_ID);
        items[type].push(`- ${product?.Nama_Produk || row.Nama_Produk}: ${row.Qty}`);
      });
      if (!items.OUT.length && !items.REJECT.length && !items.EXPIRED.length) return null;
      const sections = [];
      if (items.OUT.length) sections.push(`OUT\n${items.OUT.join('\n')}`);
      if (items.REJECT.length) sections.push(`REJECT\n${items.REJECT.join('\n')}`);
      if (items.EXPIRED.length) sections.push(`EXPIRED\n${items.EXPIRED.join('\n')}`);
      const pesan = `Halo ${supplier.Nama_Supplier},\n\nLaporan stok tanggal ${date}:\n\n${sections.join('\n\n')}\n\nTerima kasih.`;
      return {
        supplier_id: supplier.Supplier_ID,
        nama_supplier: supplier.Nama_Supplier,
        no_wa: supplier.No_WA,
        pesan,
        link_wa: supplier.No_WA ? `https://wa.me/${supplier.No_WA}?text=${encodeURIComponent(pesan)}` : '#',
      };
    })
    .filter(Boolean);
}

async function getAllData(env) {
  const [supplierRows, productRows, openingRows, txnRows, opnameRows] = await Promise.all([
    getRange(env, `${SHEETS.suppliers}!A1:D1000`),
    getRange(env, `${SHEETS.products}!A1:E2000`),
    getRange(env, `${SHEETS.opening}!A1:H5000`),
    getRange(env, `${SHEETS.txn}!A1:I5000`),
    getRange(env, `${SHEETS.opname}!A1:H5000`),
  ]);
  const suppliers = rowsToObjects(supplierRows);
  const products = rowsToObjects(productRows);
  const openings = rowsToObjects(openingRows);
  const txns = rowsToObjects(txnRows);
  const opnames = rowsToObjects(opnameRows);
  const stock = computeStock(products, openings, txns, opnames);
  return { suppliers, products, openings, txns, opnames, stock };
}

function nextSupplierId(suppliers) {
  const max = suppliers.reduce((m, s) => Math.max(m, Number((s.Supplier_ID || 'SUP-000').split('-')[1] || 0)), 0);
  return `SUP-${String(max + 1).padStart(3, '0')}`;
}

function nextProductId(products) {
  const max = products.reduce((m, s) => Math.max(m, Number((s.Product_ID || 'PRD-000').split('-')[1] || 0)), 0);
  return `PRD-${String(max + 1).padStart(3, '0')}`;
}

export async function onRequest(context) {
  try {
    const { request, env, params } = context;
    if (!env.GOOGLE_CLIENT_EMAIL || !env.GOOGLE_PRIVATE_KEY || !env.GOOGLE_SHEET_ID) {
      return json({ ok: false, error: 'Secrets Google belum diisi di Cloudflare Pages.' }, 500);
    }

    const path = (params.path || []).join('/');

    if (request.method === 'GET' && path === 'bootstrap') {
      const data = await getAllData(env);
      return json({ ok: true, data: {
        suppliers: data.suppliers.map((x) => ({
          supplier_id: x.Supplier_ID, nama_supplier: x.Nama_Supplier, no_wa: x.No_WA, aktif: x.Aktif,
        })),
        products: data.products.map((x) => ({
          product_id: x.Product_ID, supplier_id: x.Supplier_ID, nama_supplier: x.Nama_Supplier, nama_produk: x.Nama_Produk, aktif: x.Aktif,
        })),
        stock: data.stock,
      }});
    }

    if (request.method === 'GET' && path === 'wa') {
      const url = new URL(request.url);
      const date = url.searchParams.get('date');
      if (!date) return json({ ok: false, error: 'Tanggal wajib diisi' }, 400);
      const data = await getAllData(env);
      const drafts = buildWaDrafts(data.suppliers, data.products, data.txns, date);
      return json({ ok: true, data: drafts });
    }

    if (request.method === 'POST' && path === 'save') {
      const body = await request.json();
      const { action, payload } = body;
      const data = await getAllData(env);
      if (action === 'addSupplier') {
        const id = nextSupplierId(data.suppliers);
        await appendRow(env, `${SHEETS.suppliers}!A:D`, [id, payload.nama_supplier, payload.no_wa || '', payload.aktif || 'YA']);
        return json({ ok: true, message: 'Supplier ditambahkan' });
      }
      if (action === 'addProduct') {
        const supplier = data.suppliers.find((x) => x.Supplier_ID === payload.supplier_id);
        if (!supplier) return json({ ok: false, error: 'Supplier tidak ditemukan' }, 400);
        const id = nextProductId(data.products);
        await appendRow(env, `${SHEETS.products}!A:E`, [id, payload.supplier_id, supplier.Nama_Supplier, payload.nama_produk, payload.aktif || 'YA']);
        return json({ ok: true, message: 'Produk ditambahkan' });
      }
      if (action === 'saveOpening') {
        const product = data.products.find((x) => x.Product_ID === payload.product_id);
        await appendRow(env, `${SHEETS.opening}!A:H`, [payload.tanggal, payload.product_id, product.Supplier_ID, product.Nama_Supplier, product.Nama_Produk, Number(payload.qty || 0), payload.catatan || '', payload.user_input || '']);
        return json({ ok: true, message: 'Stok awal tersimpan' });
      }
      if (action === 'saveTransaction') {
        const product = data.products.find((x) => x.Product_ID === payload.product_id);
        await appendRow(env, `${SHEETS.txn}!A:I`, [payload.tanggal, payload.product_id, product.Supplier_ID, product.Nama_Supplier, product.Nama_Produk, payload.jenis, Number(payload.qty || 0), payload.catatan || '', payload.user_input || '']);
        return json({ ok: true, message: 'Transaksi tersimpan' });
      }
      if (action === 'saveOpname') {
        const product = data.products.find((x) => x.Product_ID === payload.product_id);
        await appendRow(env, `${SHEETS.opname}!A:H`, [payload.tanggal, payload.product_id, product.Supplier_ID, product.Nama_Supplier, product.Nama_Produk, Number(payload.qty_fisik || 0), payload.catatan || '', payload.user_input || '']);
        return json({ ok: true, message: 'Opname tersimpan' });
      }
      return json({ ok: false, error: 'Action tidak dikenal' }, 400);
    }

    return json({ ok: false, error: 'Route tidak ditemukan' }, 404);
  } catch (error) {
    return json({ ok: false, error: error.message || 'Server error' }, 500);
  }
}
