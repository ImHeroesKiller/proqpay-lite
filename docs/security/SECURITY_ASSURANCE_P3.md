# P3 Security Assurance, Pentest & Final Compliance Closure

## Purpose

P3 does not introduce new production privileges. It verifies that the controls delivered in P0-P2.1 remain effective and that final security closure is supported by independent evidence.

## Automated assurance

The repository maintains the following evidence:

- **SCA / dependency audit**: daily and on code changes; High/Critical findings fail.
- **DAST**: OWASP ZAP passive baseline against the canonical production origin. High/Critical findings fail and create a security issue.
- **Production uptime and browser hardening**: synthetic monitoring against the canonical production domain.
- **Audit integrity**: daily SHA-256 checkpoints with mismatch escalation.
- **Daily backup/restore drill** plus a **quarterly restore assurance artifact** retained for one year.
- **Production incident gate**: the final gate reads D1 and rejects closure while any Critical/High security/fraud incident remains unresolved.
- **Final assurance pack**: monthly/manual artifact summarizing technical workflow recency, dependency status, incident status, pentest attestation and tabletop attestation.

## Independent pentest

Automated ZAP evidence is not an independent penetration test.

Full P3 closure requires an independent third-party assessment of the canonical production target and relevant APIs. The full report may remain outside Git. The final gate only needs a non-secret attestation containing:

- assessor type = `INDEPENDENT_THIRD_PARTY`;
- report date and validity date;
- scope containing `https://proqpay.msg-os.com`;
- methodology;
- zero open Critical findings;
- zero open High findings;
- SHA-256 of the approved report.

The template is `docs/security/INDEPENDENT_PENTEST_ATTESTATION.template.json`. Store the approved attestation as GitHub Actions secret `INDEPENDENT_PENTEST_ATTESTATION_JSON`. Do not store the full report in the repository.

## Annual human tabletop

Automation may prepare and remind, but it must not self-certify a human exercise.

Use `docs/security/TABLETOP_EXERCISE.md`. After the exercise is approved, provide the minimal non-secret attestation via GitHub Actions secret `SECURITY_TABLETOP_ATTESTATION_JSON`.

Required closure:
- exercise within the past 365 days;
- at least two participants;
- scenario and decisions recorded;
- corrective actions recorded;
- SHA-256 of the approved exercise record.

## Final assurance status

The `Security Final Assurance Gate` reports:

- `PASS` only when all required technical workflows are current and successful, no open production Critical/High incidents exist, no Critical/High production dependency vulnerabilities exist, independent pentest attestation is valid with zero open Critical/High findings, and annual tabletop attestation is current.
- `PENDING` otherwise.

A `PENDING` result is evidence that closure requirements are being enforced. It must not be represented as a completed independent pentest.

## Evidence retention

DAST evidence: 90 days.  
Quarterly restore assurance: 365 days.  
Final assurance pack: 365 days.  
Full pentest/tabletop records: retained outside Git according to organizational security/legal retention; only approved hashes and minimum metadata enter the CI attestation.
