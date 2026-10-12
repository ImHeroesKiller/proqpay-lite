# G3 — Global Component & Layout Standardization

## Baseline, authorization and data safety

Baseline production/main G2: `23d6a168bde7f7a7a5adab47e2a4186859dc13de`. G3 is a presentation-layer architecture bundle. **No D1 migrations, schema updates, customer/employee records, E2Pay credential updates, wallet funding, payout, PI mutation, maker/checker or MFA changes.** All finance data and role checks continue through canonical backend APIs. Only anonymous/isolation-mocked browser sessions are used for cross-role visual UAT; no production authenticated test credential is required.

## Shared primitives introduced

`src/components/layout/WorkspacePrimitives.tsx` centralizes:

- `WorkspaceFrame` for identical 1180px max-width / centered app content; `AppWorkspaceRouter` continues to isolate each page within `ModuleErrorBoundary` and preserves lazy-loaded route transitions.
- `WorkspaceTitle` for semantic H1/H2 headings, eyebrow and description, preserving domain wrapper CSS/heading text/inline variant styles. Consumed in Payroll Workspace (Processor/Controller), Employees, Clients & Projects, and standalone Operating Workspace (Super Admin and other roles). Existing operation title/eyebrow tokens continue to work.
- `CompactFilterSurface` for a semantic search-labelled *flat, cardless* compact filter grid in Clients & Projects. Existing 32px controls, search/status/client field logic and reset/pagination behavior are not changed.
- `InlineSummary` for two CSS-compatible modes: `strip` (Clients & Projects: 4 inline stats) and `decision` (Payment Instructions: 4 inline action metrics, with verified/unverified state preserved). Both render no metric cards and use the **existing** CSS class names / immediate-child selectors.

`BillingWorkspace`'s original view-only form, table, badge, panel, modal and style helpers are extracted unchanged to `src/components/billing/BillingViewPrimitives.tsx`, reducing the main file from 1,740 to ~1,603 lines. Existing action, status, tax, invoice, AR and close policy remain in the original component and shared `billing-ui` authority library. This is first-stage extraction; do not treat it as full decomposition of Billing's 1,600-line feature container.

## Accessible shared modal behavior

`src/components/ui/UnifiedSystem.tsx` `ModalShell` now:

1. Assigns a unique heading ID for `role="dialog"`, `aria-modal="true"`, `aria-labelledby`.
2. Moves keyboard focus into the topmost dialog; traps Tab and Shift+Tab at the boundaries of visible, enabled controls.
3. Closes only the topmost dialog on Escape; maintains a LIFO modal stack; backdrop clicks cannot close lower dialogs.
4. Restores the previously focused element (when still mounted) and the exact previous body overflow value on close/unmount. Callback changes do not trigger focus reset.

Modal focus was tested with a **synthetic nested React fixture**, not a real payment interaction. The script is built within the Playwright test with `esbuild` and injected into the isolated browser; it is never included in the app production bundle. Page CSP remains enforced for normal users, and the fixture test uses Playwright's test-only `bypassCSP:true` without changing production CSP headers or code.

## Regression / visual assurance

- Five new Node/SSR tests assert equivalent DOM contracts for master, payroll, Employee, inline PI summaries and correct modal/billing authority hooks.
- Four read-only browser tests validate desktop/mobile 1440×900 and 390×844 layout with mocked backend GET, no API POST, Super Admin/Processor/Controller and CLIENT_USER role routing, flat directory/PI styling and modal accessibility, nested focus, Escape, focus restore, body unlock.
- Side-by-side computed-style comparison G2 production vs G3 static build: 9 Clients & Projects + 9 Payment Instructions selectors on two viewports, **0 changes** across color, type, padding, display, grid geometry and bounding boxes. The existing G1 global/polish CSS source signatures remain unchanged.
- G0 session/cache tests, G1 CSS checks, G2 navigation UAT and all existing business/security regressions must pass. Quality Gate, dependency scan, DAST, Cloudflare deploy and production health must pass before closure.

## Remaining G3-adjacent technical debt

- `OperatingWorkspace.tsx` remains ~1,300 lines; `BillingWorkspace.tsx` ~1,603 after extraction; `IdaFab.tsx` ~1,213. Their deeply coupled state and API orchestration can be decomposed further as separately reviewed bundles without changing financial workflows.
- Read-only, synthetic-role visual testing does not constitute live MFA authenticated cross-role payment UAT; retain that operational check for end-to-end production closure.
- Some historical diagnostic lint warnings remain; G3 does not claim a full no-warning codebase.
