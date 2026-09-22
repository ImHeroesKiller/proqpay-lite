# ProQPay Production Rollout Runbook

Last updated: 22 September 2026

This document is the operational handoff for the completed ProQPay Phase 1–6 rollout.

## Canonical payroll lifecycle

`Prepare → Review → Approve → Pay → Close`

The close checkpoint is formal. A payroll cycle is **not closed** merely because payment, invoice, or AR is complete.

A period may be closed only when all of the following are true:

1. Payroll input is final.
2. Payroll submission state is `COMPLETED`.
3. The active Payment Instruction is `COMPLETED`.
4. Reconciliation is `MATCHED`.
5. No critical payroll exception remains open.
6. The linked invoice has been issued: `ISSUED`, `PARTIALLY_PAID`, or `PAID`.
7. A Payroll Controller explicitly confirms `TUTUP PERIODE`.

Outstanding AR does **not** block payroll period close. AR collection remains active in Billing & AR after the payroll cycle is closed.

## Close ownership

- Payroll Processor: prepare invoice and submit it for review.
- Payroll Controller: approve invoice, complete tax invoice requirements, issue invoice, and close the payroll period.
- Client User: monitor results and documents only.
- Super Admin follows the same maker-checker restrictions; Super Admin is not a self-approval bypass.

Every successful period close writes a `PAY_RUN_CLOSED` audit event.

## Revision after close

A payroll with completed payment cannot be reopened. Corrections after payment must use an Adjustment / Off-cycle Pay Run so the original payroll, PI, payment evidence, reconciliation, invoice, and audit history remain immutable.

The legacy `REOPEN_PAY_RUN` path is retained only for old closed records that have no Payment Instruction and are not completed.

## Production deployment gate

Production deploys from `main` through `.github/workflows/cloudflare-deploy.yml`.

The deploy pipeline must pass in this order:

1. Install locked dependencies.
2. Unit tests.
3. Type check.
4. Lint.
5. Production build.
6. Verify Cloudflare credentials.
7. Download and validate Pages / D1 / R2 / AI configuration.
8. Validate resumable D1 state.
9. Export a pre-deployment D1 backup.
10. Preserve the backup as a GitHub Actions artifact.
11. Apply pending D1 migrations.
12. Seed only missing ESS credentials.
13. Reconcile and assert canonical payment invariants.
14. Deploy the reviewed commit to Cloudflare Pages.
15. Verify production health.
16. Run `scripts/production-smoke.mjs`.
17. Assert the ops / ESS access split.

Do not bypass these gates for a normal production release.

## Production smoke contract

The smoke script checks:

- `GET /api/health` returns HTTP 200, `ready=true`, `database=d1`, and `auth_mode=session`.
- Health checks contain no error state.
- Anonymous access to `/api/me`, `/api/operating-model`, and `/api/billing` fails closed with HTTP 401.
- The production home page returns HTTP 200 and renders ProQPay identity.

Run manually with:

```bash
node scripts/production-smoke.mjs https://proqpay-lite.pages.dev
```

## Rollback

If a deployment fails before Pages publish, fix the failing gate and rerun; do not manually mutate production data.

If the Pages deployment succeeds but the application fails smoke/health:

1. Stop further business mutations.
2. Identify the last known-good `main` commit / Pages deployment.
3. Review the pre-deployment D1 backup artifact from the failed run.
4. Roll back application code to the last known-good commit.
5. Restore D1 only when the failure is caused by an incompatible data migration and after confirming restoration will not discard valid production transactions.
6. Re-run health, anonymous-auth smoke checks, payment invariants, and role UAT.

Never rotate `PI_ENCRYPTION_KEY` as a rollback mechanism.

## Minimum role UAT after material workflow changes

### Payroll Processor
- Create/open Pay Run.
- Finalize input.
- Validate and resolve exceptions.
- Finalize payroll to Controller.
- After client approval, generate and submit PI.
- Execute/reconcile payment as authorized.
- Generate and submit invoice.

### Payroll Controller
- Approve payroll and send to Client.
- Approve PI using maker-checker.
- Reconcile payment.
- Approve invoice.
- Complete tax invoice requirements when applicable.
- Issue invoice.
- Close payroll period only when Cycle Close shows Ready.

### Client User
- See only assigned client/project scope.
- Correct requested payroll exceptions.
- Review Gross, deductions, Net/THP and variance without bank-account data.
- Approve payroll or request revision.
- Monitor payment and documents.

### Super Admin
- Verify settings/master-data administration.
- Confirm normal Processor/Controller segregation still applies to financial approvals.

## Release acceptance

A release is ready when:

- CI Quality Gate is green.
- Cloudflare preflight is green.
- Production deploy is green.
- D1 migration and payment invariant checks are green.
- Production health and smoke test are green.
- No P0/P1 regression is open.
- Close readiness cannot be bypassed.
- Client scope and maker-checker controls remain enforced.
