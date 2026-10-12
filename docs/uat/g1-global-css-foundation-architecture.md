# G1 — Global CSS Foundation & Architecture

## Baseline & decision

Baseline main: `f2d5ebf67d068f377c19e46fb2458896a0e3dfd4` (G0). Before G1, `globals.css` held **221,613 bytes** (2,127 rules) and `polish.css` **77,366 bytes** (653 rules). Their styles were imported globally from `layout.tsx` alongside feature CSS. Cascading selectors intentionally stack across historical releases, including 142 `!important` declarations in the entire styling tree. Introducing `@layer` immediately would change unlayered/layered priority and can break privileged finance views, login, mobile shell and print documents. **G1 is a lossless structural refactor, not a visual redesign.**

## CSS architecture (ordered imports in `src/app/layout.tsx`)

| Order | Module | Responsibility |
| --- | --- | --- |
| 1 | `styles/tokens.css` | Initial semantic tokens, accent, density, radius, shadows |
| 2 | `globals.css` | Legacy foundation, login, global controls, directory, IDA and theme variants |
| 3 | `styles/premium.css` | Later premium surface token bridge, integrations, invoice/print templates and gateway styles |
| 4 | `styles/shell.css` | Unified sidebar, header and footer contract |
| 5 | `styles/shared-ui.css` | Unified UI primitives, shared components, master directory presentation |
| 6 | `styles/operations.css` | Payroll staging, funding, Payment Instructions, canonical register, compact filters, UAT archive |
| 7 | `polish.css` | Final interactions, contrast, button semantics and baseline payroll pipeline |
| 8 | `styles/polish-dashboard.css` | Dashboard visual refinement |
| 9 | `styles/polish-directory.css` | Clients & Projects final presentation |
| 10 | `styles/polish-data-operations.css` | Data Intake / Data Readiness refinement |
| 11 | `styles/polish-payruns.css` | Pay Runs responsive and quality polish |
| 12 | `styles/polish-billing.css` | Billing & AR polish |
| 13 | `styles/polish-people-reports.css` | Employees and Reports final presentation |
| 14–16 | `employee-services.css`, `audit-console.css`, `e2pay-wallet.css` | Bounded feature sheets preserved in the same positions |

**Cascading semantics are intentionally unchanged.** The source concatenation for positions 1–6 reproduces exactly the former `globals.css` with SHA256 `feb5cb820c57dc2a9297de582cfc0e92366cb4d6c989cb6f42d28b3de55e847a`; positions 7–13 reproduce original `polish.css` with SHA256 `4b3c8cf3de6c698bde2ff90c0ccd12b537dca63f39f32a4101e1a5a38f78d789`. There are still 3,150 CSS rules, 10,260 declarations and 142 `!important`s across 16 source modules; G1 does not falsely claim to have eliminated legitimate/historical overrides.

## Change governance

`npm run css:check` runs `scripts/check-css-architecture.mjs` before every production build. It confirms the exact layout import order, CSS parser validity, unlayered cascade policy, root token coverage and pinned foundation/polish checksums. Changing token values, structural rules or CSS import order intentionally requires a code review of visual and responsive behavior and an explicit update of the original G1 checksum contract in `scripts/css-manifest.mjs`. Tests reading historical `globals.css`/`polish.css` use `tests/helpers/style-sources.mjs` so they evaluate the identical concatenated sources, not truncated files. `scripts/verify-built-css.mjs` now also verifies key login, directory, and payment selectors survive the Next.js static build.

For future CSS additions: prefer the closest domain file, semantic variables (`--bg`, `--text`, `--accent`, `--border`, `--r-*`) and modifier classes over expanding generic global `.card`/`.btn` overrides. New `@layer` rules require a separate explicit rebaseline project: native CSS unlayered rules outrank normal layered styles. Avoid changing breakpoint contracts during pure architecture work.

## Validation and residuals

- 976 preexisting tests retained after splitting the stylesheet and migrated only their source-reading helper. Four new G1 tests validate exact hashes, rule counts, import order, token ownership and domain selectors.
- Browser computed-style comparison against the live pre-G1 production release: at 1440×900 and 390×844, **0 differences for 12 login selectors and 10 directory/payment selectors** (properties include layout, dimensions, border, spacing, typography and background). Anonymous-only; no financial authentication is bypassed.
- Next.js static export, CSS build size/CSP hashes and edge security checks must remain green. Source CSS total stays 334,363 bytes, while built CSS increases only slightly due to imports (observed 300,000 → 300,339 bytes, +339 bytes). Module split is **source maintainability**, not a claim of runtime code splitting.
- G1 intentionally retains legacy duplicate selectors and late premium token overrides, including dark/contrast historical rules. Follow-up visual simplification, `@layer` adoption, specificity reconciliation and responsive typography upgrades must be separate, screenshot-gated proposals; do not conflate them with a safe file move.
- Full authenticated multi-role visual UAT is still required to prove all protected workflow layouts under live business data; read-only automated anonymous CSS tests cannot establish that.
