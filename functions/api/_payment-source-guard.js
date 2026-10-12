import { d1First } from './_d1.js';

// Financial strategies are mutually exclusive for the *same* source document.
// Legacy gateway activity, including terminal rows, is never replayed through DR.
export async function legacyGatewayForPi(database,orgId,piId){
  return d1First(database,`SELECT id,status FROM payment_gateway_transactions
    WHERE org_id=? AND payment_instruction_id=? LIMIT 1`,[orgId,piId]);
}
export async function canonicalDrForPi(database,orgId,piId){
  return d1First(database,`SELECT id,status FROM disbursement_requests
    WHERE org_id=? AND source_document_type='PAYMENT_INSTRUCTION' AND source_document_id=?
    AND (status NOT IN ('REJECTED','CANCELLED') OR EXISTS (SELECT 1 FROM disbursement_executions de WHERE de.disbursement_request_id=disbursement_requests.id)) LIMIT 1`,[orgId,piId]);
}
export async function canonicalDrForEwa(database,orgId,ewaId){
  return d1First(database,`SELECT id,status FROM disbursement_requests
    WHERE org_id=? AND source_document_type='EWA_REQUEST' AND source_document_id=?
    AND (status NOT IN ('REJECTED','CANCELLED') OR EXISTS (SELECT 1 FROM disbursement_executions de WHERE de.disbursement_request_id=disbursement_requests.id)) LIMIT 1`,[orgId,ewaId]);
}
export const LEGACY_FINANCIAL_PRESENT={status:409,code:'PAYMENT_SOURCE_ALREADY_EXECUTED_IN_LEGACY',error:'PI sudah memiliki gateway transaction legacy. Selesaikan dan reconcile melalui pipeline legacy, tanpa eksekusi canonical ulang.'};
export const CANONICAL_FINANCIAL_PRESENT={status:409,code:'PAYMENT_SOURCE_CANONICAL_STRATEGY_LOCKED',error:'PI sudah memiliki Canonical Disbursement Request aktif. Eksekusi gateway legacy diblokir.'};
