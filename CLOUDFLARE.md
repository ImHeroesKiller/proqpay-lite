# Deploy ProQPay Lite ke Cloudflare Pages

## Build

Hubungkan repo `ImHeroesKiller/proqpay-lite` melalui **Workers & Pages → Pages →
Connect to Git**, lalu gunakan:

| Field | Value |
|---|---|
| Build command | `npm run build` |
| Build output | `out` |
| Root directory | `/` |
| `NODE_VERSION` | `22` |

Jangan set `GITHUB_PAGES=true`.

## Environment dan secret

Minimal:

| Name | Jenis | Keterangan |
|---|---|---|
| `NODE_VERSION` | variable | `22` |
| `APP_ORIGINS` | variable | Origin tambahan, dipisahkan koma |
| `DEFAULT_ORG_ID` | variable | `ORG-OTSINDO` |
| `DATA_BACKEND` | variable | `d1` |
| `AUTH_MODE` | variable | Wajib `session` untuk production |
| `SESSION_HOURS` | variable | Durasi sesi login, default `8`, maksimum `168` |
| `PI_ENCRYPTION_KEY` | secret | Minimal 32 karakter; key AES-256-GCM untuk snapshot rekening PI |
| `PROQPAY_BOOTSTRAP_ADMIN_EMAIL` | GitHub secret | Email Super Admin pertama untuk workflow cutover |
| `PROQPAY_BOOTSTRAP_ADMIN_PASSWORD` | GitHub secret | Password kuat sementara; tidak ditulis ke log/SQL plaintext |

Jangan commit nilai secret ke repository atau mencetaknya di log deployment.

## Mode keamanan dan aktivasi login

Account Management menggunakan tabel D1 `app_users`, `user_client_scopes`, dan
`app_sessions`. Password disimpan sebagai hash PBKDF2-SHA256 100.000 iterasi dengan salt,
password sementara wajib diganti pada login pertama, lima kegagalan login akan
mengunci akun selama 15 menit, dan cookie sesi bersifat HttpOnly/Secure/SameSite.

Urutan aktivasi production:

1. Simpan `PROQPAY_BOOTSTRAP_ADMIN_EMAIL` dan `PROQPAY_BOOTSTRAP_ADMIN_PASSWORD`
   sebagai GitHub Actions secrets.
2. Workflow mengimpor schema, membuat satu Super Admin secara idempotent, lalu
   memverifikasi keberadaannya sebelum deployment.
3. Production dideploy langsung dengan `AUTH_MODE=session`; mode `origin` tidak
   boleh digunakan untuk production.
4. Login dengan akun bootstrap lalu segera ganti password sementara.

Mode `access` tetap tersedia bila Cloudflare Access hendak digunakan sebagai
identity provider terpisah.

Binding R2 production wajib bernama `PAYMENT_PROOFS` dan mengarah ke bucket
private `proqpay-payment-proofs`. Bukti pembayaran diunggah melalui
`POST /api/payment-proof` (multipart, PDF/JPG/PNG, maksimal 5 MB) dan hanya
dapat diunduh melalui `GET /api/payment-proof?id=...` setelah otorisasi role
dan client scope. Object key tidak pernah dikirim sebagai URL publik.

Role yang dikenali hanya `SUPER_ADMIN`, `PAYROLL_PROCESSOR`,
`PAYROLL_CONTROLLER`, dan `CLIENT_USER`. `PAYMENT_APPROVER` adalah permission
tambahan untuk Controller, bukan persona kelima. Scope `CLIENT_USER` disimpan di
database dan wajib memiliki minimal satu klien.

Hak akses API:

| Endpoint | Akses |
|---|---|
| `GET /api/health` | publik, respons disanitasi |
| `GET /api/me` | identitas, role, dan permission pengguna aktif |
| `GET /api/employees` | semua role terautentikasi |
| `POST /api/employees` | `SUPER_ADMIN`, `PAYROLL_PROCESSOR` |
| `POST /api/import` | `SUPER_ADMIN`, `PAYROLL_PROCESSOR`, `CLIENT_USER` sesuai scope |
| `POST /api/schema` | `SUPER_ADMIN` |
| `GET/POST /api/accounts` | Daftar untuk `SUPER_ADMIN`; ganti password untuk pemilik akun |
| `POST /api/login`, `/api/logout` | Login database dan pencabutan sesi |
| `/api/ida`, `/api/wilayah` | semua role terautentikasi |
| `GET/POST /api/state` | role internal sesuai workflow |

## Rate limiting

Middleware menggunakan binding `API_RATE_LIMITER` bila binding Cloudflare Rate
Limiting tersedia. Tanpa binding tersebut aplikasi tetap berjalan. Buat binding
bernama `API_RATE_LIMITER` di konfigurasi project dan atur limit sesuai beban
production; key dibentuk dari identitas Access dan nama resource.

## Verifikasi

```bash
npm test
npm run build
curl https://proqpay-lite.pages.dev/api/health
```

Inisialisasi schema hanya melalui request POST yang sudah terautentikasi:

```bash
curl -X POST https://proqpay-lite.pages.dev/api/schema
```

Setelah mengaktifkan login database, panggilan tanpa cookie sesi harus menghasilkan 401
untuk endpoint yang dilindungi.

## Quality gate dan header

GitHub Actions menjalankan tes, typecheck, lint, dan production build pada setiap
push ke `main` dan pull request. Deployment production tetap dilakukan oleh
integrasi Git Cloudflare Pages; workflow GitHub Pages lama telah dihapus agar tidak
ada dua jalur deployment yang saling tumpang tindih.

File `public/_headers` menetapkan anti-framing, MIME sniffing protection,
referrer policy, permissions policy, HSTS, dan immutable cache untuk aset build.

## Persistensi proses bisnis

IDA dan `/api/state` menggunakan D1 dan tidak membuat atau mengubah tabel legacy
`payments`.
`payment_instructions` beserta snapshot line terenkripsi menjadi satu-satunya
sumber payment. Pembuatan, approval, bukti, rekonsiliasi, PDF, dan file bank
dijalankan melalui API operating model canonical.

Sebelum deployment, buat secret production `PI_ENCRYPTION_KEY` dengan nilai acak
minimal 32 karakter. Jangan mengganti key tanpa prosedur rotasi karena snapshot
rekening yang sudah tersimpan memerlukan key yang sama untuk proses export.

## Catatan dependency

`npm audit` masih melaporkan advisory transitif dari Next.js/PostCSS/Sharp serta
advisory `xlsx`. Tidak ada upgrade kompatibel dari registry npm untuk seluruh
temuan tersebut pada audit ini. Mitigasi saat ini: static export, file Excel
maksimal 5 MB, validasi baris server-side, payload import dibatasi, dan tidak
memproses workbook di server. Pantau rilis upstream dan prioritaskan migrasi parser
Excel apabila versi aman yang kompatibel tersedia.


## Managed payroll operating API

Endpoint `/api/operating-model` menyediakan operasi terkontrol untuk service plan,
submission, exception, payment instruction, dan maker-checker approval. Semua
mutasi memerlukan same-origin/Cloudflare Access, role yang sesuai, validasi state,
client scope, serta idempotency key untuk payment instruction.

Setelah deployment kode, jalankan migrasi additive satu kali menggunakan sesi
`SUPER_ADMIN`:

```bash
curl -X POST https://proqpay-lite.pages.dev/api/schema \
  -H 'Origin: https://proqpay-lite.pages.dev'
```

Pada mode Cloudflare Access, gunakan sesi/token Access yang valid. Jangan mengubah
`AUTH_MODE` menjadi `origin` hanya untuk menjalankan migrasi.
