# EWA enrollment and employee limits

## Operator workflow

The Advance Salary workspace contains “Daftarkan & Atur EWA Karyawan”. Super Admin, Payroll Processor and client users may register employees and manage EWA settings. Client users are restricted to both assigned clients and projects. Payroll Controller may read settings but cannot change enrollment.

New employee registration creates only the employee record and audit event. It does not issue credentials, enroll EWA automatically, invent contract dates, or create a salary bank account. Salary bank details and initial ESS access are completed through payroll administration.

For existing or newly registered employees:

1. Select latest payroll salary or explicitly enter/confirm a manual salary and period.
2. Choose a percentage of salary or fixed nominal limit.
3. Activate EWA and record the change reason.
4. Every advance still requires client consent, internal processing and existing Controller/provider settlement gates.

## Salary and limits

The automatic reference chooses the latest available payroll period between a finalized, matched payroll/PI net salary and imported net salary with an explicit valid source period. It does not use a newer draft payroll or silently replace net salary with basic salary. Missing salary requires explicit manual input before activation.

Enrollment replaces calendar proration and join-date/tenure/workday gates for that employee. The monthly request period and actual day counters are still recorded honestly. Existing legacy configurations remain unchanged until the employee is enrolled. Percentage limits follow reference salary; fixed limits stay as entered. Central fee policies remain separate.

Every settings write has optimistic version control and records actor, time, reason, prior settings and new settings. New requests snapshot settings version, salary, period and existing limit snapshot. Pending approvals reject a changed/disabled configuration and require resubmission; existing approved financial history is not rewritten.

Migration0073 adds settings and request snapshot fields only. No existing employee is auto-activated and no production configuration/data is changed by this PR.

## Validation

- 1,118 backend tests passed, including five new API scenarios for client/project scope, registration, controller denial, salary sources, missing join date/current-month payroll, fixed/manual limits, stale writes and approval version changes.
- Typecheck, lint (0 errors,62 existing warnings), build/CSS/CSP and preflight9/9 passed.
- Local browser checks: client and Processor at390/1440px can select employee, activate and save fixed limit.
- ESS companion:33 tests and typecheck/build passed; browser checks for zero and250,000 limits confirm consistent amounts, fees, range and button state.

Deploy in order: backup -> reviewed migration0073 -> Lite -> ESS. Actual client policy values remain an explicit operator input after deployment.
