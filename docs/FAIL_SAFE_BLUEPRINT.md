# Blueprint Fail-Safe ProQPay Lite

Owner: Tech Lead  
Delivery window: 14 hari  
Prinsip utama: kegagalan harus tertutup, dapat diulang dengan aman, dapat dilacak, dan tidak boleh menghasilkan pembayaran ganda atau status parsial.

## Invariant bisnis

1. `payment_instructions` adalah satu-satunya sumber pembayaran.
2. PI yang sudah dibuat immutable; koreksi menghasilkan versi/PI baru, bukan edit baris.
3. Total header = jumlah seluruh line = control total yang disetujui.
4. Content hash mencakup seluruh isi PI yang memengaruhi pembayaran.
5. Maker tidak boleh menjadi approver PI yang sama.
6. Proof yang sama tidak boleh dihitung dua kali.
7. Satu PI memiliki satu hasil reconciliation terkini.
8. Perubahan status PI dan submission harus satu transaksi.
9. Tanpa encryption key, database, atau storage yang sehat, operasi pembayaran gagal tertutup.
10. Periode payroll wajib eksplisit; tidak ada fallback diam-diam untuk operasi finansial.

## Failure policy

| Dependency/operasi | Timeout | Retry | Idempotency | Fail-safe result |
|---|---:|---:|---|---|
| Database read | 3 s | 2x, exponential+jitter | Request/query key | `503`, tidak mengubah state |
| Database transaction | 8 s | hanya serialization/deadlock, maks 2x | Business key/action hash | rollback penuh |
| R2 proof upload | 15 s | 2x untuk network/5xx | `(PI, bank, reference)` | hapus orphan bila DB gagal |
| Bank/PDF export | 15 s | aman untuk render immutable | PI content hash + format | jangan hasilkan file bila hash/key gagal |
| AI provider | 20 s | 1x untuk 429/5xx | request hash | circuit open; workflow manual tetap tersedia |
| Web enrichment | 8 s | 1x | URL/query hash | hasil diberi status degraded, bukan fakta final |
| Email/notification | async | 5x via queue | event ID | dead-letter; transaksi payroll tidak dibatalkan |

Retry tidak boleh dilakukan untuk validasi `4xx`, authorization, hash mismatch, atau business conflict. Semua retry memakai full jitter dan satu retry budget per request.

## State and transaction boundaries

- Generate PI: lock submission → validasi state/periode/rekening → snapshot encrypt → hitung hash/control total → insert PI+lines → update submission → audit; satu transaksi.
- Approve: lock PI → cek maker-checker/hash/total → insert approval idempotent → update PI+submission → audit; satu transaksi.
- Proof: cek business key → put R2 → transaksi insert proof+status+audit; bila transaksi gagal, kompensasi delete R2. Job harian menghapus orphan berumur >24 jam.
- Reconcile: lock PI → agregasi line/proof → upsert reconciliation → update PI+submission → audit; satu transaksi.
- Export: baca snapshot immutable dan verifikasi hash; tidak pernah membaca rekening aktif dari tabel employee.

## Circuit breaker

Untuk AI/web/integration connector: `CLOSED → OPEN` setelah 5 kegagalan dalam 60 detik; `OPEN` selama 30 detik; satu probe `HALF_OPEN`; kembali `CLOSED` setelah 3 sukses. Status circuit diekspos sebagai metric, bukan detail sensitif pada public health endpoint. Payment core tidak bergantung pada AI saat approval/export/reconciliation.

## Idempotency contract

- Header `Idempotency-Key` diwajibkan untuk generate, approve, proof metadata, reconcile, dan integration sync.
- Server menyimpan key, request hash, actor, response status/body digest, dan expiry minimal 30 hari untuk operasi finansial.
- Key sama + payload sama mengembalikan respons sebelumnya dengan `idempotentReplay: true`.
- Key sama + payload berbeda mengembalikan `409 IDEMPOTENCY_CONFLICT`.
- Constraint database adalah lapisan terakhir; aplikasi tidak hanya mengandalkan pre-check.

## Observability dan SLO

Semua respons membawa `X-Request-Id`; log terstruktur memuat request ID, actor ID, org/client, endpoint, action, PI/submission ID, latency, outcome, retry count, dan dependency—tanpa nomor rekening/plaintext secret.

Target awal:

- API availability bulanan 99,9% di luar maintenance terjadwal.
- p95 read <500 ms; p95 mutation <1,5 s, tidak termasuk upload/export.
- Duplicate payment instruction/proof: 0.
- Status partial antara PI dan submission: 0.
- Reconciliation matched dalam 24 jam setelah proof: ≥99%.
- Mean time to detect critical failure <5 menit; rollback <30 menit.

Alert: error rate >2%/5 menit, p95 melewati SLO 10 menit, circuit open, migration drift, orphan R2, PI stuck per state, hash mismatch, dan reconciliation lag.

## Security and recovery

- Simpan `PI_ENCRYPTION_KEY` di secret manager; rotasi memakai key version dan re-encryption job terkontrol.
- Jangan log account ciphertext, IV, atau plaintext nomor rekening.
- Backup database point-in-time; R2 lifecycle/versioning sesuai retensi legal.
- Rollback aplikasi tidak menghapus migrasi/data. Gunakan expand-contract migration dan feature flag untuk canonical PI.
- Runbook insiden: freeze generation/export → identifikasi request/PI terdampak → verifikasi hash dan audit trail → rollback/forward-fix → reconcile ulang idempotent → postmortem.

## Rencana 14 hari

| Hari | Deliverable | Acceptance criteria |
|---:|---|---|
| 1–2 | Inventory dan threat/failure model | Semua endpoint, dependency, state transition, dan data sensitif terpetakan. |
| 3–4 | Transaction/idempotency hardening | PI lama off; proof/reconcile constraints; concurrency tests lulus. |
| 5 | Migration safety | DDL keluar dari hot path; schema verification fail-closed; rollback script tersedia. |
| 6–7 | Timeout, retry, circuit breaker | Policy terimplementasi untuk AI/web/integration; chaos tests terukur. |
| 8 | Observability | Request ID, structured logs, SLI dashboard, dan alert aktif di staging. |
| 9 | Security/recovery | Secret/key rotation plan, redaction test, backup/restore drill. |
| 10–11 | Contract dan integration test | API contract, bank golden files, R2 failure compensation lulus. |
| 12 | E2E 396 penerima | Generate → preview → approval → bank file → proof → reconciliation matched. |
| 13 | Load/chaos/UAT | Retry storm, DB/R2/AI outage, double-submit, browser roles/periode diuji. |
| 14 | Go/no-go pack | Audit evidence, residual risks, runbook, sign-off Tech Lead/Finance/QA. |

KPI selesai bila tiga dokumen audit/API/blueprint disetujui, seluruh critical/high finding memiliki owner dan test evidence, serta staging melewati production gate tanpa pembayaran/status ganda.
