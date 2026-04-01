export async function onRequest(context) {
  try {
    const url = new URL(context.request.url);
    const path = url.pathname.replace(/^\/api\/?/, '') || 'bootstrap';

    const env = context.env;
    const SHEET_ID = env.GOOGLE_SHEET_ID;
    const CLIENT_EMAIL = env.GOOGLE_CLIENT_EMAIL;
    const PRIVATE_KEY = env.GOOGLE_PRIVATE_KEY;

    if (!SHEET_ID || !CLIENT_EMAIL || !PRIVATE_KEY) {
      return json({ ok: false, error: 'Environment variables belum lengkap' }, 500);
    }

    const sheets = createSheetsClient({ SHEET_ID, CLIENT_EMAIL, PRIVATE_KEY });

    if (context.request.method === 'GET' && path === 'bootstrap') {
      const workbook = await readWorkbook(sheets);
      const data = buildBootstrapData(workbook);
      return json({ ok: true, data });
    }

    if (context.request.method === 'GET' && path === 'wa') {
      const workbook = await readWorkbook(sheets);
      const data = buildBootstrapData(workbook);
      const date = url.searchParams.get('date') || today();
      const drafts = buildWaDrafts(data.suppliers, data.products, data.txns, data.stock, date);
      return json({ ok: true, data: drafts });
    }

    if (context.request.method === 'POST' && path === 'save') {
      const body = await context.request.json();
      const action = body.action;
      const payload = body.payload || {};
      const workbook = await readWorkbook(sheets);

      switch (action) {
        case 'saveOpening':
          return await saveOpening(sheets, workbook, payload);

        case 'saveTransaction':
          return await saveTransaction(sheets, workbook, payload);

        case 'saveOpname':
          return await saveOpname(sheets, workbook, payload);

        case 'addSupplier':
          return await addSupplier(sheets, workbook, payload);

        case 'updateSupplier':
          return await updateSupplier(sheets, workbook, payload);

        case 'deleteSupplier':
          return await deleteSupplier(sheets, workbook, payload);

        case 'addProduct':
          return await addProduct(sheets, workbook, payload);

        case 'updateProduct':
          return await updateProduct(sheets, workbook, payload);

        case 'deleteProduct':
          return await deleteProduct(sheets, workbook, payload);

        default:
          return json({ ok: false, error: `Action tidak dikenali: ${action}` }, 400);
      }
    }

    return json({ ok: false, error: 'Route tidak ditemukan' }, 404);
  } catch (err) {
    return json({ ok: false, error: err.message || 'Unknown error' }, 500);
  }
}

/* =========================
   HELPERS
========================= */

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function normalizeKeyName(str) {
  return String(str || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');
}

function cleanValue(v) {
  return v == null ? '' : String(v).trim();
}

function numberValue(v) {
  const n = Number(v || 0);
  return Number.isFinite(n) ? n : 0;
}

function groupBy(arr, key) {
  return arr.reduce((acc, item) => {
    const k = item[key];
    if (!acc[k]) acc[k] = [];
    acc[k].push(item);
    return acc;
  }, {});
}

function colToLetter(col) {
  let temp = '';
  while (col > 0) {
    let rem = (col - 1) % 26;
    temp = String.fromCharCode(65 + rem) + temp;
    col = Math.floor((col - 1) / 26);
  }
  return temp;
}

function a1(sheetName, row, col) {
  return `${sheetName}!${colToLetter(col)}${row}`;
}

function nextId(prefix, rows, keyName) {
  const nums = rows
    .map((r) => String(r[keyName] || ''))
    .map((x) => {
      const m = x.match(/(\d+)$/);
      return m ? Number(m[1]) : 0;
    });
  const max = nums.length ? Math.max(...nums) : 0;
  return `${prefix}${String(max + 1).padStart(3, '0')}`;
}

function normalizePhone(raw) {
  let v = cleanValue(raw).replace(/[^\d]/g, '');
  if (!v) return '';
  if (v.startsWith('0')) v = '62' + v.slice(1);
  if (v.startsWith('8')) v = '62' + v;
  return v;
}

function ensureSheet(workbook, name) {
  if (!workbook[name]) {
    throw new Error(`Sheet ${name} tidak ditemukan`);
  }
  return workbook[name];
}

/* =========================
   GOOGLE SHEETS CLIENT
========================= */

function createSheetsClient({ SHEET_ID, CLIENT_EMAIL, PRIVATE_KEY }) {
  return {
    spreadsheetId: SHEET_ID,
    clientEmail: CLIENT_EMAIL,
    privateKey: PRIVATE_KEY,

    async accessToken() {
      return await getAccessToken(CLIENT_EMAIL, PRIVATE_KEY);
    },

    async valuesGet(range) {
      const token = await this.accessToken();
      const res = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}/values/${encodeURIComponent(range)}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || 'Gagal membaca sheet');
      return data.values || [];
    },

    async valuesAppend(range, values) {
      const token = await this.accessToken();
      const res = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ values }),
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || 'Gagal append sheet');
      return data;
    },

    async valuesBatchUpdate(dataRows) {
      const token = await this.accessToken();
      const res = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}/values:batchUpdate`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            valueInputOption: 'USER_ENTERED',
            data: dataRows,
          }),
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || 'Gagal update sheet');
      return data;
    },

    async batchClear(ranges) {
      const token = await this.accessToken();
      const res = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}/values:batchClear`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ ranges }),
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || 'Gagal clear sheet');
      return data;
    },
  };
}

async function getAccessToken(clientEmail, privateKey) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claimSet = {
    iss: clientEmail,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  };

  const enc = (obj) => base64UrlEncode(JSON.stringify(obj));
  const unsigned = `${enc(header)}.${enc(claimSet)}`;
  const signature = await signJwt(unsigned, privateKey);
  const jwt = `${unsigned}.${signature}`;

  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion: jwt,
  });

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || data.error || 'Gagal ambil access token');
  return data.access_token;
}

function base64UrlEncode(str) {
  return btoa(unescape(encodeURIComponent(str)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function base64UrlFromBuffer(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
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

async function signJwt(unsignedJwt, privateKeyPem) {
  const keyData = pemToArrayBuffer(privateKeyPem);
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    keyData,
    {
      name: 'RSASSA-PKCS1-v1_5',
      hash: 'SHA-256',
    },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    new TextEncoder().encode(unsignedJwt)
  );

  return base64UrlFromBuffer(signature);
}

/* =========================
   WORKBOOK READER
========================= */

async function readSheet(sheets, name) {
  const values = await sheets.valuesGet(name);
  const headers = (values[0] || []).map((x) => normalizeKeyName(x));
  const rows = (values.slice(1) || []).map((row) => {
    const obj = {};
    headers.forEach((h, i) => {
      obj[h] = row[i] ?? '';
    });
    return obj;
  });
  return { headers, rows, raw: values };
}

async function readWorkbook(sheets) {
  const names = [
    'SUPPLIER_MASTER',
    'PRODUK_MASTER',
    'STOK_AWAL',
    'TRANSAKSI_STOK',
    'OPNAME_FISIK',
  ];

  const workbook = {};
  for (const name of names) {
    workbook[name] = await readSheet(sheets, name);
  }
  return workbook;
}

/* =========================
   BOOTSTRAP
========================= */

function buildBootstrapData(workbook) {
  const supplierSheet = ensureSheet(workbook, 'SUPPLIER_MASTER');
  const productSheet = ensureSheet(workbook, 'PRODUK_MASTER');
  const openingSheet = ensureSheet(workbook, 'STOK_AWAL');
  const txnSheet = ensureSheet(workbook, 'TRANSAKSI_STOK');
  const opnameSheet = ensureSheet(workbook, 'OPNAME_FISIK');

  const suppliers = supplierSheet.rows.map((r) => ({
    supplier_id: r.supplier_id || '',
    nama_supplier: r.nama_supplier || '',
    no_wa: r.no_wa || '',
    aktif: (r.aktif || 'YA').toUpperCase(),
  }));

  const products = productSheet.rows.map((r) => {
    const supplier = suppliers.find((s) => s.supplier_id === r.supplier_id);
    return {
      product_id: r.product_id || '',
      supplier_id: r.supplier_id || '',
      nama_supplier: supplier?.nama_supplier || '',
      nama_produk: r.nama_produk || '',
      aktif: (r.aktif || 'YA').toUpperCase(),
    };
  });

  const openings = openingSheet.rows.map((r) => ({
    tanggal: r.tanggal || '',
    supplier_id: r.supplier_id || '',
    product_id: r.product_id || '',
    qty: numberValue(r.qty),
    user_input: r.user_input || '',
  }));

  const txns = txnSheet.rows.map((r) => ({
    Tanggal_Input: r.tanggal || '',
    Supplier_ID: r.supplier_id || '',
    Product_ID: r.product_id || '',
    Jenis: (r.jenis || '').toUpperCase(),
    Qty: numberValue(r.qty),
    Keterangan: r.keterangan || '',
    User_Input: r.user_input || '',
    Nama_Produk: products.find((p) => p.product_id === r.product_id)?.nama_produk || '',
  }));

  const opnames = opnameSheet.rows.map((r) => ({
    tanggal: r.tanggal || '',
    supplier_id: r.supplier_id || '',
    product_id: r.product_id || '',
    qty_fisik: numberValue(r.qty_fisik),
    user_input: r.user_input || '',
  }));

  const latestOpeningMap = {};
  for (const row of openings) {
    latestOpeningMap[row.product_id] = row;
  }

  const latestOpnameMap = {};
  for (const row of opnames) {
    latestOpnameMap[row.product_id] = row;
  }

  const stock = products.map((p) => {
    const stok_awal = numberValue(latestOpeningMap[p.product_id]?.qty || 0);

    const in_qty = txns
      .filter((x) => x.Product_ID === p.product_id && x.Jenis === 'IN')
      .reduce((a, b) => a + numberValue(b.Qty), 0);

    const out_qty = txns
      .filter((x) => x.Product_ID === p.product_id && x.Jenis === 'OUT')
      .reduce((a, b) => a + numberValue(b.Qty), 0);

    const reject_qty = txns
      .filter((x) => x.Product_ID === p.product_id && x.Jenis === 'REJECT')
      .reduce((a, b) => a + numberValue(b.Qty), 0);

    const expired_qty = txns
      .filter((x) => x.Product_ID === p.product_id && x.Jenis === 'EXPIRED')
      .reduce((a, b) => a + numberValue(b.Qty), 0);

    const stok_sistem = stok_awal + in_qty - out_qty - reject_qty - expired_qty;
    const qty_fisik = latestOpnameMap[p.product_id]?.qty_fisik ?? '';
    const selisih = qty_fisik === '' ? '' : numberValue(qty_fisik) - stok_sistem;

    let status = 'AMAN';
    if (stok_sistem <= 0) status = 'HABIS';
    else if (stok_sistem <= 3) status = 'MENIPIS';
    if (qty_fisik !== '' && selisih !== 0) status = 'SELISIH';

    return {
      product_id: p.product_id,
      supplier_id: p.supplier_id,
      nama_supplier: p.nama_supplier,
      nama_produk: p.nama_produk,
      stok_awal,
      in_qty,
      out_qty,
      reject_qty,
      expired_qty,
      stok_sistem,
      qty_fisik,
      selisih,
      status,
    };
  });

  return {
    suppliers,
    products,
    openings,
    txns,
    opnames,
    stock,
  };
}

/* =========================
   WA DRAFT
========================= */

function buildWaDrafts(suppliers, products, txns, stock, date) {
  const txnsToday = txns.filter((x) => `${x.Tanggal_Input}` === date);
  const bySupplier = groupBy(txnsToday, 'Supplier_ID');

  return suppliers
    .filter((supplier) => supplier.aktif === 'YA')
    .map((supplier) => {
      const rows = bySupplier[supplier.supplier_id] || [];
      if (!rows.length) return null;

      const productSummary = {};

      rows.forEach((row) => {
        const product = products.find((p) => p.product_id === row.Product_ID);
        const stockInfo = stock.find((s) => s.product_id === row.Product_ID) || {};

        if (!productSummary[row.Product_ID]) {
          const masukHariIni = rows
            .filter((r) => r.Product_ID === row.Product_ID && `${r.Jenis || ''}`.toUpperCase() === 'IN')
            .reduce((a, b) => a + Number(b.Qty || 0), 0);

          const keluarHariIni = rows
            .filter((r) => r.Product_ID === row.Product_ID && `${r.Jenis || ''}`.toUpperCase() === 'OUT')
            .reduce((a, b) => a + Number(b.Qty || 0), 0);

          const rejectHariIni = rows
            .filter((r) => r.Product_ID === row.Product_ID && `${r.Jenis || ''}`.toUpperCase() === 'REJECT')
            .reduce((a, b) => a + Number(b.Qty || 0), 0);

          const expiredHariIni = rows
            .filter((r) => r.Product_ID === row.Product_ID && `${r.Jenis || ''}`.toUpperCase() === 'EXPIRED')
            .reduce((a, b) => a + Number(b.Qty || 0), 0);

          const stokAwal = Number(stockInfo.stok_awal || 0);
          const sisaStokSekarang =
            stokAwal + masukHariIni - keluarHariIni - rejectHariIni - expiredHariIni;

          productSummary[row.Product_ID] = {
            nama_produk: product?.nama_produk || row.Nama_Produk || '-',
            stok_awal: stokAwal,
            masuk_hari_ini: masukHariIni,
            keluar_hari_ini: keluarHariIni,
            reject_hari_ini: rejectHariIni,
            expired_hari_ini: expiredHariIni,
            sisa_stok_sekarang: sisaStokSekarang,
          };
        }
      });

      const lines = Object.values(productSummary).map((item) =>
        [
          `- ${item.nama_produk}`,
          `  Stok awal: ${item.stok_awal}`,
          `  Masuk hari ini: ${item.masuk_hari_ini}`,
          `  Keluar hari ini: ${item.keluar_hari_ini}`,
          `  Reject hari ini: ${item.reject_hari_ini}`,
          `  Expired hari ini: ${item.expired_hari_ini}`,
          `  Sisa stok sekarang: ${item.sisa_stok_sekarang}`,
        ].join('\n')
      );

      const pesan =
        `Halo ${supplier.nama_supplier},\n\n` +
        `Laporan stok tanggal ${date}:\n\n` +
        `${lines.join('\n\n')}\n\n` +
        `Terima kasih.`;

      const wa = normalizePhone(supplier.no_wa);

      return {
        supplier_id: supplier.supplier_id,
        nama_supplier: supplier.nama_supplier,
        no_wa: wa,
        pesan,
        link_wa: wa
          ? `https://wa.me/${wa}?text=${encodeURIComponent(pesan)}`
          : '#',
      };
    })
    .filter(Boolean);
}

/* =========================
   ACTIONS
========================= */

async function saveOpening(sheets, workbook, payload) {
  const sheet = ensureSheet(workbook, 'STOK_AWAL');
  const tanggal = cleanValue(payload.tanggal);
  const supplier_id = cleanValue(payload.supplier_id);
  const product_id = cleanValue(payload.product_id);
  const qty = numberValue(payload.qty);
  const user_input = cleanValue(payload.user_input);

  if (!tanggal || !supplier_id || !product_id) {
    return json({ ok: false, error: 'Data stok awal belum lengkap' }, 400);
  }

  const existingIndex = sheet.rows.findIndex((r) => String(r.product_id) === product_id);

  if (existingIndex >= 0) {
    const rowNumber = existingIndex + 2;
    const updates = [
      { range: a1('STOK_AWAL', rowNumber, 1), values: [[tanggal]] },
      { range: a1('STOK_AWAL', rowNumber, 2), values: [[supplier_id]] },
      { range: a1('STOK_AWAL', rowNumber, 3), values: [[product_id]] },
      { range: a1('STOK_AWAL', rowNumber, 4), values: [[qty]] },
      { range: a1('STOK_AWAL', rowNumber, 5), values: [[user_input]] },
    ];
    await sheets.valuesBatchUpdate(updates);
    return json({ ok: true, message: 'Stok awal diperbarui' });
  }

  await sheets.valuesAppend('STOK_AWAL', [[tanggal, supplier_id, product_id, qty, user_input]]);
  return json({ ok: true, message: 'Stok awal disimpan' });
}

async function saveTransaction(sheets, workbook, payload) {
  const tanggal = cleanValue(payload.tanggal);
  const supplier_id = cleanValue(payload.supplier_id);
  const product_id = cleanValue(payload.product_id);
  const jenis = cleanValue(payload.jenis).toUpperCase();
  const qty = numberValue(payload.qty);
  const keterangan = cleanValue(payload.keterangan);
  const user_input = cleanValue(payload.user_input);

  if (!tanggal || !supplier_id || !product_id || !jenis) {
    return json({ ok: false, error: 'Data transaksi belum lengkap' }, 400);
  }

  await sheets.valuesAppend('TRANSAKSI_STOK', [[tanggal, supplier_id, product_id, jenis, qty, keterangan, user_input]]);
  return json({ ok: true, message: 'Transaksi disimpan' });
}

async function saveOpname(sheets, workbook, payload) {
  const sheet = ensureSheet(workbook, 'OPNAME_FISIK');
  const tanggal = cleanValue(payload.tanggal);
  const supplier_id = cleanValue(payload.supplier_id);
  const product_id = cleanValue(payload.product_id);
  const qty_fisik = numberValue(payload.qty_fisik);
  const user_input = cleanValue(payload.user_input);

  if (!tanggal || !supplier_id || !product_id) {
    return json({ ok: false, error: 'Data opname belum lengkap' }, 400);
  }

  const existingIndex = sheet.rows.findIndex((r) => String(r.product_id) === product_id);

  if (existingIndex >= 0) {
    const rowNumber = existingIndex + 2;
    const updates = [
      { range: a1('OPNAME_FISIK', rowNumber, 1), values: [[tanggal]] },
      { range: a1('OPNAME_FISIK', rowNumber, 2), values: [[supplier_id]] },
      { range: a1('OPNAME_FISIK', rowNumber, 3), values: [[product_id]] },
      { range: a1('OPNAME_FISIK', rowNumber, 4), values: [[qty_fisik]] },
      { range: a1('OPNAME_FISIK', rowNumber, 5), values: [[user_input]] },
    ];
    await sheets.valuesBatchUpdate(updates);
    return json({ ok: true, message: 'Opname diperbarui' });
  }

  await sheets.valuesAppend('OPNAME_FISIK', [[tanggal, supplier_id, product_id, qty_fisik, user_input]]);
  return json({ ok: true, message: 'Opname disimpan' });
}

async function addSupplier(sheets, workbook, payload) {
  const supplierSheet = ensureSheet(workbook, 'SUPPLIER_MASTER');
  const nama_supplier = cleanValue(payload.nama_supplier);
  const no_wa = normalizePhone(payload.no_wa);
  const aktif = 'YA';

  if (!nama_supplier) {
    return json({ ok: false, error: 'Nama supplier wajib diisi' }, 400);
  }

  const supplier_id = nextId('SUP-', supplierSheet.rows, 'supplier_id');
  await sheets.valuesAppend('SUPPLIER_MASTER', [[supplier_id, nama_supplier, no_wa, aktif]]);
  return json({ ok: true, message: 'Supplier ditambahkan' });
}

async function updateSupplier(sheets, workbook, payload) {
  const supplierSheet = ensureSheet(workbook, 'SUPPLIER_MASTER');
  const supplier_id = cleanValue(payload.supplier_id);
  const nama_supplier = cleanValue(payload.nama_supplier);
  const no_wa = normalizePhone(payload.no_wa);
  const aktif = cleanValue(payload.aktif || 'YA').toUpperCase();

  const idx = supplierSheet.rows.findIndex((r) => String(r.supplier_id) === supplier_id);
  if (idx === -1) return json({ ok: false, error: 'Supplier tidak ditemukan' }, 404);

  const rowNumber = idx + 2;
  const updates = [
    { range: a1('SUPPLIER_MASTER', rowNumber, 1), values: [[supplier_id]] },
    { range: a1('SUPPLIER_MASTER', rowNumber, 2), values: [[nama_supplier]] },
    { range: a1('SUPPLIER_MASTER', rowNumber, 3), values: [[no_wa]] },
    { range: a1('SUPPLIER_MASTER', rowNumber, 4), values: [[aktif]] },
  ];

  await sheets.valuesBatchUpdate(updates);
  return json({ ok: true, message: 'Supplier berhasil diperbarui' });
}

async function deleteSupplier(sheets, workbook, payload) {
  const supplier_id = cleanValue(payload.supplier_id);
  const productSheet = ensureSheet(workbook, 'PRODUK_MASTER');
  const supplierSheet = ensureSheet(workbook, 'SUPPLIER_MASTER');

  const hasActiveProducts = productSheet.rows.some(
    (r) => String(r.supplier_id) === supplier_id && String(r.aktif || 'YA').toUpperCase() === 'YA'
  );

  if (hasActiveProducts) {
    return json({ ok: false, error: 'Supplier masih punya produk aktif. Nonaktifkan / hapus produknya dulu.' }, 400);
  }

  const idx = supplierSheet.rows.findIndex((r) => String(r.supplier_id) === supplier_id);
  if (idx === -1) return json({ ok: false, error: 'Supplier tidak ditemukan' }, 404);

  const rowNumber = idx + 2;

  await sheets.valuesBatchUpdate([
    { range: a1('SUPPLIER_MASTER', rowNumber, 2), values: [['[DELETED]']] },
    { range: a1('SUPPLIER_MASTER', rowNumber, 3), values: [['']] },
    { range: a1('SUPPLIER_MASTER', rowNumber, 4), values: [['TIDAK']] },
  ]);

  return json({ ok: true, message: 'Supplier dinonaktifkan / dihapus' });
}

async function addProduct(sheets, workbook, payload) {
  const productSheet = ensureSheet(workbook, 'PRODUK_MASTER');
  const supplierSheet = ensureSheet(workbook, 'SUPPLIER_MASTER');

  const supplier_id = cleanValue(payload.supplier_id);
  const nama_produk = cleanValue(payload.nama_produk);
  const aktif = 'YA';

  if (!supplier_id || !nama_produk) {
    return json({ ok: false, error: 'Supplier dan nama produk wajib diisi' }, 400);
  }

  const supplier = supplierSheet.rows.find((r) => String(r.supplier_id) === supplier_id);
  if (!supplier) {
    return json({ ok: false, error: 'Supplier tidak ditemukan' }, 404);
  }

  const product_id = nextId('PRD-', productSheet.rows, 'product_id');
  await sheets.valuesAppend('PRODUK_MASTER', [[product_id, supplier_id, nama_produk, aktif]]);
  return json({ ok: true, message: 'Produk ditambahkan' });
}

async function updateProduct(sheets, workbook, payload) {
  const productSheet = ensureSheet(workbook, 'PRODUK_MASTER');
  const product_id = cleanValue(payload.product_id);
  const supplier_id = cleanValue(payload.supplier_id);
  const nama_produk = cleanValue(payload.nama_produk);
  const aktif = cleanValue(payload.aktif || 'YA').toUpperCase();

  const idx = productSheet.rows.findIndex((r) => String(r.product_id) === product_id);
  if (idx === -1) return json({ ok: false, error: 'Produk tidak ditemukan' }, 404);

  const rowNumber = idx + 2;
  const updates = [
    { range: a1('PRODUK_MASTER', rowNumber, 1), values: [[product_id]] },
    { range: a1('PRODUK_MASTER', rowNumber, 2), values: [[supplier_id]] },
    { range: a1('PRODUK_MASTER', rowNumber, 3), values: [[nama_produk]] },
    { range: a1('PRODUK_MASTER', rowNumber, 4), values: [[aktif]] },
  ];

  await sheets.valuesBatchUpdate(updates);
  return json({ ok: true, message: 'Produk berhasil diperbarui' });
}

async function deleteProduct(sheets, workbook, payload) {
  const product_id = cleanValue(payload.product_id);
  const data = buildBootstrapData(workbook);
  const stockInfo = data.stock.find((x) => x.product_id === product_id);

  if (stockInfo && numberValue(stockInfo.stok_sistem) > 0) {
    return json({ ok: false, error: 'Produk masih punya stok. Kosongkan dulu sebelum hapus.' }, 400);
  }

  const productSheet = ensureSheet(workbook, 'PRODUK_MASTER');
  const idx = productSheet.rows.findIndex((r) => String(r.product_id) === product_id);
  if (idx === -1) return json({ ok: false, error: 'Produk tidak ditemukan' }, 404);

  const rowNumber = idx + 2;

  await sheets.valuesBatchUpdate([
    { range: a1('PRODUK_MASTER', rowNumber, 3), values: [['[DELETED]']] },
    { range: a1('PRODUK_MASTER', rowNumber, 4), values: [['TIDAK']] },
  ]);

  return json({ ok: true, message: 'Produk dihapus / dinonaktifkan' });
}
