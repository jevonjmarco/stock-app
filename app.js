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

function showToast(message, isError = false) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.style.background = isError ? '#991b1b' : '#102033';
  toast.classList.add('show');
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => toast.classList.remove('show'), 2400);
}

function setDefaultDates() {
  ['openingForm', 'transactionForm', 'opnameForm'].forEach((id) => {
    const form = $('#' + id);
    form.elements.tanggal.value = todayString();
  });
  $('#waDate').value = todayString();
}

function renderMetrics() {
  $('#metricSuppliers').textContent = state.suppliers.length;
  $('#metricProducts').textContent = state.products.length;
  $('#metricLow').textContent = state.stock.filter((x) => x.status === 'MENIPIS').length;
  $('#metricEmpty').textContent = state.stock.filter((x) => x.status === 'HABIS').length;
}

function statusClass(status) {
  if (status === 'AMAN') return 'status-aman';
  if (status === 'MENIPIS') return 'status-menipis';
  if (status === 'SELISIH') return 'status-selisih';
  return 'status-habis';
}

function renderStockTable(rows = state.stock) {
  $('#stockTableBody').innerHTML = rows.map((item) => `
    <tr>
      <td>${item.nama_produk}</td>
      <td>${item.nama_supplier}</td>
      <td>${item.stok_sistem}</td>
      <td>${item.qty_fisik ?? '-'}</td>
      <td>${item.selisih ?? '-'}</td>
      <td><span class="status-pill ${statusClass(item.status)}">${item.status}</span></td>
    </tr>
  `).join('');
}

function populateSupplierSelects() {
  const options = ['<option value="">Pilih supplier</option>']
    .concat(state.suppliers.filter((s) => s.aktif === 'YA').map((s) => `<option value="${s.supplier_id}">${s.nama_supplier}</option>`))
    .join('');

  $$('select[name="supplier_id"]').forEach((select) => {
    select.innerHTML = options;
    select.addEventListener('change', () => populateProductSelect(select.form));
  });
}

function populateProductSelect(form) {
  const supplierId = form.elements.supplier_id.value;
  const select = form.elements.product_id;
  if (!select) return;
  const options = ['<option value="">Pilih produk</option>']
    .concat(state.products
      .filter((p) => !supplierId || p.supplier_id === supplierId)
      .filter((p) => p.aktif === 'YA')
      .map((p) => `<option value="${p.product_id}">${p.nama_produk}</option>`))
    .join('');
  select.innerHTML = options;
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await response.json();
  if (!response.ok || data.ok === false) {
    throw new Error(data.error || 'Terjadi error');
  }
  return data;
}

async function loadBootstrap() {
  const data = await api('/api/bootstrap');
  state = data.data;
  renderMetrics();
  renderStockTable();
  populateSupplierSelects();
  ['openingForm', 'transactionForm', 'opnameForm'].forEach((id) => populateProductSelect($('#' + id)));
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

async function loadWaDrafts() {
  const date = $('#waDate').value || todayString();
  const data = await api('/api/wa?date=' + encodeURIComponent(date));
  const list = data.data || [];
  $('#waList').innerHTML = list.length ? list.map((item) => `
    <div class="wa-card">
      <h3>${item.nama_supplier}</h3>
      <p>${item.pesan}</p>
      <div class="wa-actions">
        <a class="primary-btn" href="${item.link_wa}" target="_blank" rel="noreferrer">Buka WhatsApp</a>
        <button class="secondary-btn" type="button" data-copy="${encodeURIComponent(item.pesan)}">Copy Pesan</button>
      </div>
    </div>
  `).join('') : '<p>Belum ada draft untuk tanggal ini.</p>';

  $$('[data-copy]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const text = decodeURIComponent(btn.dataset.copy);
      await navigator.clipboard.writeText(text);
      showToast('Pesan disalin');
    });
  });
}

function bindTabs() {
  $$('#tabbar .tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      $$('#tabbar .tab').forEach((x) => x.classList.remove('active'));
      $$('.tab-panel').forEach((x) => x.classList.remove('active'));
      btn.classList.add('active');
      $('#' + btn.dataset.tab).classList.add('active');
    });
  });
}

function bindSearch() {
  $('#searchInput').addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase();
    const rows = state.stock.filter((item) =>
      item.nama_produk.toLowerCase().includes(q) || item.nama_supplier.toLowerCase().includes(q)
    );
    renderStockTable(rows);
  });
}

function bindForms() {
  $('#openingForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await submitForm(e.currentTarget, 'saveOpening'); } catch (err) { showToast(err.message, true); }
  });
  $('#transactionForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await submitForm(e.currentTarget, 'saveTransaction'); } catch (err) { showToast(err.message, true); }
  });
  $('#opnameForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await submitForm(e.currentTarget, 'saveOpname'); } catch (err) { showToast(err.message, true); }
  });
  $('#supplierForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await submitForm(e.currentTarget, 'addSupplier'); } catch (err) { showToast(err.message, true); }
  });
  $('#productForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await submitForm(e.currentTarget, 'addProduct'); } catch (err) { showToast(err.message, true); }
  });
  $('#loadWaBtn').addEventListener('click', async () => {
    try { await loadWaDrafts(); } catch (err) { showToast(err.message, true); }
  });
  $('#refreshBtn').addEventListener('click', async () => {
    try { await loadBootstrap(); showToast('Data diperbarui'); } catch (err) { showToast(err.message, true); }
  });
}

(async function init() {
  bindTabs();
  bindSearch();
  bindForms();
  setDefaultDates();
  try {
    await loadBootstrap();
    await loadWaDrafts();
  } catch (err) {
    showToast(err.message, true);
  }
})();
