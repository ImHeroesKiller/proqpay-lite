# ProQPay Information Security Policy

Owner: ProQPay Security & Operations  
Review cycle: at least annually and after material incidents.

## Scope
This policy covers ProQPay production services, Cloudflare Pages/Workers, D1/R2 data, source code, CI/CD, integrations, privileged accounts, payroll and payment data.

## Core controls
- Least privilege and role-based access are mandatory.
- SUPER_ADMIN and PAYROLL_CONTROLLER require MFA. Critical payment actions require recent step-up verification.
- Sensitive credentials and bank-account data must not be stored in plaintext.
- Production changes pass automated tests, reviewable Git history, and deployment verification.
- Security/audit evidence required for merchant controls is retained for at least 180 days unless a stricter obligation applies.
- Production data backups are automated and restore verification is performed continuously by CI.
- Security incidents are handled under the Incident Response Runbook.
- Critical vulnerabilities target remediation within 7 days; High within 14 days; Medium within 30 days, subject to documented risk acceptance.

## Access review
Privileged roles, active accounts, payment approval authority, and service credentials are reviewed quarterly and immediately after personnel/access changes.

## Exceptions
Exceptions require documented scope, owner, expiry, compensating controls, and approval by the accountable business/security owner.
