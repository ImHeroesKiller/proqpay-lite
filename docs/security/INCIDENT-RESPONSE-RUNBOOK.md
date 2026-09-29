# ProQPay Incident Response Runbook

## Severity
- SEV-1: confirmed compromise, unauthorized payment/data access, material outage, leaked production secret.
- SEV-2: credible attempted compromise, control bypass, degraded critical payment/payroll function.
- SEV-3: contained security defect or suspicious event without confirmed impact.

## Lifecycle
1. Detect and record time, reporter, affected service, correlation IDs and evidence.
2. Triage severity and assign Incident Commander.
3. Contain: revoke sessions/credentials, block fraud indicators, pause affected payment execution when required.
4. Preserve evidence. Do not alter original logs.
5. Eradicate root cause and rotate affected secrets.
6. Recover from verified state; validate payroll/payment integrity before resuming.
7. Communicate to affected internal owners and external parties according to contractual/regulatory obligations.
8. Close only after root cause, impact, actions, evidence, and follow-up owners are documented.
9. Conduct post-incident review for SEV-1/2.

## Payment/Fraud escalation
Suspected payment fraud is fail-closed: stop/reject the affected execution, preserve gateway/audit evidence, block confirmed indicators, and require Payroll Controller authorization before resumption. Refund/reversal requests from a bank, regulator, law enforcement, or provider must be recorded and reconciled before closure.

## Evidence checklist
Audit event IDs, actor/user, hashed IP/device context, PI/content hash, gateway reference, timestamps, affected employee/client/project, deployment SHA, remediation and approvals.
