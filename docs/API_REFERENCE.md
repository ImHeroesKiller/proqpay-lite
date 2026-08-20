# ProQPay Lite API Reference

Base path: `/api`. Seluruh response JSON memakai security headers dan `Cache-Control: no-store`; file download memakai private/no-store. Mutasi hanya menerima same-origin request yang terautentikasi. Role: `SUPER_ADMIN`, `PAYROLL_PROCESSOR`, `PAYROLL_CONTROLLER`, `CLIENT_USER`.

## Endpoint catalog

| Endpoint | Method | Akses | Fungsi utama | Idempotency/fail-safe |
|---|---|---|---|---|
| `/login` | POST | Public | Membuat session | Rate limited; generic auth error. |
| `/logout` | POST | Authenticated | Menghapus session | Safe replay. |
| `/me` | GET | Authenticated | Actor, role, permission | No mutation. |
| `/health` | GET | Public | Health database, R2, AI/web/auth, PI key | Tidak membuka secret. |
| `/accounts` | GET/POST | Super admin; self password flow | User lifecycle/password | Transaction untuk perubahan sensitif. |
| `/clients`, `/client-projects` | GET/POST | Scoped by role/client | Client dan project | Scope enforcement; external fetch timeout. |
| `/client-delete` | POST | Super admin | Hapus client terkonfirmasi | Exact confirmation + transaction. |
| `/employees` | GET/POST | Scoped | Employee dan rekening utama | Unique primary-account constraint. |
| `/employee-email-fill` | POST | Authorized | Bulk email update | Transaction. |
| `/import` | POST | Processor/controller | Import payroll/employee | Payload limit + atomic import; period harus dibuat eksplisit. |
| `/operating-model-validation` | POST | Authorized | Validasi action payload | Tidak mengubah state. |
| `/operating-model` | GET | Scoped | Submission, PI, proof, reconciliation, report, integration | Filter org/client/project. |
| `/operating-model` | POST | Action-specific | Workflow payroll/payment | State machine, RBAC, transactions. |
| `/payment-instruction-export` | GET | Super admin/controller | Preview, BCA/Mandiri/BRI/BNI/custom, PDF | Verifikasi content hash; fail closed tanpa key. |
| `/payment-proof` | POST | Super admin/controller | Upload proof multipart ke R2 | `(PI,bank,reference)` idempotent; R2 compensation. |
| `/payment-proof?id=` | GET | Scoped | Download proof | Private/no-store; client scope. |
| `/billing` | GET/POST | Role/action specific | Invoice, tax, AR | Transaction pada issue/payment/follow-up. |
| `/ida` | POST | Authenticated | Assistant orchestration | Rate/message limit; upstream failure `502/503`. |
| `/ida-web` | GET/POST | Internal/authenticated | Web enrichment | Timeout; degraded response. |
| `/state` | GET/POST | Authorized | Compatibility state | Legacy `payments` read/write dinonaktifkan. |
| `/schema` | POST | Super admin | Migration/bootstrap | Harus dijalankan saat deployment, bukan hot path. |
| `/reset` | POST | Super admin | Reset data terkontrol | Exact confirmation + transaction. |
| `/wilayah` | GET/POST | Authorized | Reference wilayah | Deterministic lookup/update. |

## Canonical Payment Instruction actions

Semua action dikirim sebagai JSON ke `POST /api/operating-model`.

| Action | Actor/permission | Input minimum | Success | Conflict/failure penting |
|---|---|---|---|---|
| `GENERATE_PAYMENT_INSTRUCTION` | Processor/controller sesuai policy | `submissionId` | `201`, PI immutable + lines + hash | `409` state/total/rekening; `503` encryption key. |
| `CREATE_PAYMENT_INSTRUCTION` | — | Legacy payload | — | Selalu `410 LEGACY_PI_WORKFLOW_DISABLED`. |
| `APPROVE_PAYMENT` | `payment:approve` | `paymentInstructionId`, `actionHash`, exact confirmation | Approval + status atomic | `409` maker=checker, hash/total mismatch. |
| `RECONCILE_PAYMENT` | Controller roles | `paymentInstructionId` | Current reconciliation (upsert) | `404` PI; safe replay/update. |

Export query:

`GET /api/payment-instruction-export?id={PI_ID}&format={preview|bca|mandiri|bri|bni|custom|pdf}`

Export hanya tersedia bila snapshot rekening lengkap, encryption key valid, dan content hash hasil rekalkulasi sama dengan PI. `preview` mengembalikan seluruh penerima yang sudah dimasking dan control total; format bank/PDF menghasilkan attachment.

## Payment proof multipart

`POST /api/payment-proof` menggunakan `multipart/form-data`:

| Field | Ketentuan |
|---|---|
| `paymentInstructionId` | PI valid pada organisasi actor. |
| `bank` | Nama/kode bank non-empty. |
| `reference` | Referensi transaksi unik per PI+bank. |
| `transactionDate` | `YYYY-MM-DD`. |
| `amount` | Positive safe integer dalam unit Rupiah. |
| `file` | Tipe/ukuran sesuai validator, maksimal 5 MB. |

Replay referensi dan metadata yang sama mengembalikan `200` dengan `idempotentReplay: true`. Referensi sama dengan metadata berbeda mengembalikan `409`.

## Error contract

| HTTP | Makna |
|---:|---|
| 400/422 | Request atau business payload tidak valid. |
| 401 | Session tidak valid/expired. |
| 403 | Role, permission, origin, client, atau project scope ditolak. |
| 404 | Resource tidak ditemukan dalam scope actor. |
| 409 | State, hash, total, confirmation, atau idempotency conflict. |
| 410 | Workflow legacy sengaja dihentikan. |
| 413 | Payload/file terlalu besar. |
| 429 | Rate limit. |
| 500 | Internal failure dengan request ID; detail internal tidak dibuka. |
| 502/503 | Upstream/dependency/secret belum tersedia; operasi gagal tertutup. |

## Headers yang ditargetkan

- Request: `Content-Type`, cookie session, `Idempotency-Key` untuk mutasi finansial, dan `X-Request-Id` opsional.
- Response: `X-Request-Id`, `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, CSP/security headers, dan `Retry-After` untuk `429/503` yang dapat diulang.

Kontrak rinci per schema dapat dipublikasikan sebagai OpenAPI setelah policy idempotency header dan response envelope distandardisasi pada seluruh endpoint.
