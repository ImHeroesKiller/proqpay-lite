# ProQPay Annual Security Tabletop Exercise

This is a human exercise. Automation may create the exercise ticket and preserve technical evidence, but it must not self-attest completion.

## Scenario

During a payroll payment window, monitoring reports a privileged-account authentication anomaly while one Payment Instruction is in an uncertain provider state. A beneficiary account is then reported as suspicious. The team must determine whether to stop execution, preserve evidence, contain identity risk, reconcile provider state, communicate internally, and safely resume or cancel payment processing.

## Required participants

At minimum:
- technical/security or system owner;
- payroll/payment operations or accountable business owner.

Additional finance, legal, client-management, or provider participants may join when relevant.

## Exercise prompts

1. What is the initial severity and who becomes Incident Commander?
2. Which payment actions must fail closed immediately?
3. Which sessions, passkeys, TOTP recovery paths, credentials, IP/device indicators, or beneficiary accounts require containment?
4. Which evidence must be preserved before remediation?
5. How is the provider payment state reconciled before retry?
6. Who can approve resumption of payment execution?
7. What facts can be communicated to clients, provider, bank, regulator, or law enforcement?
8. How would D1 backup, audit-integrity checkpoints, gateway references and PI content hashes support investigation?
9. Which recovery criteria must be met before closure?
10. What changes, owners and deadlines result from the exercise?

## Completion record

The approved exercise record must include:
- exercise date and duration;
- participant roles;
- scenario decisions and timeline;
- observed control gaps;
- actions, owners and deadlines;
- final conclusion;
- SHA-256 of the approved record.

The full internal record does not need to be stored in Git. P3 only requires a non-secret attestation containing its digest and minimum closure metadata.
