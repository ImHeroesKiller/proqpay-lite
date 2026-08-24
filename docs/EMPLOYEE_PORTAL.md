# Portal karyawan — Fase 1 (kredensial)

Payroll ops, PI, billing, dan import **tidak diubah**. Tabel baru hanya untuk login ESS.

## Password default

```
{PROJECT_SLUG}{JOIN_YYYYMMDD}
```

Contoh: project `NOC-P1`, join `2020-09-20` → `NOCP120200920`.

- `PROJECT_SLUG` = `projects.code` (fallback nama), huruf/angka uppercase, max 16.
- Tanggal unik = `join_date` → `accepted_date` → `employees.created_at`.
- Jika dua karyawan satu proyek + tanggal sama: tambah 4 karakter terakhir kode/NRK.
- Hash PBKDF2-SHA256 100.000 iterasi. Plaintext **tidak** disimpan.
- `must_change_password=1` sampai karyawan mengganti password (min 12, huruf besar/kecil, angka, simbol).

Karyawan **bukan** baris `app_users`. Cookie portal `proqpay_employee`, terpisah dari `proqpay_session`.

## Operasi

1. Terapkan migrasi: `migrations/0004_employee_portal.sql` (`wrangler d1 migrations apply`).
2. Di **Data Karyawan**, Super Admin / Processor tekan **Terbitkan password portal** (batch 10, UI mengulang sampai habis).
3. Unduh CSV sekali; bagikan ke HR. Tidak bisa dilihat lagi.
4. Reset per orang: detail karyawan → **Reset password portal**.

## API

| Method | Path | Siapa |
|---|---|---|
| GET/POST | `/api/employee-credentials` | Ops (`ISSUE`, `RESET`) |
| POST | `/api/employee/login` | Karyawan / ESS BFF |
| GET | `/api/employee/me` | Sesi portal |
| POST | `/api/employee/password` | Sesi portal |
| POST | `/api/employee/logout` | Sesi portal |
| GET/POST | `/api/employee/ewa` | Sesi portal (quote / ajukan / batal) |
| GET | `/api/portal-audit` | Ops: login ESS + jejak EWA |
| GET/POST | `/api/portal-settings` | Ops: aturan EWA, banner, teks, ads platform |

## Portal Settings (ESS dari Lite)

Semua aturan dan tampilan portal karyawan diatur di menu **Portal Settings**. Pay run / PI / billing tidak disentuh.

| Tab | Isi | Disimpan di |
|---|---|---|
| Aturan advance | on/off, % plafond, fee, fee min, hari kerja, masa kerja, tenor | `ewa_policies` |
| Banner / iklan | isi, CTA, tautan https, gambar, penempatan HOME/EWA/PAYSLIP, pixel | `portal_ads` |
| Teks portal | tagline, subjudul, copy kartu EWA | `portal_settings.copy_json` |
| Ads platform | NONE / GENERIC / Google Ads / Meta (pixel 1×1, tanpa JS pihak ketiga) | `portal_settings.ads_platform_json` |

Lingkup: default organisasi, atau override per klien. ESS membaca lewat `GET /api/employee/init`. URL berbahaya (`javascript:`, `data:`) dibuang di server.

## Fase 3 — batas Access dan audit

- CORS `/api/employee/*` memakai `EMPLOYEE_PORTAL_ORIGINS`, bukan `APP_ORIGINS`.
- Endpoint karyawan **tidak** membaca `Cf-Access-Jwt-Assertion`.
- Hostname ESS jangan masuk aplikasi Cloudflare Access ops.
- Menu Lite **Portal Audit** menampilkan `portal_login_attempts` dan `audit_logs` EWA/kredensial. Pay run / PI / billing tidak disentuh.

Env: `EMPLOYEE_PORTAL_ORIGINS`, `EMPLOYEE_SESSION_HOURS`, opsional `EMPLOYEE_PORTAL_KEY`.
