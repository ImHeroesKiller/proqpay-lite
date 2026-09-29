# ProQPay Information Security Policy

Owner: ProQPay System Owner  
Review cycle: at least annually and after any Severity 1/2 incident  
Scope: ProQPay application, Cloudflare Pages/Functions, D1, R2, CI/CD, payment integrations, operational accounts, payroll and payment data.

## Policy objectives

ProQPay protects confidentiality, integrity and availability of payroll, employee, banking, invoice and payment information. Security controls are risk-based and use least privilege, segregation of duties, encryption, auditable change control and fail-closed payment controls.

## Access control

- Access is role-based. Payment execution and final confirmation are restricted to Payroll Controller.
- SUPER_ADMIN and PAYROLL_CONTROLLER require MFA in production.
- Critical payment actions require recent step-up MFA.
- Sessions are HttpOnly, Secure and SameSite=Strict and may be revoked.
- Access changes and privileged security actions must be auditable.

## Data protection

- TLS is required in transit.
- Payment Instruction and employee master bank account numbers are encrypted at rest with AES-GCM; user-facing surfaces should prefer masked values.
- Secrets and encryption keys belong in managed secret storage, never source control or logs.
- Security and transaction evidence required for investigation is retained for at least 180 days unless a longer legal/business requirement applies.
- Production D1 is backed up daily and restore verification is automated.

## Secure development and patching

- Pull requests and main must pass unit tests, typecheck, lint and production build.
- Dependency vulnerability scanning runs automatically.
- Critical vulnerabilities: remediate within 7 calendar days.
- High vulnerabilities: remediate within 14 calendar days.
- Medium: target 30 days. Low: target 90 days.
- Emergency fixes may use an expedited review but still require tests and an auditable commit.

## Monitoring and fraud controls

- Production health is synthetically checked every 15 minutes.
- Payment execution is subject to fraud blocklists, transaction limits, maker-checker controls, immutable content hashes and step-up MFA.
- Security/fraud events that meet escalation rules create a fraud incident with severity, due time, owner and lifecycle history.
- Critical unresolved payment/provider uncertainty is handled fail-closed until reconciled.

## Incident management

All suspected security incidents follow `docs/INCIDENT_RESPONSE_RUNBOOK.md`. Evidence must be preserved; logs must not be altered to conceal incidents. Notifications to customers, regulators or law enforcement are made only by authorized management/legal channels based on confirmed facts and applicable obligations.

## Exceptions

Security exceptions must document scope, risk, compensating controls, approver and expiry date. Permanent undocumented exceptions are not allowed.
