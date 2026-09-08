# Billing SLA & Trigger Engine

## Goal

ProQPay must not assume every client's TOP starts on invoice issue date. A client/project can define a business-day SLA that starts only after one or more verified business events.

Supported triggers:

- `PAYROLL_PAID` — system-derived from canonical reconciliation `MATCHED`.
- `INVOICE_ISSUED` — system-derived from the invoice issue timestamp.
- `INVOICE_DOC_COMPLETE` — manual evidence recorded by Processor and verified by Controller.
- `BAST_SIGNED` — manual evidence recorded by Processor and verified by Controller.

When multiple triggers are required, the SLA starts on the **latest** satisfied trigger date. This models the point at which every contractual prerequisite is complete.

## Backward compatibility

The feature is opt-in. If no active SLA policy exists for the invoice's client/project, Billing keeps the previous behavior: `clients.payment_terms_days` is counted as weekdays from invoice issue date.

Existing invoice due dates are not rewritten by migration 0023.

## Maker-checker evidence

Manual evidence is two-step:

1. Processor/Super Admin records evidence (`RECORDED`).
2. Controller/Super Admin verifies or rejects it.
3. The same actor cannot record and verify the same evidence.
4. Only `VERIFIED` evidence can activate the SLA.

Once a due date is materialized and AR exists, new evidence cannot silently recalculate the contractual due date.

## Invoice and AR lifecycle

For an invoice with a configured SLA policy:

1. Controller issues the approved invoice.
2. Invoice becomes `ISSUED`.
3. If required evidence is incomplete, `sla_status=WAITING_EVIDENCE`, `due_date=NULL`, and no AR row is created.
4. Verified evidence is evaluated together with system-derived triggers.
5. When all triggers are ready and the calendar is complete, `sla_status=ACTIVE`, `sla_triggered_at` and `due_date` are frozen, and AR is created.
6. If an `ID_OFFICIAL` calendar year required by the calculation is missing, `sla_status=CALENDAR_INCOMPLETE` and AR is not created.

## Business calendar

Two modes exist:

- `WEEKDAYS_ONLY`: excludes Saturday and Sunday.
- `ID_OFFICIAL`: excludes weekends plus configured Indonesian non-business dates, and requires every calendar year crossed by the SLA calculation to be marked `OFFICIAL`.

Migration 0023 seeds the 17 Indonesian national holidays for 2026 from SKB 3 Menteri No. 1497/2025, No. 2/2025, and No. 5/2025.

Cuti bersama is deliberately **not** automatically excluded for private-company SLA. The SKB states that implementation of collective leave for private institutions is determined by each respective leadership. Super Admin can add a `COLLECTIVE_LEAVE` or `COMPANY_HOLIDAY` day explicitly when the company's contractual calendar requires it.

## Policy examples

- 14 business days after payroll payment: `requiredTriggers=["PAYROLL_PAID"]`.
- 30 business days after complete invoice package: `requiredTriggers=["INVOICE_DOC_COMPLETE"]`.
- 60 business days after invoice package and signed BAST: `requiredTriggers=["INVOICE_DOC_COMPLETE","BAST_SIGNED"]`.
- All prerequisites: `requiredTriggers=["PAYROLL_PAID","INVOICE_DOC_COMPLETE","BAST_SIGNED"]`.

Project-specific policies take precedence over client-level policies. A policy is versioned by deactivating the previous active policy and inserting a new policy; invoices retain the policy ID selected when their SLA is evaluated.

## API

`GET /api/billing-sla` lists SLA policies and official calendar coverage. `GET /api/billing-sla?invoiceId=...` returns an invoice, its frozen policy, and evidence history.

POST actions:

- `UPSERT_SLA_POLICY`
- `RECORD_SLA_EVIDENCE`
- `VERIFY_SLA_EVIDENCE`
- `REJECT_SLA_EVIDENCE`
- `UPSERT_CALENDAR_YEAR` (Super Admin)
- `UPSERT_CALENDAR_DAY` (Super Admin)

No endpoint allows a user to manually create `PAYROLL_PAID`; it is always derived from reconciliation.
