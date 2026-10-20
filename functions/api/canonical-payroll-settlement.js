import {d1Batch,d1First} from './_d1.js';
import {markEwaRepaid} from './_ewa.js';

// This is settlement evidence, not a manual paid-status override. The caller
// holds the execution lock and has persisted the provider reconciliation result.
export async function applyCanonicalPayrollSettlement(database,dr,actorEmail){
  if(dr.source_document_type!=='PAYMENT_INSTRUCTION') return {updated:false};
  const state=await d1First(database,`SELECT dr.status,dr.amount,dr.recipient_count,de.status AS execution_status,
    COUNT(i.id) AS total_items,COALESCE(SUM(i.amount),0) AS item_total,
    COALESCE(SUM(CASE WHEN i.status='SUCCEEDED' THEN 1 ELSE 0 END),0) AS successes
    FROM disbursement_requests dr JOIN disbursement_executions de ON de.disbursement_request_id=dr.id
    JOIN disbursement_execution_items i ON i.disbursement_execution_id=de.id
    WHERE dr.id=? AND dr.org_id=? GROUP BY dr.id,de.id`,[dr.id,dr.org_id]);
  if(!state || state.status!=='RECONCILED' || state.execution_status!=='SUCCEEDED'
    || Number(state.total_items)!==Number(state.recipient_count) || Number(state.successes)!==Number(state.total_items)
    || Number(state.total_items)<1 || Number(state.item_total)!==Number(state.amount)) return {updated:false};
  const pi=await d1First(database,`SELECT pi.*,COALESCE(SUM(l.amount),0) AS line_total,COUNT(l.id) AS lines
    FROM payment_instructions pi LEFT JOIN payment_instruction_lines l ON l.payment_instruction_id=pi.id
    WHERE pi.id=? AND pi.org_id=? AND pi.client_id=? GROUP BY pi.id`,[dr.source_document_id,dr.org_id,dr.client_id]);
  if(!pi || !pi.content_hash || Number(pi.expected_total)!==Number(state.amount)
    || Number(pi.line_total)!==Number(pi.expected_total) || Number(pi.lines)!==Number(pi.recipient_count)) throw new Error('CANONICAL_PAYROLL_SETTLEMENT_CONTROL_MISMATCH');
  const conflicts=await d1First(database,`SELECT
    (SELECT COUNT(*) FROM payment_proofs WHERE payment_instruction_id=?) AS proofs,
    (SELECT COUNT(*) FROM payment_gateway_transactions WHERE payment_instruction_id=?) AS legacy`,[pi.id,pi.id]);
  if(Number(conflicts.proofs)||Number(conflicts.legacy)) throw new Error('CANONICAL_PAYROLL_SETTLEMENT_SOURCE_CONFLICT');
  const prior=await d1First(database,'SELECT status,proof_total FROM reconciliations WHERE payment_instruction_id=?',[pi.id]);
  if(pi.status==='COMPLETED' && prior?.status==='MATCHED' && Number(prior.proof_total)===Number(pi.expected_total)) {await markEwaRepaid(database,pi.submission_id);return {updated:false,idempotent:true};}
  await d1Batch(database,[
    {statement:`INSERT INTO reconciliations(id,payment_instruction_id,expected_total,instruction_total,proof_total,difference,status,reviewed_by)
      VALUES(?,?,?,?,?,0,'MATCHED',?) ON CONFLICT(payment_instruction_id) DO UPDATE SET expected_total=excluded.expected_total,instruction_total=excluded.instruction_total,proof_total=excluded.proof_total,difference=0,status='MATCHED',reviewed_by=excluded.reviewed_by`,bindings:[`REC-${crypto.randomUUID()}`,pi.id,pi.expected_total,pi.line_total,state.item_total,actorEmail]},
    {statement:`UPDATE payment_instructions SET status='COMPLETED',updated_at=datetime('now') WHERE id=? AND org_id=?`,bindings:[pi.id,dr.org_id]},
    {statement:`UPDATE payroll_submissions SET state='COMPLETED',updated_at=datetime('now') WHERE id=? AND org_id=?`,bindings:[pi.submission_id,dr.org_id]},
    {statement:`INSERT INTO audit_logs(id,org_id,username,role,action,detail,entity,entity_id) VALUES(?,?,?,'PAYROLL_CONTROLLER','CANONICAL_PAYROLL_SETTLED',?,'payment_instruction',?)`,bindings:[`AUD-${crypto.randomUUID()}`,dr.org_id,actorEmail,`dr=${dr.id} · provider-confirmed reconciliation · amount=${state.item_total}`,pi.id]},
  ]);
  await markEwaRepaid(database,pi.submission_id);
  return {updated:true};
}
