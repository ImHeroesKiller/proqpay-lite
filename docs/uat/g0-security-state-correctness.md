# G0 — Security & State Correctness (front-end browser + IDA)

## Scope / assurance

This is a **non-destructive D1/backend change**: no provider payout, D1 migration, PI, gateway credentials, settlement status, approval, or audit entry is modified. Only the **client browser mirror** and IDA local business-state paths are changed. The canonical Cloudflare D1 transactional APIs remain the only financial source of truth. Strict backend RBAC/MFA and maker-checker stay unchanged.

## Closed risks

1. The old `proqpay_db_v3`/`proqpay_db_v2` browser localStorage mirror held potentially sensitive employee/bank/payroll data across sessions. G0 **purges** historical browser mirror keys on mount, login, save, and logout; no longer persists operational data in browser storage. Reads before authentication return empty seed. Data is fetched again from D1 after `/api/me` verifies the identity.
2. The browser mirror is volatile, scoped by verified user ID, role, organization (if provided), client/project grants and a per-login generation counter. Actor/grant change and logout clear the mirror. Asynchronous D1 responses capture the previous generation and **cannot restore stale data** after a login transition—even when the same user re-logs in. Reload loses mirror by design, then repopulates from Cloudflare D1.
3. Legacy diagnostic logs (`proqpay_system_logs_v1`) and IDA session ID (`proqpay_ida_session`) no longer persist to localStorage. User appearance/preferences key (`proqpay_settings_v3`) is intentionally preserved. Client-side diagnostic logs are ephemeral, not a replacement for server audit.
4. API response caches now use `/api/me`'s verified `orgId`, user ID, role and client/project grants to build the cache namespace. Actor change/invalidation increments a cache generation; late responses cannot be inserted into a newer session's cache (including same-user re-login). A previous actor's in-flight request is **rejected** with `STALE_ACTOR_CONTEXT` and cannot update a new session's UI or cache.
5. IDA's `handleIdaIntent` no longer creates CALCULATED payrolls, APPROVED approvals, or SENT invoices / AR by editing a local snapshot. The user is directed to Canonical Pay Runs, Payment Instructions and Billing & AR; no fake status, no local mutation, no backdoor POST `/api/state` (already responds 410). The UI caller rejects any unexpected local-mutation result and reports an error. Server-authorized HR import, employee email fill, and admin operations are **still available through their existing APIs**.
6. Background canonical refresh, initial sync, IDA loads, authorized import and HR mutations all capture the current authentication generation before writing the volatile mirror. Failed directory/state/plan API responses (other than intentional 403 role-denial) throw instead of returning a misleading `synced:true` with empty business data. On invalid auth/explicit logout the mirror is cleared, relevant API cache is invalidated and no stale state is reused.

## Rollout / tests

- Required: `npm test`, `npm run lint` (0 errors), `npm run typecheck`, `npm run build` (static CSS + CSP hardening), strong-auth security regressions, PR CI and Cloudflare Pages.
- Focused G0 tests prove browser mirror cleanup, cache namespace/inflight invalidation, canonical sync failure behavior, same-actor re-login rejection, different-actor / tenant grant isolation, settings preservation, session/log cleanup, IDA no-write with confirmation strings and client `/api/state` rejection.
- E2E anonymous smoke test injects sentinel PII into browser localStorage before first boot and confirms purge without logging in or writing to any API. Authenticated cross-account/strong-MFA browser UI tests are separate and must be performed with authorized UAT sessions; do not bypass MFA.

## Known limitations & follow-up

- While sensitive data is visible to an authorized user, it necessarily exists temporarily in page/JS memory. G0 prevents persistent app-local storage, **not** screenshots, malicious browser extensions or OS crash dumps.
- In-flight privileged server requests that have already been received before logout are governed by backend transaction authorization/idempotency; this client cleanup does not alter provider execution or revoke a server-side token by itself.
- IDA now refuses local financial writes rather than silently pretending the canonical operation succeeded; future IDA write integrations require explicit server-backed, permissioned, MFA-aware action contracts.
- `G1` covers CSS cascade, `G2` covers unified URL/filter ownership and additional API lifecycle improvements; those are not represented as closed here.
