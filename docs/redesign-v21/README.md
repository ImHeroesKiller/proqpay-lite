# ProQPay v2.1 — implementation and UAT report

Baseline: main `062b603132bd9d647c16a763b66e9443ac1f7d4a`. Feature branch: `feat/workspace-v21-refinement`. [Initial audit and functional preservation matrix](BASELINE.md).

## Result by area

| Area | Changes | Preserved functions |
| --- | --- | --- |
| Global | Compact numbered stepper, backend-derived completion, underline tabs, 38px filters, explicit reset, retained unavailable selections, consistent numeric columns | URL navigation, Back/Forward, role navigation and scope |
| Data & Payroll | Six-column table with sortable headers and shared pagination; compact stage/status hierarchy | Prepare, review, approve, adjustment, detail, status, invoice and closed-cycle links |
| Payment Instructions | Compact main table and status filter; duplicate security paragraphs removed | Immutable PI detail, maker-checker, approvals, proofs and audit |
| Disbursement | Shared table, concise empty state, separate error/retry, clear detail label | Controller approval/execution, MFA, Master/limit readiness, idempotency, recovery and reconciliation |
| Funding & Limit | Three compact metrics; seven-column allocation table; request amount in drawer; diagnostics/routes collapsed | Master refresh/activation, request, approve, reject, revoke, three automatic routes and historical evidence |
| Reconciliation | Primary register, explicit page-scoped metrics, filters, short copyable references and audit drawer | Provider reconciliation, beneficiary evidence, paginated attempts, support JSON, PI proof tools and legacy read-only archive |
| Settlement & Close | Dedicated tab, qualified payroll-matched metric, readiness drawer, existing confirmation, paginated closed history | Existing CLOSE_PAY_RUN contract, server permission/readiness enforcement and audit |
| Billing & AR | Dedicated invoice + AR tab; separate invoice/payment/delivery status; secondary tax/setup and AR diagnostics | Issue/review, email/resend, downloads, tax, payment/follow-up/history and issuer/client configuration |

Missing reconciliation evidence stays UNKNOWN. Successful execution never implies reconciliation. Close remains disabled unless fresh detail explicitly meets input, payroll, payment, reconciliation, invoice and critical-exception checks. Settlement totals are labelled as matched payroll amounts because this API does not provide a consolidated provider settlement balance.

## Reusable components

- `WorkspaceTable`: stable numeric/date/text sorting, search, numeric alignment, pagination, loading/error/empty, row actions and accessible sorting buttons. Canonical register keeps server pagination; its sort is explicitly page-scoped.
- `WorkspaceTabs`: keyboard arrows, Home/End, roving focus and selected-panel relationships.
- `ReferenceValue`: ellipsis with full title and copy feedback.
- `ReconcileCloseWorkspace`: URL-selected, separately mounted reconciliation / settlement / billing surfaces.
- `workspace-progress`: conservative process completion, close readiness and evidence-based invoice payment display.

Financial API handlers, authority matrix, schema, migrations and credential configuration are unchanged. Existing critical write handlers remain explicit user actions. No runtime fixtures or fake provider states were introduced.

## Validation

| Check | Local result |
| --- | --- |
| Node unit/integration/security suite | 1,108 passed, 0 failed |
| TypeScript | Passed |
| ESLint | 0 errors; 62 existing warnings (baseline also 62) |
| Static production build | Passed, built CSS verified and CSP hardened |
| Cloudflare native preflight | 9/9 passed |
| Four-role Master/limit/DR browser regression | 4 passed; Admin MFA, Processor request/reissue, Controller approval/MFA/execute/recovery, Client read-only |
| Shared modal, support evidence, role/accessibility, keyboard and dark/high-contrast matrix | 21 passed |
| v2.1 shared-table browser behavior | Passed; sorting, paging, search, loading, error and retry |
| v2.1 six viewport layouts and navigation | Passed at 1440, 1280, 1024, 768, 390 and 360px |
| Register failure/retry and unavailable selection | Passed; no error disguised as no data |
| Before screenshots | Captured at all six widths from the saved baseline build |

The combined browser run initially found dark-theme and populated PI badge contrast, plus a new test-selector collision with Next's route announcer. Both were corrected; the affected tests were rerun. A local generated Turbopack cache error was resolved by moving the generated cache aside and rebuilding. Populated desktop/mobile tables and the allocation drawer also pass axe WCAG checks. No failing gate was bypassed. CI repeats the complete 33 browser tests and publishes the full-resolution artifacts before preview deployment.

Visual fixtures use reduced motion for stable end-state captures. Screenshots and financial action tests use isolated local synthetic API responses and block external requests. They prove UI and policy wiring, not actual provider settlement. No real-money disbursement was performed.

## Screenshot comparison

These screenshots contain synthetic data only. Full PNGs at all six widths are also generated by the preview CI artifact. The previous close workspace showed all modules together; each new close tab is compared against that same combined baseline.

| Area | Before desktop | After desktop | Before mobile | After mobile |
| --- | --- | --- | --- | --- |
| Payroll | [1440](screenshots/before-payroll-1440.webp) | [1440](screenshots/after-payroll-1440.webp) | [390](screenshots/before-payroll-390.webp) | [390](screenshots/after-payroll-390.webp) |
| PI | [1440](screenshots/before-pi-1440.webp) | [1440](screenshots/after-pi-1440.webp) | [390](screenshots/before-pi-390.webp) | [390](screenshots/after-pi-390.webp) |
| Disbursement | [1440](screenshots/before-disbursement-1440.webp) | [1440](screenshots/after-disbursement-1440.webp) | [390](screenshots/before-disbursement-390.webp) | [390](screenshots/after-disbursement-390.webp) |
| Funding | [1440](screenshots/before-funding-1440.webp) | [1440](screenshots/after-funding-1440.webp) | [390](screenshots/before-funding-390.webp) | [390](screenshots/after-funding-390.webp) |
| Reconciliation | [Combined close](screenshots/before-close-1440.webp) | [1440](screenshots/after-reconciliation-1440.webp) | [Combined close](screenshots/before-close-390.webp) | [390](screenshots/after-reconciliation-390.webp) |
| Settlement & Close | [Combined close](screenshots/before-close-1440.webp) | [1440](screenshots/after-settlement-1440.webp) | [Combined close](screenshots/before-close-390.webp) | [390](screenshots/after-settlement-390.webp) |
| Billing & AR | [Combined close](screenshots/before-close-1440.webp) | [1440](screenshots/after-billing-1440.webp) | [Combined close](screenshots/before-close-390.webp) | [390](screenshots/after-billing-390.webp) |
| Allocation drawer | — | [1440](screenshots/after-drawer-1440.webp) | — | [390](screenshots/after-drawer-390.webp) |

## Deployment and remaining UAT

Preview deployment is feature-branch-only through `workspace-v21-preview.yml`; production remains on baseline `062b603`. CI and the deployment URL are recorded on the pull request when the run completes.

Cloudflare project `proqpay-lite` currently shares its D1 and R2 bindings between preview and production. Preview has no PI_ENCRYPTION_KEY. No bindings or secrets were changed or copied. Accordingly, do not perform payment writes or encrypted-payment UAT against this preview. A separate isolated backend and appropriate credentials are needed for financial end-to-end UAT. The public preview sign-in screen and release identity can be verified without logging in.

Recommendation: ready for UI review after green CI; production release remains subject to user approval and authenticated business UAT. Actual provider execution, production payroll data correctness, email delivery and financial settlement have not been revalidated by these synthetic tests.

## Changed files

[Exact file list](FILES.md). The pull request diff is authoritative. Changes are limited to the scoped workspace stylesheet, frontend workspace components, shared table/tab/reference helpers, route filter preservation, tests, this evidence folder and a dedicated preview workflow. No backend/API/schema files changed.
