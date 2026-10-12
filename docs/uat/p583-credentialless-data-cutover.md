# P5.8.3 — Credentialless Legacy Data Cutover (UAT)

## Explicit decision and safety boundary

The operator authorized **removal of the UAT account**, not deletion of original payroll/evidence. An existing PI (IDR 15,900,000) is linked to the legacy E2Pay UAT account by registry ID and immutable provider account snapshot. Physical deletion of that account **before cutting over the PI relationship** would orphan or alter the source of truth. Therefore **physical full-delete is not executed automatically**. This is a verified, additive **data-only migration**, not a provider credential bypass.

## Implemented

- D1 migration `0069_p583_credentialless_legacy_data_cutover.sql`: idempotent catalog of original UAT E2Pay subaccounts and linked immutable Payment Instructions with the **original source IDs**; project and tenant scoped; no credentials, bank numbers, beneficiary names, or encrypted account snapshots copied. Financial source tables remain authoritative and unchanged.
- The catalog's entries are immutable (`UPDATE`/`DELETE` fail closed), and never imply provider channel, funding, Controller approval, or payout readiness.
- Protected `GET /api/legacy-data-cutover` shows data-only status in new workflow, masking external sub-account IDs; client users denied; POST/DELETE rejected.
- An explicit UI panel **P5.8.3 UAT Data Cutover** shows UAT sources in Canonical Disbursement Workspace **even while merchant credentials remain unknown**. Existing P5.8.2 readiness checks still block financial CREATE/SUBMIT/APPROVE/EXECUTE without required credentials and funding.
- `P5.8.3 UAT Reset Eligibility (Read-Only)` workflow checks account count, PI references, legacy transaction references, canonical requests, and cutover catalog immutability without exposing entity IDs or account secrets.

## Delete/full reset plan (NOT EXECUTED)

1. Confirm UAT-only accounts with the exact client/project/environment scope; **never delete any production E2Pay account**.
2. Verify export backup and cryptographic backup-integrity report (Cloudflare D1 backup workflow); securely retain the original PI/snapshot and audit trail, including deleted historical evidence if any.
3. Verify the full reference closure (PI, gateway ledger, DR, provider session, limit reservations, reconciliation, audit); reject hard-delete if any protected financial references remain.
4. If the account is truly an orphan UAT fixture after reconciliation, a separately reviewed, scoped cleanup change may retire it without deleting master client, employee, PI, or audit data. The frozen provenance catalog would also require a separately reviewed archival policy rather than dropped triggers.
5. If users need **new UAT transfers**, re-onboard using the official E2Pay sandbox provisioning/OTP flow into a **new** authenticated scoped sub-account, establish confirmed channel, fresh balances, approved limits and Controller + MFA approval; never claim an old PI can automatically be rebound to a newly created account without a new explicit immutable source/approval process.

## Acceptance

Data view complete ≠ financial execution ready. Do not create a fake credential, auto-reset passkey/MFA, reactivate a provider channel from an undocumented code, reuse an immutable PI against a new account without Controller review, or replay old gateway transfers.
