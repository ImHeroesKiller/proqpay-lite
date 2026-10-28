# ProQPay v2 — implementation and UAT

Date: 28 October 2026. Baseline: `91f3410`. Feature branch: `feat/payroll-workspace-v2`.

## Result

Frontend redesign implemented against the two supplied visual references. Existing API consumers, permissions, business-stage derivation, immutable PI identity, canonical DR execution, diagnostics and E2Pay single-Master flow remain in place. No runtime mock data, backend, schema, remote data or production deployment changes.

## Changes

- Shared numbered process stepper, 28–32px titles, consistent 12–14px labels/content, existing brand tokens and scoped responsive CSS.
- Shared period/client/project/search controls. Period and payroll status group survive URL updates and refresh. Existing client/project reset contract remains unchanged.
- Removed redundant opening payroll card and embedded KPI/next-action surfaces; payroll table leads with client/pay run, period, business stage, net/THP, recipients and existing next action. Upload remains in header; correction, adjustment, details, monitoring, invoicing and closing remain existing flows.
- Payment navigation uses real keyboard-operable tabs with an underline, separate from primary action buttons. PI columns expose document/client/project/period/amount/recipients/status/date/action; independent status control retained.
- DR columns expose canonical reference/source/client/project/method/amount/status/date/actions. Period scopes payroll DR via PI linkage, EWA via backend creation date; missing date/link is never guessed. Execution statuses and commands unchanged.
- Master metrics compact; readiness details collapse only when verified ready, and stay open when action is required. Provider routing remains available as secondary disclosure. Funding table adds project, approved/committed/remaining amounts and dates from existing fields; unavailable values show a dash.
- PI and payroll details use desktop side drawers and full-width mobile views. New reusable `DetailDrawer` supplies DR/limit dialog semantics, Escape, focus trap/restoration, scroll lock and outside-click dismissal. Existing provider support JSON and recipient pagination preserved.
- Generic data tables paginate at 25 rows. Mobile payroll retains the existing card list; wide financial tables scroll within their container.
- Legacy CSS hashes unchanged; a single feature module is registered before the final accessibility stylesheet. Existing source-based visual assertions updated for the intentionally changed column/period/cascade contracts; security assertions retained.

## Local validation

| Gate | Result |
| --- | --- |
| Baseline node tests | 1104/1104 PASS |
| Final node tests | 1104/1104 PASS |
| TypeScript | PASS |
| ESLint | 0 errors; 62 pre-existing warnings |
| Production static build | PASS |
| Legacy CSS + compiled CSS integrity | PASS |
| Static CSP hardening | PASS |
| Cloudflare native preflight | 9/9 PASS |
| Browser UAT | 9/9 PASS |
| Responsive viewports | 1440, 1024, 768, 390, 360px PASS |
| Runtime browser errors | 0 |
| Visual navigation writes | 0 |

Browser tests use explicit local-only API interception and block outside origins. They exercise SUPER_ADMIN, PAYROLL_PROCESSOR, PAYROLL_CONTROLLER and CLIENT_USER; Master setup, limit request/approval, PI approval failures, fresh balance checks, MFA step-up, DR approval, interrupted execution recovery and failed-batch non-retry. These are simulated financial actions, not provider settlement evidence.

Five viewport tests cover payroll → PI → DR → funding, period and group URL state, refresh, Arrow-key tab navigation, drawer Escape/focus, style semantics, and bounded page/funding width. Before and after screenshots use the same clearly synthetic data (`Klien Pengujian`, `Project Pengujian`, example.test identities); amounts in screenshots are test fixtures. Application runtime still reads existing backend APIs.

## Screenshot comparison

| Surface | Before | After |
| --- | --- | --- |
| Payroll | [before](screenshots/payroll-before.png) | [after](screenshots/payroll-after.png) |
| Payment Instructions | [before](screenshots/pi-before.png) | [after](screenshots/pi-after.png) |
| Disbursement | [before](screenshots/disbursement-before.png) | [after](screenshots/disbursement-after.png) |
| Funding | [before](screenshots/funding-before.png) | [after](screenshots/funding-after.png) |

[Mobile payroll](screenshots/payroll-mobile.png) · [Mobile funding](screenshots/funding-mobile.png) · [Mobile drawer](screenshots/drawer-mobile.png)

## Deployment and remaining acceptance

Feature preview workflow runs tests, typecheck, lint, preflight, build, browser UAT, uploads evidence, then deploys a non-main branch to existing Pages project `proqpay-lite`. No migrations, binding edits or production deployment steps. CI status and resulting preview URL must be verified after PR creation; not inferred from local success.

Preview and production currently share DB/R2; preview also lacks production secret configuration. Do not execute real payment or write-based UAT on the shared preview. Authenticated, real-data/provider integration UAT remains pending in an appropriately isolated environment with existing authentication and approvals. No authentication weakening or credentials copied to preview.

Existing API supplies limit request/approval metadata, not a complete allocation event stream; detail displays available records without inventing history. Existing PI/provider diagnostics remain accessible. Automated keyboard checks are covered; full screen-reader audit and user sign-off remain pending. Existing 62 lint warnings remain outside scope.

Production readiness: hold until CI/preview verification, authenticated UAT, visual acceptance and explicit Ary approval. Never merge main or deploy production from this task automatically.
