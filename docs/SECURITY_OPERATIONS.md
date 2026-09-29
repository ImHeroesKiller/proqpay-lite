# Security Operations

## Production monitoring

- Synthetic health check: every 15 minutes against `/api/health`.
- Expected state: `ready=true`, database `d1`, auth mode `session`.
- Failure opens or updates a GitHub incident issue and can also send an external webhook when `SECURITY_ALERT_WEBHOOK_URL` is configured.
- Recovery closes the open health incident issue with a recovery timestamp.

## Fraud operations

Automated fraud incidents are generated for material controls including:
- account lockout threshold;
- valid account blocked by fraud blocklist;
- payment actor blocked by fraud control;
- transaction security limit exceeded;
- beneficiary bank account matched to fraud blocklist.

Incident lifecycle: OPEN -> ACKNOWLEDGED -> INVESTIGATING -> ESCALATED -> RESOLVED/FALSE_POSITIVE.

Default response targets:
- CRITICAL: 15 minutes
- HIGH: 60 minutes
- MEDIUM: 4 hours
- LOW: 24 hours

Only SUPER_ADMIN may operate the security incident API. All lifecycle changes are written to Audit Logs.

## Billing SLA schema reconciliation

Migration `0048_security_governance_operational_readiness.sql` recreates the intended `billing_sla_policies` parent schema when missing. This repairs the historical orphan foreign-key condition without rewriting invoice history.
