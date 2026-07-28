# IDA AI Operating System

IDA is the only user-facing orchestrator. Specialized workers never talk to
users, never expand their own permissions, and never calculate financial
results with an LLM.

## Runtime layers

1. `orchestrator.ts` resolves intent and creates an idempotent execution plan.
2. `worker-registry.ts` enforces worker capabilities, role access, and table
   boundaries.
3. Domain workers call deterministic business services and return the
   structured `WorkerResult` contract.
4. `workflow.ts` reconciles evidence and blocks execution when context,
   evidence, permission, or confirmation is missing.
5. Mutation APIs execute the approved plan atomically, write an audit record,
   and return canonical database state for dashboard refresh.

## Worker boundaries

| Worker | Domain | Data boundary |
|---|---|---|
| Payroll Staff | Payroll calculation and reconciliation | Payroll tables |
| HR Staff | Employee lifecycle | Employee, contract, attendance |
| Operations Staff | Client, project, billing, payment instruction | Client, project, billing, invoice, payment |
| Compliance Staff | Regulation and risk | Regulatory reference data |
| Document Staff | File reading and import preview | No database mutation |
| Finance Staff | AR/AP, cashflow, reconciliation | AR, invoice, payment |

## Mutation invariant

Every write, financial, or destructive operation must produce:

- an impact preview with affected record identifiers;
- evidence from database state or a deterministic business service;
- a permission decision;
- an idempotent plan identifier;
- exact confirmation when required;
- an atomic database mutation;
- an audit event;
- refreshed canonical dashboard state.

An LLM may explain a plan or worker result. It cannot fabricate a worker result,
change a calculation, bypass confirmation, or report success before the
database mutation commits.
