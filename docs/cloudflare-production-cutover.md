# Cloudflare Production Cutover

## Gate 0 — Wajib sebelum perubahan production

- Branch perubahan sudah direview, di-commit, dan tersedia pada remote.
- Wrangler v4 terautentikasi ke account pemilik Pages project.
- D1 production, R2 `proqpay-lite-files`, dan binding Workers AI teridentifikasi.
- Backup sumber data dibuat dan diuji dapat dibaca.
- `PI_ENCRYPTION_KEY` production tersedia; nilainya tidak ditulis ke repository/log.
- GitHub secrets `PROQPAY_BOOTSTRAP_ADMIN_EMAIL` dan
  `PROQPAY_BOOTSTRAP_ADMIN_PASSWORD` tersedia untuk bootstrap idempotent.
- Maintenance window dan rollback owner ditetapkan.

## Provisioning

1. Salin `wrangler.example.jsonc` menjadi `wrangler.jsonc` secara lokal.
2. Isi ID D1 dan KV berdasarkan resource yang benar.
3. Validasi dengan `wrangler check` dan `wrangler types --check`.
4. Pastikan Pages project memiliki binding `DB`, `FILES`, dan `AI` untuk Production.
5. Pastikan secret `PI_ENCRYPTION_KEY` tersedia pada Production.
6. Pastikan `AUTH_MODE=session` dan minimal satu Super Admin aktif sebelum deploy.

Jangan commit `wrangler.jsonc` bila memuat identifier environment aktual.

## Migrasi dan verifikasi

Workflow cutover aman dijalankan ulang. Target boleh berupa D1 kosong atau D1
canonical dari percobaan sebelumnya. Schema parsial, tabel non-canonical, serta
tabel legacy `payments`, `approvals`, dan `payrolls` akan menghentikan proses.
Setiap percobaan mengekspor backup D1 sebelum migration dilanjutkan.

```sh
node scripts/cloudflare-native-preflight.mjs
wrangler d1 migrations apply proqpay-lite-production --remote
wrangler d1 execute proqpay-lite-production --remote --file ops/d1-reconcile.sql
```

Import harus mengikuti urutan foreign key: organization, client, project, service
plan, employee master, compensation/bank, submission, PI, approval/proof,
reconciliation, invoice/AR. Data legacy `payments`, `approvals`, dan `payrolls`
tidak boleh diimpor.

## Acceptance gate

- Tidak ada mismatch recipient count, control total, atau content hash PI.
- Tidak ada karyawan dengan jumlah rekening utama selain satu.
- Health endpoint `ready=true` dan database `d1`.
- UAT 396 penerima berhasil dari import hingga reconciliation.
- Maker tidak dapat menyetujui PI miliknya sendiri.
- Bukti bayar dapat diunggah dan dibaca kembali dari R2.

## Rollback

Jika salah satu acceptance gate gagal, jangan aktifkan write production. Rollback
ke deployment sebelumnya dan pertahankan sumber lama read-only sampai investigasi
selesai. Jangan menghapus D1/R2 hasil migrasi; beri label sebagai failed cutover
untuk kebutuhan audit.
