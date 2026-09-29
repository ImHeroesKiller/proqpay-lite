# ProQPay Incident Response Runbook

## Severity and response targets

| Severity | Example | Acknowledge target | Escalation |
| --- | --- | ---: | --- |
| S1 / Critical | confirmed beneficiary fraud, payment integrity compromise, credential/key exposure, material outage during payment | 15 min | immediate management + technical owner |
| S2 / High | blocked fraud actor, transaction-limit breach, production outage, repeated security control failure | 60 min | security/system owner |
| S3 / Medium | account lockout pattern, suspicious repeated auth failures | 4 h | application owner |
| S4 / Low | non-urgent security anomaly | 1 business day | normal security queue |

## Workflow

1. **Detect & record.** Use automated fraud incidents, Audit Logs, GitHub uptime alerts, provider evidence and user reports.
2. **Triage.** Confirm affected organization, users, payment instructions, time window and whether money/data could be affected. Do not speculate.
3. **Contain.** Block user/email/IP/device/bank account as appropriate; revoke sessions; stop payment execution when transaction state is uncertain; rotate exposed credentials/keys.
4. **Preserve evidence.** Keep audit/payment/security logs, immutable PI hashes, provider references, D1 backup evidence, timestamps and relevant request correlation identifiers. Do not copy secrets into tickets.
5. **Investigate.** Determine timeline, root cause, affected records, financial exposure and control failures.
6. **Eradicate & recover.** Patch the root cause, restore verified service, reconcile payment/provider state, and validate controls before re-enabling critical actions.
7. **Communicate.** Internal stakeholders receive confirmed facts and impact. External notifications are sent only through authorized business/legal channels.
8. **Close.** Record resolution, evidence references, corrective actions and lessons learned. S1/S2 require a post-incident review.

## Fraud / regulatory / law-enforcement request

When a fraud refund, hold, evidence request, regulator request or law-enforcement request is received:

- verify requester identity and authority before disclosing data or moving funds;
- preserve the original request and evidence;
- place the relevant transaction/account under controlled hold where legally and operationally appropriate;
- require dual review for any refund or corrective financial movement;
- reconcile ledger, bank/provider evidence and accounting before closing;
- document who approved the action, amount, reason, references and completion time;
- provide only the minimum data authorized for disclosure.

No employee may promise a refund, disclose protected data, or alter payment records solely from an unverified request.

## Evidence retention

Security incident evidence and audit/transaction logs must remain available for at least 180 days. Daily D1 backup verification is separate recovery evidence and follows its configured artifact retention.

## Testing

- Restore drill: automated daily.
- Incident/tabletop exercise: at least annually.
- S1/S2 post-incident review: mandatory.
