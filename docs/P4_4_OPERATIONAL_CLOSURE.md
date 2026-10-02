# P4.4 Operational Closure

P4.4 converts the production readiness controls into one repeatable operational release gate.

## Closure scope

The gate must prove all of the following from the same reviewed production revision:

1. Production release marker converges to the reviewed commit.
2. `/api/health` is ready with D1 and session authentication.
3. Browser security headers remain hardened.
4. Anonymous operational and financial APIs fail closed.
5. Operational regression tests pass for payroll lifecycle, payment execution, proof, reconciliation, billing and close.
6. Production D1 can be exported and restored into an integrity-checked local database.
7. Canonical Payment Instruction and bank-account invariants contain no violation.
8. Uptime evidence is green and current.
9. Daily backup/restore evidence is green and current.
10. Quarterly restore assurance is green and current.
11. Audit-integrity evidence is green and current.
12. No open production operational/security incident is blocking release.

## Automated workflow

Workflow: `.github/workflows/p4-operational-closure.yml`

It runs on changes to the P4.4 gate, can be started manually, and runs daily for continuous operational assurance.

Evidence is retained as a GitHub Actions artifact for 90 days. A failed gate opens or updates:

`P4.4 OPS: operational closure gate failed`

A later successful run closes the issue automatically.

## Evidence freshness

- Production uptime: maximum age 24 hours.
- Daily D1 backup/restore: maximum age 36 hours.
- Audit-integrity checkpoint: maximum age 36 hours.
- Quarterly restore assurance: maximum age 100 days.

The independent pentest and annual human tabletop remain P4.5 assurance items. They are intentionally not treated as P4.4 operational blockers.

## Operational release decision

P4.4 is closed only when the automated evidence status is `PASS`, Quality Gate is green, production deploy is green, and the P4.3 production regression remains green.
