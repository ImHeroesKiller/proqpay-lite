# Migrasi Native Cloudflare

## Target

- Pages + Pages Functions: frontend dan API.
- D1 (`DB`): seluruh data relasional dan transaksi.
- R2 (`FILES`): PI PDF, bank file, proof, dan attachment.
- Durable Objects: lock/idempotensi generasi dan submission PI.
- Queues (`DOCUMENT_QUEUE`): pekerjaan PDF dan bank file.
- KV (`CACHE`): cache non-kritis; bukan sumber data pembayaran.
- Workers AI + Vectorize: IDA dan knowledge retrieval.
- Secrets: `PI_ENCRYPTION_KEY` dan credential sensitif.

`payment_instructions` adalah satu-satunya sumber pembayaran. Schema D1 tidak
membuat tabel legacy `payments` dan `approvals`.

## Tahapan cutover

1. Terapkan `migrations/0001_cloudflare_native.sql` pada D1 non-production.
2. Migrasikan API per bounded context: auth, master, payroll, PI, billing, IDA.
3. Export hanya data aktif dari Neon ke NDJSON, transform JSON/timestamp/boolean,
   lalu import sesuai urutan foreign key.
4. Bandingkan row count, total finansial, dan content hash per PI.
5. Jalankan shadow-read terhadap D1 tanpa mengubah respons production.
6. Bekukan write singkat, lakukan delta import, lalu ubah `DATA_BACKEND=d1`.
7. Jalankan UAT 396 penerima: payroll -> approval -> PI -> bank file -> proof -> reconciliation.
8. Pertahankan Neon read-only selama masa rollback. Hapus setelah sign-off.

## Status implementasi

- Fase 1 selesai: schema D1, binding blueprint, health-check, dan guardrail PI.
- Fase 2 selesai secara lokal: auth/session, user & role, klien/proyek, dan master
  karyawan sudah D1-only.
- Fase 3A selesai secara lokal: operating model payroll, snapshot PI, approval,
  export bank/PDF, proof R2, dan reconciliation sudah memiliki jalur D1 native.
- Fase 3B selesai secara lokal: import payroll massal, billing/AR, proyeksi state
  read-only, IDA RAG/memory D1, serta inference Workers AI sudah native Cloudflare.
- Fase 3C selesai secara lokal: fallback runtime Neon dan helper Gemini dihapus,
  dependency Neon dilepas, serta seluruh API utama fail-closed bila D1 tidak tersedia.
  Endpoint schema/reset/purge legacy mengembalikan `410`; snapshot PI dan approval
  trail tidak dapat dihapus melalui API administrasi.
- Belum cutover: data aktif harus dimigrasikan dan diverifikasi sebelum UAT production.

## Guardrail

- Tidak ada DDL pada request runtime.
- Semua query memakai prepared statement D1.
- Operasi multi-statement penting memakai `DB.batch()` atau Durable Object.
- Baris snapshot PI tidak dapat diubah atau dihapus oleh trigger.
- Nomor rekening hanya disimpan sebagai ciphertext + IV pada snapshot PI.
- KV tidak boleh menyimpan rekening, payroll detail, session authority, atau PI.
- Cutover dibatalkan jika count, nominal, atau hash berbeda.

## Konfigurasi

Salin `wrangler.example.toml` menjadi `wrangler.toml` setelah resource Cloudflare
dibuat dan ID binding tersedia. Jangan commit secret ke repository.

Binding wajib pada Pages Functions: `DB` (D1), `FILES` (R2), dan `AI`
(Workers AI). `PI_ENCRYPTION_KEY` tetap disimpan sebagai secret.

Perintah lokal/preview:

```sh
npx wrangler d1 migrations apply proqpay-lite-production --local
npx wrangler pages dev out --d1 DB=proqpay-lite-production
```

Perintah production hanya dijalankan setelah backup dan persetujuan cutover:

```sh
npx wrangler d1 migrations apply proqpay-lite-production --remote
```
