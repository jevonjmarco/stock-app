# StockFlow Cafe - Cloudflare Package

Paket ini berisi web app sederhana untuk:
- stok awal
- transaksi IN / OUT / REJECT / EXPIRED
- opname fisik
- master supplier
- master produk
- draft WhatsApp supplier

## Isi paket
- `index.html`, `styles.css`, `app.js` = frontend
- `functions/api/[[path]].js` = backend Cloudflare Pages Functions
- `stock_control_template.xlsx` = template Google Sheet dengan master supplier dan produk dari database Anda, semua qty dikosongkan

## Cara pakai singkat
1. Upload `stock_control_template.xlsx` ke Google Drive.
2. Buka dengan Google Sheets.
3. Buat Google Cloud Service Account.
4. Share Google Sheet ke email service account sebagai **Editor**.
5. Upload folder ini ke Cloudflare Pages.
6. Isi 3 environment variables di Cloudflare Pages:
   - `GOOGLE_CLIENT_EMAIL`
   - `GOOGLE_PRIVATE_KEY`
   - `GOOGLE_SHEET_ID`
7. Deploy.

Setelah itu web langsung bisa dipakai dari HP maupun desktop.

## Catatan penting
Bagian WA di paket ini adalah **Level 1**:
- sistem membuat draft pesan
- sistem membuat link `wa.me`
- user tinggal klik untuk kirim

Belum full otomatis tanpa klik, karena itu butuh integrasi resmi WhatsApp API.
