# EWA: client consent before internal approval

Employee eligibility retains enabled policy, workdays, tenure, available earned-wage plafond, active employment, primary salary account and one-open-request checks. Receiving payroll in the current month is not a prerequisite or exclusion; current-period payroll or configured basic salary provides the wage basis.

1. Employee submits (`SUBMITTED`, client consent `PENDING`).
2. Client user scoped to both client and project approves or rejects. Approval records actor/date/note and keeps the request `SUBMITTED` for internal processing. Rejection closes it `REJECTED`.
3. Super Admin, Processor or Controller may internally approve only with recorded client approval.
4. Processor prepares a canonical EWA DR; Controller approves execution. Provider evidence remains mandatory for settlement. Client consent is checked again before execution.
5. Disbursed advance plus fee is deducted from the next eligible payroll snapshot, including a later period when the employee had no payroll in the request month. Assignment to a payroll submission prevents reuse in another run. PI uses the resulting net amount; matched payroll reconciliation closes repayment as before.

Migration 0072 adds consent fields and an update trigger preventing internal APPROVED without client consent. No historical consent is invented. Existing approved EWA without evidence cannot create/execute new DRs until reviewed; successful historical provider executions remain readable/reconcilable.

Validation: 1,113 backend tests including scoped client approval/rejection, no-scope/cross-client denial, internal pre-consent rejection, direct transition guard, paid-payroll eligibility, and previous-month repayment through payroll/PI. Typecheck and production build pass. Native preflight 9/9. ESS companion tests: 31 pass; typecheck passes.

No production migration, approval, payout, or credential reset performed during implementation.
