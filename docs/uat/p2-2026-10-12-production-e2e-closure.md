# ProQPay P2 — Full Authenticated E2E & Visual Regression Closure

Date: 2026-10-12 (Asia/Jakarta)

## Verified baseline

- Production release at audit start: `c156204b5e311696448f5797e2858db249035154` (P1.C).
- Production `/api/health`: `ready=true`, `database=d1`, `auth_mode=session`.
- Browser: headless Chromium, live production custom domain, 1440×900, 390×844, 320×720.
- Anonymous browser: 4/4 PASS; public login shell has no horizontal overflow or page errors; protected payroll/payment/funding/channel/transaction GET APIs return 401/403.
- Full local unit/integration/financial safety regression: 939/939 PASS at P2 runner patch baseline. Production code is unchanged by this bundle.
- Quality: eslint, typecheck, build/CSP verification PASS.

## Authenticated UAT evidence and blocker

- Prior Playwright UAT with stored credentials failed to reach application sidebar. The general error message alone was inconclusive.
- A one-attempt, status-only diagnostic on existing UAT credentials **confirmed** `/api/login` HTTP **428 `PASSKEY_REQUIRED`**, about 3 seconds response time.
- This is **not a frontend/backend timeout**. Privileged account requires a registered passkey; CI runner cannot supply the user's interactive security key/platform authenticator.
- **No bypass, passkey reset, MFA disable, session replay, or production funds transfer attempted.**
- Authenticated all-module desktop/mobile visual UAT: **BLOCKED_PASSKEY_REQUIRED**, NOT PASS.
- Independent Payroll Processor and Payroll Controller role sessions: **NOT VERIFIED** (role-specific authenticated evidence still required).
- Three intent provider E2E (Payroll Direct, Payroll Corporate, EWA Direct) through live disbursement: **NOT EXECUTED**; contract regressions are not substitutes for provider settlements.

## Security incident prevented in UAT evidence pipeline

- Legacy Playwright failure traces and error-context captured filled login inputs. The affected artifact from UAT run `38244457637` was permanently deleted from GitHub Actions (artifact `11744487593`) and the local download was removed.
- The runner is hardened to disable trace/screenshot/video when credentials are enabled and to **never upload** HTML/test artifacts for credential-mode runs. Only sanitized status and error code are emitted to CI logs.
- Credentialed audit run `38245783462` had **zero uploaded artifacts**.
- **Rotate the affected UAT user's password and refresh the associated GitHub secret** as defense in depth before next supervised authenticated UAT. Do not expose passwords, MFA secrets, passkey challenges, or cookies in issue bodies or artifacts.

## Closure acceptance matrix

| Area | Result | Remaining acceptance evidence |
| --- | --- | --- |
| Production release / health / security headers | PASS | Continue monitoring after merge |
| Anonymous API/tenant boundary | PASS (401/403) | Role-specific authenticated tenant scoping |
| Desktop/mobile public visual 1440/390/320 | PASS | Authenticated payment workspace visual |
| Credential-safe Playwright runner | PASS | Keep sensitive artifacts disabled |
| Login response latency and classification | PASS (428 PASSKEY_REQUIRED) | Authenticated passkey completion |
| Processor PI → Canonical DR submit | BLOCKED | Privileged Processor browser session |
| Controller review, maker-checker, MFA approval | BLOCKED | Separate Controller browser session |
| Funding, subclient, limit, legacy recovery | BLOCKED | Authenticated scope/readiness check |
| Channel Mapping 3 intents, provider evidence | BLOCKED | Authenticated Super Admin view and provider confirmation |
| Transaction Register and reconciliation trail | BLOCKED | Authenticated real records, no forced financial action |
| Three real-provider execution intents | NOT RUN | Approved UAT accounts, E2Pay confirmation, balance/limit and controlled provider settlement; never trigger automatically |
| Full production operational sign-off | **NOT CLOSED** | All above completion and audit evidence |

## Next authorized continuation

1. Rotate the UAT password and update `PROQPAY_UAT_PASSWORD` in GitHub Actions secrets; preserve MFA/passkey configuration.
2. Complete passkey sign-in interactively on an authorized UAT browser; do not export live session cookies or browser storage to CI. Re-run role-aware desktop/mobile read-only test through a supervised authenticated session.
3. Verify the two distinct role sessions (Processor and Controller), including navigation, readiness, maker-checker segregation and finance API client scoping.
4. With E2Pay-approved UAT channel codes, subclient credentials and funded limits, separately authorize provider sandbox transactional E2E for all three intents; reconcile by `clientRef` and verify no duplicate settlement.
5. Only then mark P2 Full Authenticated E2E UAT & Visual Regression **CLOSED**.

## Evidence links

- [P2 public GitHub Playwright run](https://github.com/ImHeroesKiller/proqpay-lite/actions/runs/38245780022) — 4 PASS.
- [P2 authenticated diagnostic](https://github.com/ImHeroesKiller/proqpay-lite/actions/runs/38245783462) — blocked `PASSKEY_REQUIRED`, no uploaded artifacts.
- [Legacy UAT failure, sanitized by artifact deletion](https://github.com/ImHeroesKiller/proqpay-lite/actions/runs/38244457637) — not a pass.
