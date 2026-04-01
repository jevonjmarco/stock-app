# Setup Detail

## 1) Google Sheet
- pakai file `stock_control_template.xlsx`
- upload ke Google Drive
- buka dengan Google Sheets
- copy `Spreadsheet ID` dari URL Google Sheets

Contoh:
`https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit`

## 2) Google Service Account
- buka Google Cloud Console
- buat project baru
- aktifkan **Google Sheets API**
- buat **Service Account**
- generate key JSON
- ambil:
  - `client_email`
  - `private_key`

## 3) Share Sheet
Share Google Sheet ke `client_email` service account sebagai **Editor**.

## 4) Cloudflare Pages
Upload folder ini ke Cloudflare Pages.

### Environment Variables
Isi di Project Settings > Environment Variables:
- `GOOGLE_CLIENT_EMAIL` = email service account
- `GOOGLE_PRIVATE_KEY` = isi private key lengkap termasuk baris BEGIN/END
- `GOOGLE_SHEET_ID` = ID spreadsheet Google Sheet Anda

## 5) Test route
Sesudah deploy, cek:
- `/api/bootstrap`
- `/api/wa?date=YYYY-MM-DD`

Kalau `/api/bootstrap` sukses, maka frontend akan langsung jalan.

## Struktur sheet yang dipakai backend
- `SUPPLIER_MASTER`
- `PRODUK_MASTER`
- `STOK_AWAL`
- `TRANSAKSI_STOK`
- `OPNAME_FISIK`
- `WA_DRAFT` (disiapkan, tapi draft WA utamanya dihitung dari transaksi)

## Saran operasional
- isi `No_WA` supplier dulu di master supplier
- input stok awal pertama kali sebelum input OUT
- opname bisa dilakukan kapan saja untuk cek stok nyata dan selisih
