# P5.8.4 — UAT administrative closure and payment-workspace cleanup

The operator requested to treat old **UAT-only** data as completed to remove clutter. We interpret this as **simulation / administrative closure**, **not** a verified E2Pay payout. No fake `SETTLED`, `COMPLETED`, `PROOF_UPLOADED`, or provider transaction is created, and no original PI row, gateway account, bank snapshot, credential, or audit log is deleted or modified.

## Behavior

- D1 migration `0070` archives UAT PI provenance rows with no legacy gateway transaction and no Canonical DR. Immutable label: `UAT_ASSUMED_COMPLETE_NO_SETTLEMENT_EVIDENCE`. References and amount are preserved; `provider_settlement_verified=0` and `financial_execution_allowed=0`.
- Two D1 triggers prevent new `payment_gateway_transactions` or `disbursement_requests` for archived PI, blocking both old and new routes even with concurrent sessions.
- The payment workspace queries the authenticated, tenant-scoped archive API and excludes archived PI from primary PI/DR action queues and summary metrics. If archive visibility is unavailable, the payment/reconciliation screens fail closed rather than showing stale action buttons.
- Removes verbose `P5.8.2` and `P5.8.3` panels from active DR UI; removes top-level funding status tiles; Funding remains under Funding & Limit. Legacy history and diagnostics are accessible under small collapsed archive disclosures in Reconciliation and Payment Gateway Settings.
- Super Admin archive view explicitly says `UAT dianggap selesai secara administratif`, and labels the value as a simulation, **not actual provider settlement**. Archive has no action buttons.

## Evidence & caveats

- Full local regression / security tests, TypeScript, lint and static build must pass before PR merge.
- D1 snapshot/backup, migration and post-deploy aggregate audit must pass.
- Audit must confirm archived sources are still present, matched to UAT accounts, no gateway or Canonical DR collides, and false financial evidence count is zero.
- Historical source status may continue to read `PAYMENT_APPROVAL_PENDING` in raw database. This is intentional to protect immutable history, but the **operational UI is closed**; data is never reported as real provider-settled.
- Unknown E2Pay merchant credential and liquidity are still not ready; cannot run another payout against these archived PI. For new UAT, create a new separately approved payroll source after proper sandbox credentials are available.
