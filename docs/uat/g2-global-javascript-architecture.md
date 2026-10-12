# G2 — Global JavaScript Architecture and State Lifecycle Closure

## Baseline, goals and non-goals

Baseline: main G1 `5bd87a2ad39e574ff038e9729b017da3910ef511`. Scope: browser navigation and filter state; shared API response/error handling; prevent stale async UI overwrites and preserve deep links. Not a backend or financial transaction refactor: no migration, credential, PI, payment, provider call, D1 mutation, maker/checker change or MFA bypass. Route authorization continues to be resolved by `allowedViewsForRole`, `normalizeInternalRoute` and the backend.

## Routing single mutation contract

`src/lib/route-state.ts` is now the only direct `window.history.pushState/replaceState` writer in the ProQPay JS/TS sources. It exposes `patchRoute`, `routeParams`, `routeValue`, `subscribeRoute` (native popstate + in-app route-change event), `workspaceRouteFilters` and `patchWorkspaceFilters`. It preserves unrelated query params, hashes and history state; no-ops on unchanged URLs; accepts null to remove one key; and resets projectId when clientId changes. `src/app/page.tsx` owns *page and payroll stage* navigation once. `UnifiedPayrollWorkspace` calls parent `onNavigate` but cannot push a second stage URL. Funding account selection, PI panel selection, payroll dashboard drill-through and Audit Logs use the same URL mutation/notification contract.

Filters are shared by payroll/payment/close through a single URL projection; Back/Forward syncs parent, child stage and decision panel. The UI no longer clears a deep-linked client/project filter just because the initial submission list has not loaded or the API failed. Sidebar permissions and Controller-only payment execution are unchanged.

## API and async lifecycle

`src/lib/api-client.ts` introduces `ApiRequestError` (HTTP status, server code, correlationId) and `parseApiResponse`, `getJson` with a structured successful JSON contract; no implicit retry (important for disbursement unknown-result safety). Operating Model, legacy Payment Gateway and Integration Monitor adapters consume the same parser; E2Pay continues to use its provider-specific `E2PayApiError` with stage/provider diagnostics. High-security POSTs still invoke existing `fetchWithSecurityStepUp` and never auto-repeat.

`OperatingWorkspace` uses monotonically increasing request generation to discard asynchronous responses from obsolete mode/reload/unmounted views, including archive readiness. Its payment stage remains fail-closed when UAT archive cannot be verified; canonical DR AbortController is preserved. `SystemLogs` and `DirectoryManager` now abort superseded GETs and reject stale results before updating their state. Funding account UI rehydrates selection from URL on Back/Forward. G0 actor-scoped API cache is maintained.

## Evidence, test coverage and known residuals

- G2 Node tests validate push vs replace, preservation of period/funding/deep-link/account/fragment, Back/Forward event subscription, client/project dependencies, SSR safety, HTTP 401/403/409/429/5xx, invalid JSON, AbortSignal, and no implicit retry of failed APIs.
- Read-only isolated Playwright UAT uses **synthetic payroll user and mocked GET endpoints**. Navigates Payment → Payroll → Payment, Back/Forward, verifies restored Funding panel and period, confirms zero POST calls/page runtime errors. No real account or MFA bypass; financial role behavior is covered separately in security tests.
- Existing G0 actor isolation and maker/checker regression remain mandatory. `npm test`, lint, typecheck, build and Cloudflare security/deploy gates must pass.
- No claim is made that **every** app module has migrated to shared adapters; this bundle covers global shell, payroll, PI, Funding, Clients/Projects and Audit Logs. Gateway/E2Pay provider error specialization remains intentionally separate. Authenticated visual UAT and hard-to-reproduce network failures require ongoing observation; G3 is intended for component simplification, not another database/payment rewrite.
