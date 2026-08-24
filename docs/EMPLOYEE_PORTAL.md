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

Login ESS berikutnya (Fase 1 lanjutan di repo ESS): Worker ESS memanggil Lite, bukan PIN bersama.

Env: `EMPLOYEE_PORTAL_ORIGINS`, `EMPLOYEE_SESSION_HOURS`, opsional `EMPLOYEE_PORTAL_KEY`.
