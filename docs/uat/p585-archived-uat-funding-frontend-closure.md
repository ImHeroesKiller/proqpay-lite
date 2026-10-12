# P5.8.5 — Archived UAT Funding UI / Gateway Queue Closure

User reported screenshot 2026-10-12 22:46 WIB showing `LEGACY · RECOVERY REQUIRED` for archived UAT account ending `0190` at `?view=payments&period=2026-09&paymentPanel=FUNDING` and a separate `Payment Gateway Queue` card below.

## Root causes

1. `/api/e2pay-disbursement-limits` continued to return the UAT sub-account as `ACTIVE` in the provider registry. P5.8.4 archived the **PI** administratively (without provider settlement) but intentionally did not delete/disable that provider account. The Funding UI originally treated all ACTIVE accounts as operational and presented recovery CTA.
2. `AppWorkspaceRouter` rendered an additional legacy `PaymentGatewayPaymentPanel` for non-Processor/Controller roles below the unified Payment Workbench, regardless of whether the current tab was Funding. This duplicated payment execution controls even with an empty queue.

## Fix

- Add `operationalOnly=1` to the funding GET used by the operational Funding tab. The server returns all existing accounts through the **unfiltered** GET for audit/legacy and client settings. When the filter is present it hides a UAT account **only when** it has data-only catalog provenance, no unarchived PI, no remaining active/previously executed canonical DR, no gateway transaction, and no pending/active approved limit. Any account with active work remains visible. Production E2Pay accounts are never filtered by a UAT archive.
- Filter limit list using the exact same hidden account ID set; when a deep link selects an archived ID, choose the first available operational account instead. Show a compact empty funding state when there are none, rather than a `LEGACY · RECOVERY REQUIRED` alert or four stale capacity cards. Credential management for preserved UAT accounts remains accessible via Clients & Projects/Settings.
- Remove the *separate* full-page `PaymentGatewayPaymentPanel` render from `AppWorkspaceRouter`; keep PI review, canonical DR and Funding organized inside unified Payment Workbench. The scoped PI detail legacy execution fallback remains subject to existing financial/Controller checks for genuinely unarchived records.
- No provider balance write, credential recovery, source deletion, PI status mutation, payment execution, or fake provider settlement.

## Verification

- Full regression/unit/lint/types/build should pass before merge/deploy. Focused tests seed four account scenarios: archived UAT, new live UAT PI, UAT approved limit, and production account; verify 401/403 and source preservation. Read-only production D1 aggregate audit after merge confirms hidden accounts and no archived PI strategy collisions; browser auth-sensitive visual UAT remains separate.
