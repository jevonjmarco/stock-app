export async function onRequest(context: any) {
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

    if (context.request.method === 'GET' && path === 'cekversi') {
      return json({ ok: true, version: 'HEADER-SAFE-PRODUK-HPP-2026-04-05' });
    }

    if (context.request.method === 'GET' && path === 'bootstrap') {
      const workbook = await readWorkbook(sheets);
      return json({ ok: true, data: buildBootstrapData(workbook) });
    }

    if (context.request.method === 'GET' && path === 'debugwa') {
      const workbook = await readWorkbook(sheets);
      const data = buildBootstrapData(workbook);
      const date = url.searchParams.get('date') || today();

      const normalizeDate = (v: any) => String(v || '').trim().slice(0, 10);
      const cleanId = (v: any) => String(v || '').trim();

      const txnsToday = data.txns.filter((x: any) => normalizeDate(x.Tanggal_Input) === normalizeDate(date));

      const mapped = txnsToday.map((row: any) => {
        const product = data.products.find((p: any) => cleanId(p.product_id) === cleanId(row.Product_ID));
        return {
          tanggal: row.Tanggal_Input,
          product_id: row.Product_ID,
          supplier_id_transaksi: row.Supplier_ID,
          supplier_id_produk: product?.supplier_id || '',
          supplier_final: cleanId(row.Supplier_ID) || cleanId(product?.supplier_id) || '',
          jenis: row.Jenis,
          qty: row.Qty,
          nama_supplier: row.Nama_Supplier,
          nama_produk: row.Nama_Produk,
          catatan: row.Catatan,
          user_input: row.User_Input,
        };
      });

      return json({
        ok: true,
        date,
        total_txns_today: txnsToday.length,
        mapped,
      });
    }

    if (context.request.method === 'GET' && path === 'wa') {
      const workbook = await readWorkbook(sheets);
      const data = buildBootstrapData(workbook);
      const date = url.searchParams.get('date') || today();
      return json({ ok: true, data: buildWaDrafts(data.suppliers, data.products, data.txns, data.stock, date) });
    }

    if (context.request.method === 'GET' && path === 'weekly') {
      const workbook = await readWorkbook(sheets);
      const data = buildBootstrapData(workbook);
      const start = url.searchParams.get('start') || today();
      const end = url.searchParams.get('end') || today();
      return json({ ok: true, data: buildWeeklyDrafts(data.suppliers, data.products, data.txns, start, end) });
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
  } catch (err: any) {
    return json({ ok: false, error: err.message || 'Unknown error' }, 500);
  }
}

function json(data: any, status = 200) {
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

function cleanValue(v: any) {
  return v == null ? '' : String(v).trim();
}

function numberValue(v: any) {
  const n = Number(v || 0);
  return Number.isFinite(n) ? n : 0;
}

function numberFormat(n: any) {
  return new Intl.NumberFormat('id-ID').format(Number(n || 0));
}

function groupBy(arr: any[], key: string) {
  return arr.reduce((acc: any, item: any) => {
    const k = item[key];
    if (!acc[k]) acc[k] = [];
    acc[k].push(item);
    return acc;
  }, {});
}

function colToLetter(col: number) {
  let temp = '';
  while (col > 0) {
    const rem = (col - 1) % 26;
    temp = String.fromCharCode(65 + rem) + temp;
    col = Math.floor((col - 1) / 26);
  }
  return temp;
}

function a1(sheetName: string, row: number, col: number) {
  return `${sheetName}!${colToLetter(col)}${row}`;
}

function nextId(prefix: string, rows: any[], keyName: string) {
  const nums = rows
    .map((r) => String(r[keyName] || ''))
    .map((x) => {
      const m = x.match(/(\d+)$/);
      return m ? Number(m[1]) : 0;
    });
  const max = nums.length ? Math.max(...nums) : 0;
  return `${prefix}${String(max + 1).padStart(3, '0')}`;
}

function normalizePhone(raw: any) {
  let v = cleanValue(raw).replace(/[^\d]/g, '');
  if (!v) return '';
  if (v.startsWith('0')) v = '62' + v.slice(1);
  if (v.startsWith('8')) v = '62' + v;
  return v;
}

function ensureSheet(workbook: any, name: string) {
  if (!workbook[name]) throw new Error(`Sheet ${name} tidak ditemukan`);
  return workbook[name];
}

function getHeaderIndexMap(headers: string[]) {
  const map: any = {};
  headers.forEach((h, i) => {
    map[String(h || '').trim().toLowerCase()] = i + 1;
  });
  return map;
}

function requireHeaderCol(sheet: any, headerName: string) {
  const map = getHeaderIndexMap(sheet.headers || []);
  const col = map[headerName.toLowerCase()];
  if (!col) throw new Error(`Header "${headerName}" tidak ditemukan di sheet`);
  return col;
}

function buildRowByHeaders(headers: string[], valuesMap: Record<string, any>) {
  return headers.map((h) => {
    const key = String(h || '').trim().toLowerCase();
    return valuesMap[key] ?? '';
  });
}

function cleanId(v: any) {
  return String(v || '').trim();
}

function normalizeDate(v: any) {
  return String(v || '').trim().slice(0, 10);
}

function createSheetsClient({ SHEET_ID, CLIENT_EMAIL, PRIVATE_KEY }: any) {
  return {
    spreadsheetId: SHEET_ID,
    clientEmail: CLIENT_EMAIL,
    privateKey: PRIVATE_KEY,

    async accessToken() {
      return await getAccessToken(CLIENT_EMAIL, PRIVATE_KEY);
    },

    async valuesGet(range: string) {
      const token = await this.accessToken();
      const res = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}/values/${encodeURIComponent(range)}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || 'Gagal membaca sheet');
      return data.values || [];
    },

    async valuesAppend(range: string, values: any[][]) {
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

    async valuesBatchUpdate(dataRows: any[]) {
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
  };
}

async function getAccessToken(clientEmail: string, privateKey: string) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claimSet = {
    iss: clientEmail,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  };

  const enc = (obj: any) => base64UrlEncode(JSON.stringify(obj));
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

function base64UrlEncode(str: string) {
  return btoa(unescape(encodeURIComponent(str)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function base64UrlFromBuffer(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function pemToArrayBuffer(pem: string) {
  const normalized = String(pem).trim().replace(/^"|"$/g, '').replace(/\\n/g, '\n');
  const clean = normalized
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\s+/g, '');
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function signJwt(unsignedJwt: string, privateKeyPem: string) {
  const keyData = pemToArrayBuffer(privateKeyPem);
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    keyData,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
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

async function readSheet(sheets: any, name: string) {
  const values = await sheets.valuesGet(name);
  const headers = (values[0] || []).map((x: any) => String(x || '').trim().toLowerCase());
  const rows = (values.slice(1) || []).map((row: any[]) => {
    const obj: any = {};
    headers.forEach((h: string, i: number) => {
      obj[h] = row[i] ?? '';
    });
    return obj;
  });
  return { headers, rows, raw: values };
}

async function readWorkbook(sheets: any) {
  const names = ['SUPPLIER_MASTER', 'PRODUK_MASTER', 'STOK_AWAL', 'TRANSAKSI_STOK', 'OPNAME_FISIK'];
  const workbook: any = {};
  for (const name of names) workbook[name] = await readSheet(sheets, name);
  return workbook;
}

function buildBootstrapData(workbook: any) {
  const supplierSheet = ensureSheet(workbook, 'SUPPLIER_MASTER');
  const productSheet = ensureSheet(workbook, 'PRODUK_MASTER');
  const openingSheet = ensureSheet(workbook, 'STOK_AWAL');
  const txnSheet = ensureSheet(workbook, 'TRANSAKSI_STOK');
  const opnameSheet = ensureSheet(workbook, 'OPNAME_FISIK');

  const suppliers = supplierSheet.rows.map((r: any) => ({
    supplier_id: r.supplier_id || '',
    nama_supplier: r.nama_supplier || '',
    no_wa: r.no_wa || '',
    aktif: (r.aktif || 'YA').toUpperCase(),
  })).filter((x: any) => x.supplier_id);

  const products = productSheet.rows.map((r: any) => ({
    product_id: r.product_id || '',
    supplier_id: r.supplier_id || '',
    nama_supplier: r.nama_supplier || (suppliers.find((s: any) => s.supplier_id === r.supplier_id)?.nama_supplier || ''),
    nama_produk: r.nama_produk || '',
    aktif: (r.aktif || 'YA').toUpperCase(),
    hpp: numberValue(r.hpp),
  })).filter((x: any) => x.product_id);

  const openings = openingSheet.rows.map((r: any) => ({
    tanggal: r.tanggal || '',
    supplier_id: r.supplier_id || '',
    product_id: r.product_id || '',
    qty: numberValue(r.qty),
    user_input: r.user_input || '',
  }));

  const txns = txnSheet.rows.map((r: any) => ({
    Tanggal_Input: r.tanggal_input || '',
    Product_ID: r.product_id || '',
    Supplier_ID: r.supplier_id || '',
    Nama_Supplier: r.nama_supplier || '',
    Nama_Produk: r.nama_produk || '',
    Jenis: (r.jenis || '').toUpperCase(),
    Qty: numberValue(r.qty),
    Catatan: r.catatan || '',
    User_Input: r.user_input || '',
  }));

  const opnames = opnameSheet.rows.map((r: any) => ({
    tanggal: r.tanggal || '',
    supplier_id: r.supplier_id || '',
    product_id: r.product_id || '',
    qty_fisik: numberValue(r.qty_fisik),
    user_input: r.user_input || '',
  }));

  const latestOpeningMap: any = {};
  for (const row of openings) latestOpeningMap[row.product_id] = row;

  const latestOpnameMap: any = {};
  for (const row of opnames) latestOpnameMap[row.product_id] = row;

  const stock = products.map((p: any) => {
    const stok_awal = numberValue(latestOpeningMap[p.product_id]?.qty || 0);

    const in_qty = txns.filter((x: any) => x.Product_ID === p.product_id && x.Jenis === 'IN').reduce((a: number, b: any) => a + numberValue(b.Qty), 0);
    const out_qty = txns.filter((x: any) => x.Product_ID === p.product_id && x.Jenis === 'OUT').reduce((a: number, b: any) => a + numberValue(b.Qty), 0);
    const reject_qty = txns.filter((x: any) => x.Product_ID === p.product_id && x.Jenis === 'REJECT').reduce((a: number, b: any) => a + numberValue(b.Qty), 0);
    const expired_qty = txns.filter((x: any) => x.Product_ID === p.product_id && ['EXPI', 'EXPIRED'].includes(x.Jenis)).reduce((a: number, b: any) => a + numberValue(b.Qty), 0);

    const stok_sistem = stok_awal + in_qty - out_qty - reject_qty - expired_qty;
    const qty_fisik = latestOpnameMap[p.product_id]?.qty_fisik ?? '';
    const selisih = qty_fisik === '' ? '' : numberValue(qty_fisik) - stok_sistem;
    const nilai_stok = stok_sistem * numberValue(p.hpp);

    let status = 'AMAN';
    if (stok_sistem <= 0) status = 'HABIS';
    else if (stok_sistem <= 3) status = 'MENIPIS';
    if (qty_fisik !== '' && selisih !== 0) status = 'SELISIH';

    return {
      product_id: p.product_id,
      supplier_id: p.supplier_id,
      nama_supplier: p.nama_supplier,
      nama_produk: p.nama_produk,
      aktif: p.aktif,
      hpp: numberValue(p.hpp),
      stok_awal,
      in_qty,
      out_qty,
      reject_qty,
      expired_qty,
      stok_sistem,
      qty_fisik,
      selisih,
      status,
      nilai_stok,
    };
  });

  return { suppliers, products, openings, txns, opnames, stock };
}

function buildWaDrafts(suppliers: any[], products: any[], txns: any[], stock: any[], date: string) {
  const txnsToday = txns.filter((x: any) => normalizeDate(x.Tanggal_Input) === normalizeDate(date));

  const rowsWithSupplier = txnsToday.map((row: any) => {
    const product = products.find((p: any) => cleanId(p.product_id) === cleanId(row.Product_ID));
    return {
      ...row,
      FinalSupplierID: cleanId(row.Supplier_ID) || cleanId(product?.supplier_id) || '',
    };
  });

  const bySupplier: any = {};
  rowsWithSupplier.forEach((row: any) => {
    const key = cleanId(row.FinalSupplierID);
    if (!key) return;
    if (!bySupplier[key]) bySupplier[key] = [];
    bySupplier[key].push(row);
  });

  return suppliers
    .filter((supplier: any) => String(supplier.aktif || '').trim().toUpperCase() === 'YA')
    .map((supplier: any) => {
      const supplierId = cleanId(supplier.supplier_id);
      const rows = bySupplier[supplierId] || [];
      if (!rows.length) return null;

      const productSummary: any = {};

      rows.forEach((row: any) => {
        const product = products.find((p: any) => cleanId(p.product_id) === cleanId(row.Product_ID));
        const stockInfo = stock.find((s: any) => cleanId(s.product_id) === cleanId(row.Product_ID)) || {};

        if (!productSummary[row.Product_ID]) {
          const masukHariIni = rows.filter((r: any) => cleanId(r.Product_ID) === cleanId(row.Product_ID) && String(r.Jenis || '').toUpperCase() === 'IN').reduce((a: number, b: any) => a + Number(b.Qty || 0), 0);
          const keluarHariIni = rows.filter((r: any) => cleanId(r.Product_ID) === cleanId(row.Product_ID) && String(r.Jenis || '').toUpperCase() === 'OUT').reduce((a: number, b: any) => a + Number(b.Qty || 0), 0);
          const rejectHariIni = rows.filter((r: any) => cleanId(r.Product_ID) === cleanId(row.Product_ID) && String(r.Jenis || '').toUpperCase() === 'REJECT').reduce((a: number, b: any) => a + Number(b.Qty || 0), 0);
          const expiredHariIni = rows.filter((r: any) => cleanId(r.Product_ID) === cleanId(row.Product_ID) && ['EXPI', 'EXPIRED'].includes(String(r.Jenis || '').toUpperCase())).reduce((a: number, b: any) => a + Number(b.Qty || 0), 0);

          const stokAwal = Number(stockInfo.stok_awal || 0);
          const sisaStokSekarang = stokAwal + masukHariIni - keluarHariIni - rejectHariIni - expiredHariIni;

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

      const lines = Object.values(productSummary).map((item: any) =>
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
        `Laporan stok tanggal ${normalizeDate(date)}:\n\n` +
        `${lines.join('\n\n')}\n\n` +
        `Terima kasih.`;

      const wa = normalizePhone(supplier.no_wa);

      return {
        supplier_id: supplier.supplier_id,
        nama_supplier: supplier.nama_supplier,
        no_wa: wa,
        pesan,
        link_wa: wa ? `https://wa.me/${wa}?text=${encodeURIComponent(pesan)}` : '#',
      };
    })
    .filter(Boolean);
}

function buildWeeklyDrafts(suppliers: any[], products: any[], txns: any[], start: string, end: string) {
  const txnsPeriod = txns.filter((x: any) => x.Tanggal_Input >= start && x.Tanggal_Input <= end);
  const bySupplier = groupBy(txnsPeriod, 'Supplier_ID');

  return suppliers
    .filter((supplier: any) => supplier.aktif === 'YA')
    .map((supplier: any) => {
      const rows = bySupplier[supplier.supplier_id] || [];
      if (!rows.length) return null;

      const summary: any = {};
      rows.filter((r: any) => r.Jenis === 'OUT').forEach((row: any) => {
        const product = products.find((p: any) => p.product_id === row.Product_ID);
        const hpp = Number(product?.hpp || 0);

        if (!summary[row.Product_ID]) {
          summary[row.Product_ID] = {
            nama_produk: product?.nama_produk || row.Nama_Produk || '-',
            hpp,
            qty_keluar: 0,
            subtotal: 0,
          };
        }

        summary[row.Product_ID].qty_keluar += Number(row.Qty || 0);
        summary[row.Product_ID].subtotal = summary[row.Product_ID].qty_keluar * hpp;
      });

      const items = Object.values(summary).filter((x: any) => x.qty_keluar > 0);
      if (!items.length) return null;

      const total_tagihan = items.reduce((a: number, b: any) => a + b.subtotal, 0);

      const lines = items.map((item: any) =>
        [
          `- ${item.nama_produk}`,
          `  HPP: Rp ${numberFormat(item.hpp)}`,
          `  Qty keluar: ${item.qty_keluar}`,
          `  Subtotal: Rp ${numberFormat(item.subtotal)}`,
        ].join('\n')
      );

      const pesan =
        `Halo ${supplier.nama_supplier},\n\n` +
        `Laporan penjualan mingguan:\n` +
        `Periode ${start} s/d ${end}\n\n` +
        `${lines.join('\n\n')}\n\n` +
        `Total tagihan minggu ini: Rp ${numberFormat(total_tagihan)}\n\n` +
        `Terima kasih.`;

      const wa = normalizePhone(supplier.no_wa);

      return {
        supplier_id: supplier.supplier_id,
        nama_supplier: supplier.nama_supplier,
        no_wa: wa,
        start,
        end,
        total_tagihan,
        pesan,
        link_wa: wa ? `https://wa.me/${wa}?text=${encodeURIComponent(pesan)}` : '#',
      };
    })
    .filter(Boolean);
}

async function saveOpening(sheets: any, workbook: any, payload: any) {
  const sheet = ensureSheet(workbook, 'STOK_AWAL');
  const tanggal = cleanValue(payload.tanggal);
  const supplier_id = cleanValue(payload.supplier_id);
  const product_id = cleanValue(payload.product_id);
  const qty = numberValue(payload.qty);
  const user_input = cleanValue(payload.user_input);

  if (!tanggal || !supplier_id || !product_id) {
    return json({ ok: false, error: 'Data stok awal belum lengkap' }, 400);
  }

  const existingIndex = sheet.rows.findIndex((r: any) => String(r.product_id) === product_id);

  if (existingIndex >= 0) {
    const rowNumber = existingIndex + 2;
    await sheets.valuesBatchUpdate([
      { range: a1('STOK_AWAL', rowNumber, requireHeaderCol(sheet, 'tanggal')), values: [[tanggal]] },
      { range: a1('STOK_AWAL', rowNumber, requireHeaderCol(sheet, 'supplier_id')), values: [[supplier_id]] },
      { range: a1('STOK_AWAL', rowNumber, requireHeaderCol(sheet, 'product_id')), values: [[product_id]] },
      { range: a1('STOK_AWAL', rowNumber, requireHeaderCol(sheet, 'qty')), values: [[qty]] },
      { range: a1('STOK_AWAL', rowNumber, requireHeaderCol(sheet, 'user_input')), values: [[user_input]] },
    ]);
    return json({ ok: true, message: 'Stok awal diperbarui' });
  }

  const row = buildRowByHeaders(sheet.headers, {
    tanggal,
    supplier_id,
    product_id,
    qty,
    user_input,
  });

  await sheets.valuesAppend('STOK_AWAL', [row]);
  return json({ ok: true, message: 'Stok awal disimpan' });
}

async function saveTransaction(sheets: any, workbook: any, payload: any) {
  const sheet = ensureSheet(workbook, 'TRANSAKSI_STOK');

  const tanggal = cleanValue(payload.tanggal);
  const supplier_id = cleanValue(payload.supplier_id);
  const product_id = cleanValue(payload.product_id);
  const jenisRaw = cleanValue(payload.jenis).toUpperCase();
  const jenis = jenisRaw === 'EXPIRED' ? 'EXPI' : jenisRaw;
  const qty = numberValue(payload.qty);
  const catatan = cleanValue(payload.keterangan || payload.catatan || '');
  const user_input = cleanValue(payload.user_input);

  if (!tanggal || !supplier_id || !product_id || !jenis) {
    return json({ ok: false, error: 'Data transaksi belum lengkap' }, 400);
  }

  const supplierSheet = ensureSheet(workbook, 'SUPPLIER_MASTER');
  const productSheet = ensureSheet(workbook, 'PRODUK_MASTER');

  const supplier = supplierSheet.rows.find((r: any) => String(r.supplier_id) === supplier_id);
  const product = productSheet.rows.find((r: any) => String(r.product_id) === product_id);

  const nama_supplier = supplier?.nama_supplier || product?.nama_supplier || '';
  const nama_produk = product?.nama_produk || '';

  const row = buildRowByHeaders(sheet.headers, {
    tanggal_input: tanggal,
    product_id,
    supplier_id,
    nama_supplier,
    nama_produk,
    jenis,
    qty,
    catatan,
    user_input,
  });

  await sheets.valuesAppend('TRANSAKSI_STOK', [row]);
  return json({ ok: true, message: 'Transaksi disimpan' });
}

async function saveOpname(sheets: any, workbook: any, payload: any) {
  const sheet = ensureSheet(workbook, 'OPNAME_FISIK');
  const tanggal = cleanValue(payload.tanggal);
  const supplier_id = cleanValue(payload.supplier_id);
  const product_id = cleanValue(payload.product_id);
  const qty_fisik = numberValue(payload.qty_fisik);
  const user_input = cleanValue(payload.user_input);

  if (!tanggal || !supplier_id || !product_id) {
    return json({ ok: false, error: 'Data opname belum lengkap' }, 400);
  }

  const existingIndex = sheet.rows.findIndex((r: any) => String(r.product_id) === product_id);

  if (existingIndex >= 0) {
    const rowNumber = existingIndex + 2;
    await sheets.valuesBatchUpdate([
      { range: a1('OPNAME_FISIK', rowNumber, requireHeaderCol(sheet, 'tanggal')), values: [[tanggal]] },
      { range: a1('OPNAME_FISIK', rowNumber, requireHeaderCol(sheet, 'supplier_id')), values: [[supplier_id]] },
      { range: a1('OPNAME_FISIK', rowNumber, requireHeaderCol(sheet, 'product_id')), values: [[product_id]] },
      { range: a1('OPNAME_FISIK', rowNumber, requireHeaderCol(sheet, 'qty_fisik')), values: [[qty_fisik]] },
      { range: a1('OPNAME_FISIK', rowNumber, requireHeaderCol(sheet, 'user_input')), values: [[user_input]] },
    ]);
    return json({ ok: true, message: 'Opname diperbarui' });
  }

  const row = buildRowByHeaders(sheet.headers, {
    tanggal,
    supplier_id,
    product_id,
    qty_fisik,
    user_input,
  });

  await sheets.valuesAppend('OPNAME_FISIK', [row]);
  return json({ ok: true, message: 'Opname disimpan' });
}

async function addSupplier(sheets: any, workbook: any, payload: any) {
  const sheet = ensureSheet(workbook, 'SUPPLIER_MASTER');
  const nama_supplier = cleanValue(payload.nama_supplier);
  const no_wa = normalizePhone(payload.no_wa);

  if (!nama_supplier) {
    return json({ ok: false, error: 'Nama supplier wajib diisi' }, 400);
  }

  const supplier_id = nextId('SUP-', sheet.rows, 'supplier_id');

  const row = buildRowByHeaders(sheet.headers, {
    supplier_id,
    nama_supplier,
    no_wa,
    aktif: 'YA',
  });

  await sheets.valuesAppend('SUPPLIER_MASTER', [row]);
  return json({ ok: true, message: 'Supplier ditambahkan' });
}

async function updateSupplier(sheets: any, workbook: any, payload: any) {
  const sheet = ensureSheet(workbook, 'SUPPLIER_MASTER');
  const supplier_id = cleanValue(payload.supplier_id);
  const nama_supplier = cleanValue(payload.nama_supplier);
  const no_wa = normalizePhone(payload.no_wa);
  const aktif = cleanValue(payload.aktif || 'YA').toUpperCase();

  const idx = sheet.rows.findIndex((r: any) => String(r.supplier_id) === supplier_id);
  if (idx === -1) return json({ ok: false, error: 'Supplier tidak ditemukan' }, 404);

  const rowNumber = idx + 2;
  await sheets.valuesBatchUpdate([
    { range: a1('SUPPLIER_MASTER', rowNumber, requireHeaderCol(sheet, 'supplier_id')), values: [[supplier_id]] },
    { range: a1('SUPPLIER_MASTER', rowNumber, requireHeaderCol(sheet, 'nama_supplier')), values: [[nama_supplier]] },
    { range: a1('SUPPLIER_MASTER', rowNumber, requireHeaderCol(sheet, 'no_wa')), values: [[no_wa]] },
    { range: a1('SUPPLIER_MASTER', rowNumber, requireHeaderCol(sheet, 'aktif')), values: [[aktif]] },
  ]);

  return json({ ok: true, message: 'Supplier berhasil diperbarui' });
}

async function deleteSupplier(sheets: any, workbook: any, payload: any) {
  const productSheet = ensureSheet(workbook, 'PRODUK_MASTER');
  const supplierSheet = ensureSheet(workbook, 'SUPPLIER_MASTER');
  const supplier_id = cleanValue(payload.supplier_id);

  const hasActiveProducts = productSheet.rows.some(
    (r: any) => String(r.supplier_id) === supplier_id && String(r.aktif || 'YA').toUpperCase() === 'YA'
  );

  if (hasActiveProducts) {
    return json({ ok: false, error: 'Supplier masih punya produk aktif. Nonaktifkan / hapus produknya dulu.' }, 400);
  }

  const idx = supplierSheet.rows.findIndex((r: any) => String(r.supplier_id) === supplier_id);
  if (idx === -1) return json({ ok: false, error: 'Supplier tidak ditemukan' }, 404);

  const rowNumber = idx + 2;
  await sheets.valuesBatchUpdate([
    { range: a1('SUPPLIER_MASTER', rowNumber, requireHeaderCol(supplierSheet, 'nama_supplier')), values: [['[DELETED]']] },
    { range: a1('SUPPLIER_MASTER', rowNumber, requireHeaderCol(supplierSheet, 'no_wa')), values: [['']] },
    { range: a1('SUPPLIER_MASTER', rowNumber, requireHeaderCol(supplierSheet, 'aktif')), values: [['TIDAK']] },
  ]);

  return json({ ok: true, message: 'Supplier dinonaktifkan / dihapus' });
}

async function addProduct(sheets: any, workbook: any, payload: any) {
  const sheet = ensureSheet(workbook, 'PRODUK_MASTER');
  const supplierSheet = ensureSheet(workbook, 'SUPPLIER_MASTER');

  const supplier_id = cleanValue(payload.supplier_id);
  const nama_produk = cleanValue(payload.nama_produk);
  const hpp = numberValue(payload.hpp);

  if (!supplier_id || !nama_produk) {
    return json({ ok: false, error: 'Supplier dan nama produk wajib diisi' }, 400);
  }

  const supplier = supplierSheet.rows.find((r: any) => String(r.supplier_id) === supplier_id);
  if (!supplier) return json({ ok: false, error: 'Supplier tidak ditemukan' }, 404);

  const product_id = nextId('PRD-', sheet.rows, 'product_id');
  const nama_supplier = supplier.nama_supplier || '';

  const row = buildRowByHeaders(sheet.headers, {
    product_id,
    supplier_id,
    nama_supplier,
    nama_produk,
    aktif: 'YA',
    hpp,
  });

  await sheets.valuesAppend('PRODUK_MASTER', [row]);
  return json({ ok: true, message: 'Produk ditambahkan' });
}

async function updateProduct(sheets: any, workbook: any, payload: any) {
  const sheet = ensureSheet(workbook, 'PRODUK_MASTER');
  const supplierSheet = ensureSheet(workbook, 'SUPPLIER_MASTER');

  const product_id = cleanValue(payload.product_id);
  const supplier_id = cleanValue(payload.supplier_id);
  const nama_produk = cleanValue(payload.nama_produk);
  const hpp = numberValue(payload.hpp);
  const aktif = cleanValue(payload.aktif || 'YA').toUpperCase();

  const supplier = supplierSheet.rows.find((r: any) => String(r.supplier_id) === supplier_id);
  const nama_supplier = supplier?.nama_supplier || '';

  const idx = sheet.rows.findIndex((r: any) => String(r.product_id) === product_id);
  if (idx === -1) return json({ ok: false, error: 'Produk tidak ditemukan' }, 404);

  const rowNumber = idx + 2;
  await sheets.valuesBatchUpdate([
    { range: a1('PRODUK_MASTER', rowNumber, requireHeaderCol(sheet, 'product_id')), values: [[product_id]] },
    { range: a1('PRODUK_MASTER', rowNumber, requireHeaderCol(sheet, 'supplier_id')), values: [[supplier_id]] },
    { range: a1('PRODUK_MASTER', rowNumber, requireHeaderCol(sheet, 'nama_supplier')), values: [[nama_supplier]] },
    { range: a1('PRODUK_MASTER', rowNumber, requireHeaderCol(sheet, 'nama_produk')), values: [[nama_produk]] },
    { range: a1('PRODUK_MASTER', rowNumber, requireHeaderCol(sheet, 'aktif')), values: [[aktif]] },
    { range: a1('PRODUK_MASTER', rowNumber, requireHeaderCol(sheet, 'hpp')), values: [[hpp]] },
  ]);

  return json({ ok: true, message: 'Produk berhasil diperbarui' });
}

async function deleteProduct(sheets: any, workbook: any, payload: any) {
  const sheet = ensureSheet(workbook, 'PRODUK_MASTER');
  const product_id = cleanValue(payload.product_id);
  const data = buildBootstrapData(workbook);
  const stockInfo = data.stock.find((x: any) => x.product_id === product_id);

  if (stockInfo && numberValue(stockInfo.stok_sistem) > 0) {
    return json({ ok: false, error: 'Produk masih punya stok. Kosongkan dulu sebelum hapus.' }, 400);
  }

  const idx = sheet.rows.findIndex((r: any) => String(r.product_id) === product_id);
  if (idx === -1) return json({ ok: false, error: 'Produk tidak ditemukan' }, 404);

  const rowNumber = idx + 2;
  await sheets.valuesBatchUpdate([
    { range: a1('PRODUK_MASTER', rowNumber, requireHeaderCol(sheet, 'nama_produk')), values: [['[DELETED]']] },
    { range: a1('PRODUK_MASTER', rowNumber, requireHeaderCol(sheet, 'aktif')), values: [['TIDAK']] },
  ]);

  return json({ ok: true, message: 'Produk dihapus / dinonaktifkan' });
}
