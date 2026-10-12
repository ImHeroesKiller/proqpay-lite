# P5.8.6 — Flat master and compact Payment Instructions

User-requested presentation-only refinement for **Klien & Project** and **Payment Instructions**. No financial, account, data schema or API changes.

## Klien & Project

- Preserve exact heading, create/edit/detail permissions, project/client tabs, search, status filter, client scoping and pagination.
- Remove decorative metrics cards, filter card, and the large master list card. Replace metrics with a compact, unboxed inline count bar and clients/projects with flat, separated list rows.
- Use one responsive, compact 32px filter toolbar with reset button. Source cards remain in details/modals where structured forms need affordances.

## Payment Instructions

- Preserve Controller/Processor authority and three tabs PI / Canonical Disbursement / Funding.
- When Payment stage is active, remove card wrapper on top shared filters and compact the stage navigation; other Payroll/Close stages retain prior presentation.
- Render decision totals as lightweight inline counters instead of four metric cards, compact the three payment tabs, and display the PI table without a card container.
- For Super Admin's nonembedded payment view, remove unrelated role card and flatten the period/client/project/status/search toolbar. Do not change other modes.

## Responsive and tests

- Filter controls remain labeled, keyboard focus/aria semantics preserved; mobile filter wraps into 2 columns, search full-width. Flat master entity rows become single column below 700px and retain action buttons.
- E2E clients/projects scenario updated to assert flat summary/filter/master selectors. Three dedicated source/CSS tests verify no card wrappers, filter semantics, scoped styling, and actual PI table.
- Verify full regression, lint/typecheck, static build/CSP in PR and production deployment. Authenticated browser visual regression can be run with supported MFA/UAT credentials and should not bypass strong authentication.
