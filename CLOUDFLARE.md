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
| `DATABASE_URL` | secret | Connection string Neon |
| `GEMINI_WORKER_1..5` | secret | Kunci fallback Gemini |
| `NODE_VERSION` | variable | `22` |
| `APP_ORIGINS` | variable | Origin tambahan, dipisahkan koma |
| `DEFAULT_ORG_ID` | variable | Organization scope default untuk API operasional |
| `CLIENT_SCOPE_JSON` | variable | Pemetaan email CLIENT_USER ke daftar client ID |

Connection string Neon yang pernah dibagikan harus dirotasi. Rotasi juga semua
kunci Gemini yang pernah muncul di log/chat. Jangan commit nilainya ke repo.

## Mode keamanan

Default aplikasi adalah `AUTH_MODE=origin` untuk kompatibilitas deployment lama.
Mode ini melindungi operasi mutasi dari request lintas-origin, tetapi **bukan**
autentikasi pengguna production.

Untuk production, buat Cloudflare Access self-hosted application yang melindungi
domain aplikasi, lalu set:

| Name | Contoh |
|---|---|
| `AUTH_MODE` | `access` |
| `CF_ACCESS_TEAM_DOMAIN` | `https://nama-team.cloudflareaccess.com` |
| `CF_ACCESS_AUD` | Application Audience tag dari Access |
| `ROLE_MAP_JSON` | `{"admin@contoh.id":"SUPER_ADMIN","hr@contoh.id":"HR"}` |
| `APP_ORIGINS` | `https://proqpay-lite.pages.dev` |

Binding R2 production wajib bernama `PAYMENT_PROOFS` dan mengarah ke bucket
private `proqpay-payment-proofs`. Bukti pembayaran diunggah melalui
`POST /api/payment-proof` (multipart, PDF/JPG/PNG, maksimal 5 MB) dan hanya
dapat diunduh melalui `GET /api/payment-proof?id=...` setelah otorisasi role
dan client scope. Object key tidak pernah dikirim sebagai URL publik.

Role utama yang dikenali: `PAYROLL_PROCESSOR`, `PAYROLL_CONTROLLER`, dan
`CLIENT_USER`. Role lama `SUPER_ADMIN`, `PAYROLL`, `HR`, `FINANCE`, `DIRECTOR`,
dan `VIEWER` tetap dipertahankan untuk kompatibilitas. Email yang tidak ada di `ROLE_MAP_JSON` mendapat role `VIEWER`.
Jika konfigurasi Access tidak lengkap, API gagal tertutup dengan HTTP 401.

Hak akses API:

| Endpoint | Akses |
|---|---|
| `GET /api/health` | publik, respons disanitasi |
| `GET /api/me` | identitas, role, dan permission pengguna aktif |
| `GET /api/employees` | semua role terautentikasi |
| `POST /api/employees` | `SUPER_ADMIN`, `HR`, `PAYROLL` |
| `POST /api/import` | `SUPER_ADMIN`, `HR`, `PAYROLL` |
| `POST /api/schema` | `SUPER_ADMIN` |
| `/api/ida`, `/api/wilayah` | semua role terautentikasi |
| `GET /api/state` | membaca state payroll, invoice, payment, AR, dan audit |
| `POST /api/state` | `SUPER_ADMIN`, `PAYROLL`, `FINANCE`, `DIRECTOR` |

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

Setelah mengaktifkan Access, panggilan tanpa sesi Access harus menghasilkan 401
untuk endpoint yang dilindungi.

## Quality gate dan header

GitHub Actions menjalankan tes, typecheck, lint, dan production build pada setiap
push ke `main` dan pull request. Deployment production tetap dilakukan oleh
integrasi Git Cloudflare Pages; workflow GitHub Pages lama telah dihapus agar tidak
ada dua jalur deployment yang saling tumpang tindih.

File `public/_headers` menetapkan anti-framing, MIME sniffing protection,
referrer policy, permissions policy, HSTS, dan immutable cache untuk aset build.

## Persistensi proses bisnis

Aksi IDA untuk payroll, approval, payment instruction, paid, invoice, piutang,
dan audit disinkronkan ke Neon melalui `/api/state`. Endpoint menggunakan
transaksi atomik, validasi ukuran serta identifier, dan role enforcement.
`localStorage` tetap menjadi mirror offline; saat koneksi pulih, state Neon
digunakan kembali pada sinkronisasi dashboard.

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
