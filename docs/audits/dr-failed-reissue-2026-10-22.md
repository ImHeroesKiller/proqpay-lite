# Failed DR replacement — 22 October 2026

The source uniqueness guard and deterministic references correctly prevented duplicate payments, but also blocked recovery after an unsent preflight failure. `CREATE` does not supersede an existing FAILED request; it now explains that the Processor must use **Ajukan ulang**.

`REISSUE_FAILED` is Processor-only and derives source, destination, amount and beneficiaries from the existing request and canonical source. It requires a FAILED execution with a complete balanced item ledger, no active lease, no financial attempts/journals/unknown outcomes anywhere in the source history, and no reserved or consumed allocation. Changed beneficiary/source snapshots are refused.

A single D1 transaction repeats the eligibility guard, marks the predecessor CANCELLED with an explicit replacement marker, and creates a READY replacement. The failed execution and its item ledger remain intact. The replacement has a deterministic predecessor-scoped idempotency key and a distinct client reference. Duplicate calls return the same replacement. A race that invalidates eligibility rolls the transaction back. The PI, immutable lines and approval remain unchanged.

The Processor then submits the replacement. Standard fresh routing, Controller approval, maker-checker, MFA, funding and inquiry controls apply. Neither replacement nor submission sends a transfer or calls the provider. This does not resolve a provider's historical inquiry rejection by itself.

Validation includes a 214-recipient replacement and repeat replacement, duplicate submission, provider/journal/attempt/unknown-result refusal, lease/role/tenant/item-count guards, snapshot drift, an injected race with rollback, outstanding reservation refusal, and fresh Controller MFA. Browser UAT covers the Processor's FAILED → Ajukan ulang → READY → Submit → PENDING_APPROVAL flow with provider traffic blocked. No schema change is required.
