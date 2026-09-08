# ProQPay Lite — Seamless Payment Gateway Foundation

## Objective

Payment Gateway is an execution rail after an immutable Payment Instruction (PI) has passed maker-checker approval. It is not a replacement for PI, payroll approval, control totals, or reconciliation.

Canonical flow:

`Payroll -> PI -> Controller Approval -> APPROVED_FOR_PAYMENT -> Gateway Execution -> DISBURSEMENT_PROCESSING -> Signed Webhook -> Reconciliation -> COMPLETED`

## Current safety contract

- Only a PI with status `APPROVED_FOR_PAYMENT` may start a new gateway execution.
- `payment_approvals.action_hash` must equal the immutable PI `content_hash`.
- PI expected total must equal the sum of immutable payment instruction lines.
- Full beneficiary account numbers are decrypted only server-side immediately before adapter execution.
- Decrypted account numbers must never be logged or stored in gateway event payloads.
- Gateway execution uses a deterministic idempotency key derived from PI id + content hash.
- Only one active gateway transaction may exist for one PI.
- Webhooks are signature-verified before processing.
- Webhook amount and currency must match the transaction and immutable PI before completion.
- Provider event ids are unique to make webhook retries idempotent.
- Provider failure/expiry/cancellation moves the PI into `PAYMENT_EXCEPTION` instead of silently retrying money movement.

## Files

- `migrations/0020_payment_gateway_orchestration.sql` — transaction ledger and webhook event ledger.
- `functions/api/payment-gateway-core.js` — provider-neutral status/idempotency/signature contract and UAT MOCK adapter.
- `functions/api/payment-gateway.js` — authenticated execution/status API.
- `functions/api/payment-gateway-webhook.js` — signed provider webhook endpoint.
- `src/lib/payment-gateway-api.ts` — browser-side API client contract.
- `tests/payment-gateway-core.test.mjs` — safety regression tests.

## Environment

Production remains fail-closed by default:

```env
PAYMENT_GATEWAY_PROVIDER=UNCONFIGURED
PAYMENT_GATEWAY_ALLOW_MOCK=false
```

Secret configured only in Cloudflare, never committed:

```env
PAYMENT_GATEWAY_WEBHOOK_SECRET=...
```

`MOCK` exists only for UAT. It must not be enabled in production.

## API contract

### Read readiness/status

`GET /api/payment-gateway`

Optional query: `paymentInstructionId=<PI_ID>`.

### Start execution

`POST /api/payment-gateway`

```json
{
  "paymentInstructionId": "PI-...",
  "paymentMethod": "BANK_TRANSFER"
}
```

The authenticated actor must have `payment:prepare` permission.

### Webhook

`POST /api/payment-gateway-webhook`

The current UAT MOCK contract uses `X-Payment-Signature: sha256=<HMAC-SHA256(raw-body)>`. This is intentionally not assumed to be the production provider contract.

## Before connecting a real provider

1. Confirm the selected provider and obtain its official API + webhook specification.
2. Add a provider-specific adapter to `payment-gateway-core.js` (or split it into `payment-gateways/<provider>.js`).
3. Implement the provider's exact authentication and signature verification scheme; do not reuse MOCK HMAC unless the provider specification explicitly matches it.
4. Map provider create-payment response and webhook statuses to ProQPay states.
5. Add sandbox fixtures and contract tests from the provider documentation.
6. Configure provider secrets in Cloudflare Pages/Workers secrets.
7. Apply migration `0020` to UAT D1 first.
8. Run end-to-end UAT: approved PI -> execution -> duplicate request -> processing webhook -> duplicate webhook -> success -> reconciliation.
9. Verify failure, timeout, wrong signature, wrong amount, and wrong currency cases before production enablement.

## Production rule

Do not set `PAYMENT_GATEWAY_PROVIDER` to a real provider name until that provider-specific adapter and its contract tests are merged. Unknown providers intentionally return `PAYMENT_GATEWAY_NOT_READY`.
