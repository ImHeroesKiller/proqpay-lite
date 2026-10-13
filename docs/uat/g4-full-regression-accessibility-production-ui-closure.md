# G4 — Full Regression, Accessibility & Production UI Closure

## Baseline and scope

Baseline G3 production: `bed6ca42ec969036bc70e847c3b5b7c7f31b4fc4`. G4 closes **automated frontend regression, semantic structure, keyboard navigation and WCAG 2.1 AA audit** for the current ProQPay UI. It does **not** execute a payment, approve a payment instruction, change E2Pay credentials, call an authenticated payout endpoint, migrate D1, alter the provider, or weaken RBAC/MFA. It uses GET-only synthetic-role fixtures for UI tests; all POST/PATCH/DELETE requests are blocked by the browser harness.

## Coverage and acceptance matrix

| Category | Automated scope | Gate |
|---|---|---|
| Role / view | SUPER_ADMIN (12), PAYROLL_PROCESSOR (5), PAYROLL_CONTROLLER (4), CLIENT_USER (3) | 24 role/view combinations |
| Responsive | 1440x900 (24 combos), 390x844 (24), 320x720 (12 Super Admin) | **60 total role/view/viewport checks** |
| Accessibility | axe-core WCAG 2 A/AA, WCAG 2.1 A/AA, best practices, landmark, heading structure, input labels, color contrast, page errors, responsive horizontal overflow | No violations / no unintended overflow |
| Theme | Dark and high-contrast, 6 routes each on desktop and mobile | **24 additional route/theme/viewport checks** |
| Keyboard | Shared tabs, Reports tabs, Home/End, arrows, roving tabIndex, modal nested Escape, focus trap, focus restore, body unlock | Playwright enforced |
| G0–G3 | Browser storage/auth boundary, legacy CSS contract, payroll URL/Back/Forward, compact directory/payment UI, modal interactions | All preserved |
| Production public checks | Release commit, D1 readiness, CSP frame-ancestors, HSTS, anonymous 401/403 for protected APIs and responsive unauthenticated login | GET-only production requests |

These checks do not prove the visual contents of authenticated production business data; the test identities and response bodies are synthetic and clearly isolated from real sessions. Real bank/provider execution and actual MFA-authenticated end-to-end UAT require the authorized user and are separately controlled.

## Implementation details

- **Canonical G1 cascade retained**: the original foundation and polish SHA-256 hashes are identical. A new explicit final `styles/accessibility.css` module provides WCAG color contrast fixes in the light, dark, and high-contrast themes without changing layout geometry. G1 architecture checker validates the new terminal module.
- **Accessible tabs**: both `UnifiedSystem.Tabs` and the independent Reports tablist now use roving tabIndex, selected state, ArrowLeft/ArrowRight, Home and End with focus synchronization, preserving original `onChange` / business filters and URLs.
- **Semantic UI**: accessible H1 only where missing in the workspace router (does not replace the user's established visual headings), semantic Employee Directory table-header text, canonical register heading order, keyboard-focusable scrollable readiness summary, meaningful integrated control labels and unique grouped pagination in Integrations.
- **Theme and branding**: legacy sidebar in dark mode now renders on an appropriate dark background rather than white, and key surface text uses accessible contrast tokens. Existing compact filter heights, flat master/Payment Instruction metrics, columns, and role-specific routes remain unchanged.
- **Deployment gate**: `.github/workflows/g4-accessibility-gate.yml` runs on relevant PR changes, installs pinned test-only Playwright and axe-core, builds the unchanged production CSP static export, and executes read-only accessibility + keyboard tests using a local server and synthetic role data. Its test-only `bypassCSP` permits axe injection only in isolated Playwright; the actual production CSP is never changed for test purposes.

## Evidence and operational residuals

- After G4 changes, `npm test`: **995/995 PASS** (includes four new G4 architecture tests). Typecheck, lint (zero errors), and Next.js build/CSS/CSP checks PASS. Historical lint warnings remain and are not claimed to be fully eliminated.
- Matrix Playwright: **9/9 test groups PASS**, 60 route-role-viewport checks, no axe violations and no page errors with GET-only fixtures. Theme matrix: **4/4 PASS** across 24 theme-route-viewport checks, including reduced-motion transition stabilization prior to contrast measurement.
- Shared and Reports keyboard: 2/2 PASS. Cross-bundle G0–G4 synthetic browser regression: 9/9 PASS. Anonymous production security/login predeploy: 4/4 PASS against the then-current G3 release. Postdeployment results must be checked separately against the new release SHA before status is CLOSED.
- **Still required for full operational signoff**: a supervised production authenticated session for relevant Processor/Controller/Client roles, MFA/permission verification, and non-mutating walkthrough using actual tenant data. These must not be silently conflated with synthetic browser tests. No real payout, balance transfer, disbursement approval, or live provider call belongs to this UI-only G4 bundle.
