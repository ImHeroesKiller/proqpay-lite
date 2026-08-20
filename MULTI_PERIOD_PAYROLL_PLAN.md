# ProQPay Lite — Multi-Period Payroll Plan

## Audit conclusion

Current UI can select several months and reporting can filter payment periods, but the underlying payroll data is not yet a true multi-period ledger:

- `employee_compensation` stores only one compensation row per employee and a single `payroll_source_period`; a later import overwrites the earlier period.
- Dashboard period is held in `meta.currentPeriod`/local state and becomes the implicit period for IDA and import.
- Legacy `payrolls` is organization-wide; draft/calculated rows for a period may be deleted during import.
- Submission is period-aware, but there is no canonical period registry, close/reopen control, or period-level SLA status.
- Employee master data and payroll-period snapshots are still mixed.

## Target model

1. `payroll_periods`
   - `id`, `org_id`, `client_id`, `project_id`, `period`, `status`
   - Status: `OPEN`, `DATA_COLLECTION`, `PROCESSING`, `REVIEW`, `PAYMENT`, `CLOSED`, `REOPENED`
   - Cut-off, planned pay date, timezone, closed/reopened metadata.

2. `payroll_period_employee_snapshots`
   - One immutable row per period and employee.
   - HR identity snapshot, bank reference/version, gross, deductions, net, payroll components, source file and checksum.
   - Unique `(period_id, employee_id, version_no)`.

3. `payroll_runs`
   - Multiple controlled runs per period with versioning.
   - Only one final run per client/project/period.
   - Submission and PI reference the final run, not mutable employee master data.

4. Period policy
   - Unique active period per client/project/month.
   - Closed periods immutable.
   - Reopen requires Controller approval, reason, version increment and audit trail.
   - Rapel references source periods explicitly without modifying those periods.

## Implementation phases

### Phase 1 — Canonical period registry

- Add `payroll_periods` and status transition API.
- Require explicit `clientId`, `projectId`, and `periodId` for import.
- Remove fallback to browser/current month in server import.
- Add period selector to Payroll Operations independent of Dashboard.

### Phase 2 — Historical snapshots

- Add period employee snapshot and payroll run tables.
- Migrate current 2026-08 data into an initial final run.
- Change import so historical compensation is appended, never overwritten.
- Keep `employees` as current HR master only.

### Phase 3 — Period control center

- Portfolio view: all client/project periods and current status.
- Filters for month, client, project, tier and status.
- KPI: awaiting data, validation blockers, awaiting approval, payment due, completed and overdue.
- Drill-down from period → submission → run → PI → proof → reconciliation → invoice.

### Phase 4 — Close, reopen and rapel

- Month-end close checklist and Controller approval.
- Reopen workflow with mandatory reason and maker-checker.
- Rapel allocation per source period and employee.
- Prevent import or payment mutation on closed periods.

### Phase 5 — Migration and regression

- Reconcile legacy `payrolls`, approvals and existing submissions by period.
- Archive legacy organization-wide aggregates after reconciliation.
- End-to-end tests across at least 12 periods, overlapping clients, revisions, rapel, reopen and concurrent imports.

## Acceptance criteria

- At least 24 months can be viewed without overwriting history.
- Same employee can have different payroll values across periods.
- Each client/project/period has an independent workflow and SLA.
- Closed periods cannot change without approved reopen.
- Dashboard totals reconcile to period runs and Payment Instructions.
- PI always references one immutable final payroll run.
