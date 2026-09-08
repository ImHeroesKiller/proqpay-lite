# ProQPay Lite — Seamless + Hosted Payment Gateway Foundation

## Objective

Payment Gateway is an execution rail after an immutable Payment Instruction (PI) has passed maker-checker approval. It is not a replacement for PI, payroll approval, control totals, or reconciliation.

ProQPay supports two provider integration modes:

- **Seamless/API** — ProQPay server sends execution directly to the provider adapter.
- **Hosted Payment/Hosted Checkout** — ProQPay creates a provider-hosted session and redirects the authenticated browser to the provider page.

Both modes use the same canonical PI, transaction ledger, signed webhook, and reconciliation flow.

Canonical flow:

`Payroll -> PI -> Controller Approval -> APPROVED_FOR_PAYMENT -> Gateway Execution/Hosted Session -> DISBURSEMENT_PROCESSING -> Signed Webhook -> Reconciliation -> COMPLETED`

## Current safety contract

- Only a PI with status `APPROVED_FOR_PAYMENT` may start a new gateway execution.
- `payment_approvals.action_hash` must equal the immutable PI `content_hash`.
- PI expected total must equal the sum of immutable payment instruction lines.
- Full beneficiary account numbers are decrypted only server-side for seamless execution.
- Decrypted account numbers must never be logged, sent to the browser, embedded in hosted URLs, or stored in gateway event payloads.
- Gateway execution uses a deterministic idempotency key derived from PI id + content hash.
- Only one active gateway transaction may exist for one PI.
- Webhooks are signature-verified before processing.
- Webhook amount and currency must match the transaction and immutable PI before completion.
- Provider event ids are unique to make webhook retries idempotent.
- Provider failure/expiry/cancellation moves the PI into `PAYMENT_EXCEPTION` instead of silently retrying money movement.

## Hosted Payment safety contract

- Hosted mode is disabled independently with `PAYMENT_GATEWAY_HOSTED_ENABLED=false` by default.
- A hosted session is bound to one immutable PI and one gateway transaction.
- Browser return paths must be relative application paths and must match `PAYMENT_GATEWAY_HOSTED_RETURN_PREFIXES`.
- Every hosted session receives a cryptographically random state nonce; only its SHA-256 hash is stored in D1.
- Hosted sessions expire between 5 and 60 minutes; default is 15 minutes.
- The provider checkout URL is created only by the server-side provider adapter.
- Browser return is **not proof of payment** and cannot mark a PI paid/completed.
- `/api/payment-gateway-hosted-return` only validates state, records the browser return, and redirects back to ProQPay.
- Only a verified signed webhook can produce `SUCCEEDED`, reconciliation `MATCHED`, and final `COMPLETED`.

## Files

- `migrations/0020_payment_gateway_orchestration.sql` — transaction ledger and webhook event ledger.
- `migrations/0021_hosted_payment_sessions.sql` — hosted checkout session ledger, expiry and state hash.
- `functions/api/payment-gateway-core.js` — provider-neutral status/idempotency/signature contract and UAT MOCK adapter.
- `functions/api/payment-gateway.js` — authenticated seamless execution/status API.
- `functions/api/payment-gateway-hosted-core.js` — hosted readiness, return allowlist, nonce/state and UAT adapter contract.
- `functions/api/payment-gateway-hosted.js` — authenticated hosted session create/status API.
- `functions/api/payment-gateway-hosted-return.js` — state-validated browser return endpoint.
- `functions/api/payment-gateway-webhook.js` — signed provider webhook endpoint for both seamless and hosted flows.
- `src/lib/payment-gateway-api.ts` — browser-side API client contract.
- `tests/payment-gateway-core.test.mjs` — gateway safety regression tests.
- `tests/payment-gateway-hosted.test.mjs` — hosted return/state/TTL/allowlist regression tests.

## Environment

Production remains fail-closed by default:

```env
PAYMENT_GATEWAY_PROVIDER=UNCONFIGURED
PAYMENT_GATEWAY_ALLOW_MOCK=false
PAYMENT_GATEWAY_HOSTED_ENABLED=false
PAYMENT_GATEWAY_HOSTED_TTL_SECONDS=900
PAYMENT_GATEWAY_HOSTED_RETURN_PREFIXES=/,/operations,/payments
```

UAT MOCK hosted checkout additionally requires a controlled simulator origin:

```env
PAYMENT_GATEWAY_PROVIDER=MOCK
PAYMENT_GATEWAY_ALLOW_MOCK=true
PAYMENT_GATEWAY_HOSTED_ENABLED=true
PAYMENT_GATEWAY_MOCK_HOSTED_ORIGIN=https://controlled-uat-hosted.example
```

Secret configured only in Cloudflare, never committed:

```env
PAYMENT_GATEWAY_WEBHOOK_SECRET=...
```

`MOCK` exists only for UAT. It must not be enabled in production.

## API contract

### Seamless readiness/status

`GET /api/payment-gateway`

Optional query: `paymentInstructionId=<PI_ID>`.

### Start seamless execution

`POST /api/payment-gateway`

```json
{
  "paymentInstructionId": "PI-...",
  "paymentMethod": "BANK_TRANSFER"
}
```

### Hosted readiness/status

`GET /api/payment-gateway-hosted`

Optional query: `paymentInstructionId=<PI_ID>`.

### Create Hosted Payment session

`POST /api/payment-gateway-hosted`

```json
{
  "paymentInstructionId": "PI-...",
  "returnPath": "/?view=payments"
}
```

The response contains `session.checkout_url`. Frontend can redirect with `openHostedPayment()` from `src/lib/payment-gateway-api.ts`.

The authenticated actor must have `payment:prepare` permission.

### Hosted browser return

`GET /api/payment-gateway-hosted-return?sessionId=...&state=...`

This endpoint never accepts payment status from query parameters. It returns the browser to the allowlisted ProQPay path with `payment=processing` while the UI waits for signed webhook synchronization.

### Webhook

`POST /api/payment-gateway-webhook`

The current UAT MOCK contract uses `X-Payment-Signature: sha256=<HMAC-SHA256(raw-body)>`. This is intentionally not assumed to be the production provider contract.

## Before connecting a real provider

1. Confirm the selected provider and obtain its official Seamless/API and Hosted Payment specifications.
2. Implement the provider-specific seamless adapter only if direct execution is supported.
3. Implement the provider-specific hosted session/create-checkout adapter and validate the returned URL contract.
4. Implement the provider's exact authentication and webhook signature verification scheme; do not reuse MOCK HMAC unless the provider specification explicitly matches it.
5. Map provider create-payment/session response and webhook statuses to ProQPay states.
6. Add sandbox fixtures and contract tests from the provider documentation.
7. Configure provider secrets in Cloudflare Pages/Workers secrets.
8. Apply migrations `0020` and `0021` to UAT D1 first.
9. UAT seamless: approved PI -> execution -> duplicate request -> processing webhook -> duplicate webhook -> success -> reconciliation.
10. UAT hosted: approved PI -> create session -> duplicate create -> redirect -> valid return -> invalid state -> expiry -> signed success webhook -> reconciliation.
11. Verify failure, timeout, wrong signature, wrong amount, wrong currency, open redirect attempts, stale hosted state, and replay cases before production enablement.

## Production rule

Do not set `PAYMENT_GATEWAY_PROVIDER` to a real provider name or enable Hosted Payment until the exact provider adapter and contract tests are merged. Unknown providers intentionally remain unavailable.
