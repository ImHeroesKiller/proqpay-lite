# Playwright UAT Runner

GitHub Actions workflow `.github/workflows/playwright-uat.yml` menyediakan browser UAT yang dapat dipakai ulang untuk production maupun preview.

## Menambahkan skenario baru

1. Tambahkan spec baru di `tests/e2e/`.
2. Nama file wajib berakhir `.spec.mjs` atau `.spec.js`.
3. Jalankan **Actions → Playwright UAT Runner → Run workflow**.
4. Isi `target_url` dan `spec_path`.
5. Evidence otomatis disimpan 14 hari: HTML report, trace, screenshot, dan video saat gagal.

Contoh:

```
tests/e2e/invoice-billing-ar.spec.mjs
```

Workflow hanya menerima script di bawah `tests/e2e/`; raw shell/script dari input workflow tidak dieksekusi. Ini menjaga GitHub Secrets dari arbitrary-code injection.

## Authenticated UAT

Untuk test yang membutuhkan login, buat repository secrets:

- `PROQPAY_UAT_EMAIL`
- `PROQPAY_UAT_PASSWORD`

Kemudian jalankan workflow dengan `use_uat_credentials=true`. Spec membaca credentials dari environment dan tidak boleh mencetak nilainya ke log.

Contoh helper minimal:

```js
const email = process.env.PROQPAY_UAT_EMAIL;
const password = process.env.PROQPAY_UAT_PASSWORD;
```

Gunakan akun khusus UAT dengan privilege minimum. Jangan gunakan akun pribadi atau kredensial payment gateway untuk browser test.

## Safety contract

- Default runner bersifat non-destructive.
- Tidak ada retry otomatis untuk mencegah mutasi finansial terulang.
- Script baru harus menggunakan data UAT/dummy untuk operasi create/update.
- Jangan mengeksekusi payment/disbursement riil.
- Untuk flow finansial, utamakan assertion read-only atau fixture yang memang ditandai UAT.
