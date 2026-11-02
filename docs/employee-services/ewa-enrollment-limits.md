# EWA through payroll employee data

## Setup

Open Data Karyawan Payroll → existing employee detail → EWA. Super Admin,
Payroll Processor and scoped client users can choose the salary reference,
set a percentage/fixed nominal limit, and activate/deactivate EWA with a reason.
Client access to this scoped view does not grant bank editing or ESS credential
reset permissions. The existing payroll intake remains the employee source.
There is no separate EWA employee registration; the legacy REGISTER action
returns 410 without creating an employee, credentials or settings.

The approval page contains only requests, decisions and status. It has no
registration/configuration or embedded payment execution. An approved request
links to Payments → Disbursement, focused on that EWA source. The existing
canonical API revalidates source status, client consent, bank snapshot and roles.

## Process

1. Employee submits through ESS after activation (current-month payroll is not required).
2. Assigned client approves/rejects.
3. Processor reviews the consented request and prepares/submits its canonical DR.
4. Controller approves execution; provider settlement confirms transfer.
5. Deduction joins a later payroll/PI; matched reconciliation closes repayment.

Controller cannot use EWA APPROVE to bypass Processor review. The existing
Controller-only DR approval/execution and maker/checker controls remain.

## Scope and salary

Client grants are mandatory. Empty project grants mean all projects within
assigned clients; explicit project grants narrow access. Filters cannot expand
these server-side grants. Clients/projects are read from existing master data
and are available even without EWA requests or settings.

Automatic salary reference chooses the latest valid period between finalized,
matched payroll/PI net salary and imported net salary with a source period.
A draft payroll or basic salary cannot silently substitute net salary. Missing
salary requires explicit confirmation of salary and period before activation.
An enrolled employee uses configured limits without join-date/calendar-proration
gates. Central fees, active employee, bank, consent and open-request guards remain.

Writes have optimistic version checks and an audit event with actor/reason.
Requests snapshot configuration version, reference salary, source period and
limit. Changed/disabled settings invalidate pending approval, requiring a fresh
request; approved history is not rewritten.

## Verification and deployment

API regression covers client-wide/project scope, cross-client denial, disabled
independent registration, configured salary/limits, ESS submission, client consent
and Controller bypass rejection. Browser scenarios cover Client/Processor at
390/1440px, approval-only page, payroll employee editor and configuration save.

No new migration is required; this correction uses production migration 0073.
No employee is auto-activated and no production setting or transaction is changed.
