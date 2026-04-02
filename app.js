const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

let state = {
  suppliers: [],
  products: [],
  stock: [],
};

function todayString() {
  return new Date().toISOString().slice(0, 10);
}

function weekAgoString() {
  const d = new Date();
  d.setDate(d.getDate() - 6);
  return d.toISOString().slice(0, 10);
}

function rupiah(n) {
  return new Intl.NumberFormat('id-ID').format(Number(n || 0));
}

function showToast(message, isError = false) {
  const toast = $('#toast');
  if (!toast) return;
  toast.textContent = message;
  toast.style.background = isError ? '#991b1b' : '#102033';
  toast.classList.add('show');
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => toast.classList.remove('show'), 2800);
}

function setDefaultDates() {
  ['openingForm', 'transactionForm', 'opnameForm'].forEach((id) => {
    const form = $('#' + id);
    if (form && form.elements.tanggal) form.elements.tanggal.value = todayString();
  });
  if ($('#waDate')) $('#waDate').value = todayString();
  if ($('#weeklyStart')) $('#weeklyStart').value = weekAgoString();
  if ($('#weeklyEnd')) $('#weeklyEnd').value = todayString();
}

function renderMetrics() {
  $('#metricSuppliers').textContent = state.suppliers.filter((x) => x.aktif === 'YA').length;
  $('#metricProducts').textContent = state.products.filter((x) => x.aktif === 'YA').length;
  $('#metricLow').textContent = state.stock.filter((x) => x.status === 'MENIPIS').length;
  $('#metricEmpty').textContent = state.stock.filter((x) => x.status === 'HABIS').length;
  const total = state.stock.reduce((a, b) => a + Number(b.nilai_stok || 0), 0);
  $('#metricStockValue').textContent = rupiah(total);
}

function statusClass(status) {
  if (status === 'AMAN') return 'status-aman';
  if (status === 'MENIPIS') return 'status-menipis';
  if (status === 'SELISIH') return 'status-selisih';
  return 'status-habis';
}

function renderStockTable(rows = state.stock) {
  const body = $('#stockTableBody');
  body.innerHTML = rows.map((item) => `
    <tr>
      <td>${item.nama_produk || '-'}</td>
      <td>${item.nama_supplier || '-'}</td>
      <td>${rupiah(item.hpp || 0)}</td>
      <td>${item.stok_sistem ?? 0}</td>
      <td>${rupiah(item.nilai_stok || 0)}</td>
      <td>${item.qty_fisik === '' ? '-' : item.qty_fisik}</td>
      <td>${item.selisih === '' ? '-' : item.selisih}</td>
      <td><span class="status-pill ${statusClass(item.status)}">${item.status || '-'}</span></td>
    </tr>
  `).join('');
}

function renderSupplierTable() {
  const body = $('#supplierTableBody');
  body.innerHTML = state.suppliers.map((item) => `
    <tr>
      <td>${item.supplier_id}</td>
      <td>${item.nama_supplier || '-'}</td>
      <td>${item.no_wa || '-'}</td>
      <td><span class="status-pill ${item.aktif === 'YA' ? 'status-aman' : 'status-habis'}">${item.aktif || '-'}</span></td>
      <td>
        <div class="row-actions">
          <button type="button" class="mini-btn" data-action="edit-supplier" data-id="${item.supplier_id}">Edit</button>
          <button type="button" class="mini-btn" data-action="toggle-supplier" data-id="${item.supplier_id}">
            ${item.aktif === 'YA' ? 'Nonaktifkan' : 'Aktifkan'}
          </button>
          <button type="button" class="mini-btn danger-btn" data-action="delete-supplier" data-id="${item.supplier_id}">Hapus</button>
        </div>
      </td>
    </tr>
  `).join('');
}

function renderProductTable() {
  const body = $('#productTableBody');
  body.innerHTML = state.products.map((item) => {
    const stock = state.stock.find((x) => x.product_id === item.product_id);
    return `
      <tr>
        <td>${item.product_id}</td>
        <td>${item.nama_supplier || item.supplier_id || '-'}</td>
        <td>${item.nama_produk || '-'}</td>
        <td>${rupiah(item.hpp || 0)}</td>
        <td>${stock ? stock.stok_sistem : 0}</td>
        <td><span class="status-pill ${item.aktif === 'YA' ? 'status-aman' : 'status-habis'}">${item.aktif || '-'}</span></td>
        <td>
          <div class="row-actions">
            <button type="button" class="mini-btn" data-action="edit-product" data-id="${item.product_id}">Edit</button>
            <button type="button" class="mini-btn" data-action="toggle-product" data-id="${item.product_id}">
              ${item.aktif === 'YA' ? 'Discontinue' : 'Aktifkan'}
            </button>
            <button type="button" class="mini-btn danger-btn" data-action="delete-product" data-id="${item.product_id}">Hapus</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function populateSupplierSelects() {
  const options = ['<option value="">Pilih supplier</option>']
    .concat(
      state.suppliers
        .filter((s) => s.aktif === 'YA')
        .map((s) => `<option value="${s.supplier_id}">${s.nama_supplier}</option>`)
    )
    .join('');

  $$('select[name="supplier_id"]').forEach((select) => {
    const current = select.value;
    select.innerHTML = options;
    if ([...select.options].some((x) => x.value === current)) select.value = current;
    select.onchange = () => populateProductSelect(select.form);
  });
}

function populateProductSelect(form) {
  if (!form || !form.elements) return;
  const supplierId = form.elements.supplier_id?.value;
  const select = form.elements.product_id;
  if (!select) return;

  const current = select.value;
  const options = ['<option value="">Pilih produk</option>']
    .concat(
      state.products
        .filter((p) => !supplierId || p.supplier_id === supplierId)
        .filter((p) => p.aktif === 'YA')
        .map((p) => `<option value="${p.product_id}">${p.nama_produk}</option>`)
    )
    .join('');

  select.innerHTML = options;
  if ([...select.options].some((x) => x.value === current)) select.value = current;
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await response.json();
  if (!response.ok || data.ok === false) throw new Error(data.error || 'Terjadi error');
  return data;
}

async function loadBootstrap() {
  const data = await api('/api/bootstrap');
  state = data.data;
  renderMetrics();
  renderStockTable();
  renderSupplierTable();
  renderProductTable();
  populateSupplierSelects();
  ['openingForm', 'transactionForm', 'opnameForm'].forEach((id) => {
    const form = $('#' + id);
    if (form) populateProductSelect(form);
  });
}

async function submitForm(form, action) {
  const body = Object.fromEntries(new FormData(form).entries());
  const data = await api('/api/save', {
    method: 'POST',
    body: JSON.stringify({ action, payload: body }),
  });
  showToast(data.message || 'Tersimpan');
  form.reset();
  setDefaultDates();
  await loadBootstrap();
}

async function sendAction(action, payload, successMessage) {
  const data = await api('/api/save', {
    method: 'POST',
    body: JSON.stringify({ action, payload }),
  });
  showToast(data.message || successMessage || 'Berhasil');
  await loadBootstrap();
}

async function loadWaDrafts() {
  const date = $('#waDate')?.value || todayString();
  const data = await api('/api/wa?date=' + encodeURIComponent(date));
  const list = data.data || [];
  const waList = $('#waList');
  waList.innerHTML = list.length
    ? list.map((item) => `
      <div class="wa-card">
        <h3>${item.nama_supplier}</h3>
        <p>${item.pesan.replace(/\n/g, '<br>')}</p>
        <div class="wa-actions">
          <a class="primary-btn" href="${item.link_wa}" target="_blank" rel="noreferrer">Buka WhatsApp</a>
          <button class="secondary-btn" type="button" data-copy="${encodeURIComponent(item.pesan)}">Copy Pesan</button>
        </div>
      </div>
    `).join('')
    : '<p>Belum ada draft untuk tanggal ini.</p>';

  $$('[data-copy]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await navigator.clipboard.writeText(decodeURIComponent(btn.dataset.copy));
      showToast('Pesan disalin');
    });
  });
}

async function loadWeeklyReport() {
  const start = $('#weeklyStart')?.value || weekAgoString();
  const end = $('#weeklyEnd')?.value || todayString();
  const data = await api(`/api/weekly?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`);
  const list = data.data || [];
  const weeklyList = $('#weeklyList');

  weeklyList.innerHTML = list.length
    ? list.map((item) => `
      <div class="weekly-card">
        <h3>${item.nama_supplier}</h3>
        <div class="summary-box">
          <div><strong>Periode:</strong> ${item.start} s/d ${item.end}</div>
          <div><strong>Total tagihan:</strong> Rp ${rupiah(item.total_tagihan)}</div>
        </div>
        <p>${item.pesan.replace(/\n/g, '<br>')}</p>
        <div class="wa-actions">
          <a class="primary-btn" href="${item.link_wa}" target="_blank" rel="noreferrer">Buka WhatsApp</a>
          <button class="secondary-btn" type="button" data-copy-weekly="${encodeURIComponent(item.pesan)}">Copy Pesan</button>
        </div>
      </div>
    `).join('')
    : '<p>Belum ada data tagihan pada periode ini.</p>';

  $$('[data-copy-weekly]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await navigator.clipboard.writeText(decodeURIComponent(btn.dataset.copyWeekly));
      showToast('Pesan mingguan disalin');
    });
  });
}

function bindTabs() {
  $$('#tabbar .tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      $$('#tabbar .tab').forEach((x) => x.classList.remove('active'));
      $$('.tab-panel').forEach((x) => x.classList.remove('active'));
      btn.classList.add('active');
      $('#' + btn.dataset.tab)?.classList.add('active');
    });
  });
}

function bindSearch() {
  const input = $('#searchInput');
  if (!input) return;
  input.addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase();
    const rows = state.stock.filter((item) =>
      (item.nama_produk || '').toLowerCase().includes(q) ||
      (item.nama_supplier || '').toLowerCase().includes(q)
    );
    renderStockTable(rows);
  });
}

function bindManagerTables() {
  $('#supplierTableBody')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const supplier = state.suppliers.find((x) => x.supplier_id === btn.dataset.id);
    if (!supplier) return;

    try {
      if (btn.dataset.action === 'edit-supplier') {
        const nama_supplier = prompt('Nama supplier', supplier.nama_supplier);
        if (nama_supplier === null) return;
        const no_wa = prompt('Nomor WhatsApp', supplier.no_wa || '');
        if (no_wa === null) return;
        await sendAction('updateSupplier', {
          supplier_id: supplier.supplier_id,
          nama_supplier,
          no_wa,
          aktif: supplier.aktif || 'YA',
        }, 'Supplier diperbarui');
      }

      if (btn.dataset.action === 'toggle-supplier') {
        await sendAction('updateSupplier', {
          supplier_id: supplier.supplier_id,
          nama_supplier: supplier.nama_supplier,
          no_wa: supplier.no_wa || '',
          aktif: supplier.aktif === 'YA' ? 'TIDAK' : 'YA',
        }, 'Status supplier diperbarui');
      }

      if (btn.dataset.action === 'delete-supplier') {
        if (!confirm(`Hapus supplier ${supplier.nama_supplier}?`)) return;
        await sendAction('deleteSupplier', { supplier_id: supplier.supplier_id }, 'Supplier dihapus');
      }
    } catch (err) {
      showToast(err.message, true);
    }
  });

  $('#productTableBody')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const product = state.products.find((x) => x.product_id === btn.dataset.id);
    if (!product) return;
    const stock = state.stock.find((x) => x.product_id === product.product_id);

    try {
      if (btn.dataset.action === 'edit-product') {
        const nama_produk = prompt('Nama produk', product.nama_produk);
        if (nama_produk === null) return;
        const hpp = prompt('HPP / Harga beli', product.hpp || 0);
        if (hpp === null) return;
        await sendAction('updateProduct', {
          product_id: product.product_id,
          supplier_id: product.supplier_id,
          nama_produk,
          hpp,
          aktif: product.aktif || 'YA',
        }, 'Produk diperbarui');
      }

      if (btn.dataset.action === 'toggle-product') {
        if (product.aktif === 'YA' && stock && Number(stock.stok_sistem || 0) > 0) {
          if (!confirm(`Stok ${product.nama_produk} masih ${stock.stok_sistem}. Tetap nonaktifkan?`)) return;
        }
        await sendAction('updateProduct', {
          product_id: product.product_id,
          supplier_id: product.supplier_id,
          nama_produk: product.nama_produk,
          hpp: product.hpp || 0,
          aktif: product.aktif === 'YA' ? 'TIDAK' : 'YA',
        }, 'Status produk diperbarui');
      }

      if (btn.dataset.action === 'delete-product') {
        if (stock && Number(stock.stok_sistem || 0) > 0) {
          showToast('Produk masih punya stok. Kosongkan dulu sebelum hapus.', true);
          return;
        }
        if (!confirm(`Hapus produk ${product.nama_produk}?`)) return;
        await sendAction('deleteProduct', { product_id: product.product_id }, 'Produk dihapus');
      }
    } catch (err) {
      showToast(err.message, true);
    }
  });
}

function bindForms() {
  $('#openingForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await submitForm(e.currentTarget, 'saveOpening'); } catch (err) { showToast(err.message, true); }
  });

  $('#transactionForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await submitForm(e.currentTarget, 'saveTransaction'); } catch (err) { showToast(err.message, true); }
  });

  $('#opnameForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await submitForm(e.currentTarget, 'saveOpname'); } catch (err) { showToast(err.message, true); }
  });

  $('#supplierForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await submitForm(e.currentTarget, 'addSupplier'); } catch (err) { showToast(err.message, true); }
  });

  $('#productForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await submitForm(e.currentTarget, 'addProduct'); } catch (err) { showToast(err.message, true); }
  });

  $('#loadWaBtn')?.addEventListener('click', async () => {
    try { await loadWaDrafts(); } catch (err) { showToast(err.message, true); }
  });

  $('#loadWeeklyBtn')?.addEventListener('click', async () => {
    try { await loadWeeklyReport(); } catch (err) { showToast(err.message, true); }
  });

  $('#refreshBtn')?.addEventListener('click', async () => {
    try {
      await loadBootstrap();
      showToast('Data diperbarui');
    } catch (err) {
      showToast(err.message, true);
    }
  });
}

(async function init() {
  bindTabs();
  bindSearch();
  bindForms();
  bindManagerTables();
  setDefaultDates();
  try {
    await loadBootstrap();
    await loadWaDrafts();
    await loadWeeklyReport();
  } catch (err) {
    showToast(err.message, true);
  }
})();
