import { d1Batch, d1First } from './_d1.js';

// Called only after the canonical E2Pay execution is provider-confirmed settled.
// Legacy status updates and operator-submitted "proof" never reach this path.
export async function applyCanonicalEwaSettlement(database,dr,actorEmail){
  if(dr.source_document_type!=='EWA_REQUEST') return {updated:false,reason:'NOT_EWA'};
  const state=await d1First(database,`SELECT dr.status,de.status AS execution_status,
      COUNT(dei.id) AS total_items,
      COALESCE(SUM(CASE WHEN dei.status='SUCCEEDED' THEN 1 ELSE 0 END),0) AS succeeded_items
    FROM disbursement_requests dr
    JOIN disbursement_executions de ON de.disbursement_request_id=dr.id
    JOIN disbursement_execution_items dei ON dei.disbursement_execution_id=de.id
    WHERE dr.id=? AND dr.org_id=? GROUP BY dr.id,de.id`,[dr.id,dr.org_id]);
  if(!state||!['SETTLED','RECONCILED'].includes(state.status)||state.execution_status!=='SUCCEEDED'||
    Number(state.total_items)<1||Number(state.total_items)!==Number(state.succeeded_items)) return {updated:false,reason:'NOT_PROVIDER_SETTLED'};
  const row=await d1First(database,'SELECT status FROM ewa_requests WHERE id=? AND org_id=?',[dr.source_document_id,dr.org_id]);
  if(!row||row.status!=='APPROVED') return {updated:false,reason:'NOT_APPROVED_OR_ALREADY_PROCESSED'};
  const reference=String(dr.client_reference||dr.id);
  await d1Batch(database,[
    {statement:`UPDATE ewa_requests SET status='DISBURSED',disbursement_source='E2PAY_CANONICAL',disbursement_reference=?,disbursement_transaction_date=date('now'),disbursed_by=?,disbursed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND org_id=? AND status='APPROVED'`,bindings:[reference,actorEmail,dr.source_document_id,dr.org_id]},
    {statement:`INSERT INTO audit_logs(id,org_id,username,role,action,detail,entity,entity_id) VALUES(?,?,?,'SYSTEM','EWA_DISBURSED_PROVIDER_CONFIRMED',?,'ewa_request',?)`,bindings:[`AUD-${crypto.randomUUID()}`,dr.org_id,'CANONICAL_E2PAY',`dr=${dr.id} · providerConfirmed=true · reference=${reference}`,dr.source_document_id]},
  ]);
  return {updated:true,reference};
}
