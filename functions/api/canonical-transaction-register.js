import { d1All, d1Batch, d1First, d1Run, hasD1 } from './_d1.js';
import { authorize, enforceRateLimit, handlePreflight, secureJson } from './_security.js';
import { gatewayRuntimeEnv } from './payment-gateway-settings-store.js';
import { scopedE2PayRuntimeEnv } from './payment-provider-account-credentials.js';
import { reconcileCanonicalE2Pay } from './disbursement-reconciliation-e2pay.js';
import { consumeDisbursementRequestLimit, releaseDisbursementRequestLimit } from './e2pay-disbursement-limit-core.js';
import { hasRecentMfa, mfaEnforcementMode } from './_security-context.js';
import { applyCanonicalEwaSettlement } from './ewa-canonical-settlement.js';

const METHODS='GET, POST, OPTIONS';
function clean(value,limit=200){return String(value??'').trim().replace(/[\r\n\t]+/g,' ').slice(0,limit);}
function orgId(env,actor){return String(actor?.orgId||env.DEFAULT_ORG_ID||'ORG-OTSINDO');}
function audit(org,actor,action,detail,id){return {statement:`INSERT INTO audit_logs(id,org_id,username,role,action,detail,entity,entity_id) VALUES(?,?,?,?,?,?, 'disbursement_request',?)`,bindings:[`AUD-${crypto.randomUUID()}`,org,actor.email||actor.name||'system',actor.role,action,clean(detail,1000),id]};}
function publicRegisterRow(row){
  return {
    disbursementRequestId:row.disbursement_request_id,clientId:row.client_id,projectId:row.project_id||null,purpose:row.purpose,
    destinationMode:row.destination_mode,beneficiaryType:row.beneficiary_type,sourceDocumentType:row.source_document_type,
    sourceDocumentId:row.source_document_id,provider:row.provider,environment:row.provider_environment,
    providerSubAccountIdMasked:row.provider_sub_account_id_snapshot?'••••'+String(row.provider_sub_account_id_snapshot).slice(-4):null,
    providerChannel:row.provider_channel||null,clientReference:row.client_reference,correlationId:row.correlation_id,
    amount:Number(row.amount||0),currency:row.currency,recipientCount:Number(row.recipient_count||0),status:row.disbursement_status,
    executionStatus:row.execution_status||null,reconciliationStatus:row.reconciliation_status||null,
    succeededItems:Number(row.succeeded_items||0),failedItems:Number(row.failed_items||0),unresolvedItems:Number(row.unresolved_items||0),
    settledAmount:Number(row.settled_amount||0),failedAmount:Number(row.failed_amount||0),requestedBy:row.requested_by_email||null,
    approvedBy:row.approved_by_email||null,requestedAt:row.requested_at||null,approvedAt:row.approved_at||null,
    executionStartedAt:row.execution_started_at||null,settledAt:row.settled_at||null,reconciledAt:row.reconciled_at||null,
    lastReconciledAt:row.last_reconciled_at||null,executionErrorCode:row.execution_error_code||null,executionErrorMessage:row.execution_error_message||null,
    createdAt:row.created_at,
  };
}
async function detail(database,org,id){
  const row=await d1First(database,'SELECT * FROM canonical_transaction_register WHERE org_id=? AND disbursement_request_id=? LIMIT 1',[org,id]);
  if(!row) return null;
  const execution=await d1First(database,'SELECT * FROM disbursement_executions WHERE org_id=? AND disbursement_request_id=? LIMIT 1',[org,id]);
  const items=execution?await d1All(database,`SELECT dei.id,dei.disbursement_request_item_id,dei.client_ref,dei.bank_id,dei.beneficiary_name,dei.provider_beneficiary_name,dei.account_last4,dei.amount,dei.fee_amount,dei.provider_transaction_id,dei.journal_id,dei.response_code,dei.response_message,dei.status,dei.attempt_count,dei.last_checked_at,dei.failure_stage,dei.error_code,dei.error_message,dri.beneficiary_type,dri.beneficiary_reference,dri.employee_id,dri.bank_code,dri.bank_name,dri.sequence_no
    FROM disbursement_execution_items dei JOIN disbursement_request_items dri ON dri.id=dei.disbursement_request_item_id
    WHERE dei.disbursement_execution_id=? ORDER BY dri.sequence_no`,[execution.id]):[];
  const attempts=await d1All(database,'SELECT id,status,total_items,succeeded_items,failed_items,unresolved_items,settled_amount,failed_amount,unresolved_amount,provider_found_count,provider_missing_count,correlation_id,error_code,error_message,created_by_email,created_at FROM disbursement_reconciliation_attempts WHERE org_id=? AND disbursement_request_id=? ORDER BY created_at DESC,id DESC LIMIT 50',[org,id]);
  return {register:publicRegisterRow(row),items:items.map(item=>({...item,amount:Number(item.amount||0),fee_amount:Number(item.fee_amount||0)})),reconciliationAttempts:attempts};
}
async function acquireLock(database,id){
  const token=crypto.randomUUID();
  const result=await d1Run(database,`UPDATE disbursement_executions SET execution_lock_token=?,execution_lock_expires_at=datetime('now','+2 minutes'),updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND (execution_lock_token IS NULL OR execution_lock_expires_at IS NULL OR datetime(execution_lock_expires_at)<=datetime('now'))`,[token,id]);
  return Number(result?.meta?.changes||0)===1?token:null;
}
async function releaseLock(database,id,token){await d1Run(database,`UPDATE disbursement_executions SET execution_lock_token=NULL,execution_lock_expires_at=NULL,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND execution_lock_token=?`,[id,token]);}

export async function onRequest({request,env}){
  if(request.method==='OPTIONS') return handlePreflight(request,env,METHODS);
  if(!['GET','POST'].includes(request.method)) return secureJson({error:'Method not allowed'},405,request,env,METHODS);
  const authorization=await authorize(request,env,{roles:['SUPER_ADMIN','PAYROLL_PROCESSOR','PAYROLL_CONTROLLER'],mutating:request.method==='POST',methods:METHODS});
  if(authorization.response) return authorization.response;
  const limited=await enforceRateLimit(request,env,authorization.actor,'canonical-transaction-register',METHODS);
  if(limited) return limited;
  if(!hasD1(env)) return secureJson({error:'Cloudflare D1 unavailable'},503,request,env,METHODS);
  const actor=authorization.actor;
  const organizationId=orgId(env,actor);

  if(request.method==='GET'){
    const url=new URL(request.url);
    const id=clean(url.searchParams.get('id'),140);
    if(id){const data=await detail(env.DB,organizationId,id);return data?secureJson({ok:true,...data},200,request,env,METHODS):secureJson({error:'Canonical transaction tidak ditemukan'},404,request,env,METHODS);}
    const purpose=clean(url.searchParams.get('purpose'),30).toUpperCase();
    const status=clean(url.searchParams.get('status'),50).toUpperCase();
    const clientId=clean(url.searchParams.get('clientId'),140);
    const reconciliation=clean(url.searchParams.get('reconciliationStatus'),30).toUpperCase();
    let where='org_id=?'; const bindings=[organizationId];
    if(purpose){where+=' AND purpose=?';bindings.push(purpose);}
    if(status){where+=' AND disbursement_status=?';bindings.push(status);}
    if(clientId){where+=' AND client_id=?';bindings.push(clientId);}
    if(reconciliation){where+=' AND COALESCE(reconciliation_status,\'NOT_RECONCILED\')=?';bindings.push(reconciliation);}
    const rows=await d1All(env.DB,`SELECT * FROM canonical_transaction_register WHERE ${where} ORDER BY created_at DESC LIMIT 300`,bindings);
    return secureJson({ok:true,transactions:rows.map(publicRegisterRow)},200,request,env,METHODS);
  }

  if(actor.role!=='PAYROLL_CONTROLLER'||!actor.permissions?.includes('reconciliation:write')) return secureJson({error:'Reconciliation membutuhkan Payroll Controller dan permission reconciliation:write',code:'CANONICAL_RECONCILIATION_PERMISSION_REQUIRED'},403,request,env,METHODS);
  const body=await request.json().catch(()=>null);
  const action=String(body?.action||'RECONCILE').toUpperCase();
  if(action!=='RECONCILE') return secureJson({error:'Action tidak didukung'},422,request,env,METHODS);
  if(mfaEnforcementMode(env)==='ENFORCE'&&!hasRecentMfa(actor,600)) return secureJson({error:'MFA step-up terbaru diperlukan sebelum reconciliation.',code:'MFA_STEP_UP_REQUIRED',stepUpWindowSeconds:600},428,request,env,METHODS);
  const id=clean(body?.disbursementRequestId,140);
  const dr=await d1First(env.DB,'SELECT * FROM disbursement_requests WHERE id=? AND org_id=? LIMIT 1',[id,organizationId]);
  if(!dr) return secureJson({error:'Disbursement Request tidak ditemukan'},404,request,env,METHODS);
  const execution=await d1First(env.DB,'SELECT * FROM disbursement_executions WHERE disbursement_request_id=? AND org_id=? LIMIT 1',[id,organizationId]);
  if(!execution) return secureJson({error:'Execution ledger tidak ditemukan'},404,request,env,METHODS);
  if(!['RECONCILIATION_REQUIRED','PROCESSING','FAILED','SUCCEEDED'].includes(String(execution.status))) return secureJson({error:'Execution belum pada state yang dapat direconcile',code:'CANONICAL_RECONCILIATION_STATE_INVALID'},409,request,env,METHODS);
  const lock=await acquireLock(env.DB,execution.id);
  if(!lock) return secureJson({error:'Execution sedang diproses request lain',code:'CANONICAL_RECONCILIATION_BUSY'},409,request,env,METHODS);
  try{
    const account=await d1First(env.DB,'SELECT * FROM payment_provider_accounts WHERE id=? AND org_id=? LIMIT 1',[dr.provider_account_registry_id,organizationId]);
    if(!account) return secureJson({error:'Provider account registry tidak ditemukan'},409,request,env,METHODS);
    const runtime=await gatewayRuntimeEnv(env.DB,env,organizationId,dr.provider_environment);
    const routed=await scopedE2PayRuntimeEnv(env.DB,runtime,account);
    const result=await reconcileCanonicalE2Pay({database:env.DB,env:routed,execution,requestRow:dr});
    const correlationId=crypto.randomUUID();
    const attemptId=`DRA-${crypto.randomUUID()}`;
    await d1Batch(env.DB,[
      {statement:`INSERT INTO disbursement_reconciliation_attempts(id,org_id,disbursement_request_id,disbursement_execution_id,provider,status,total_items,succeeded_items,failed_items,unresolved_items,settled_amount,failed_amount,unresolved_amount,provider_found_count,provider_missing_count,correlation_id,created_by_user_id,created_by_email) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,bindings:[attemptId,organizationId,dr.id,execution.id,dr.provider,result.outcome.attemptStatus,result.summary.total,result.summary.succeeded,result.summary.failed,result.summary.unresolved,result.summary.settledAmount,result.summary.failedAmount,result.summary.unresolvedAmount,result.providerFound,result.providerMissing,correlationId,actor.id||null,actor.email]},
      {statement:`UPDATE disbursement_requests SET status=?,reconciled_at=CASE WHEN ?='RECONCILED' THEN strftime('%Y-%m-%dT%H:%M:%fZ','now') ELSE reconciled_at END,settled_at=CASE WHEN ? IN ('RECONCILED','PARTIALLY_SETTLED') AND ?>0 THEN COALESCE(settled_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')) ELSE settled_at END,updated_by_user_id=?,updated_by_email=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`,bindings:[result.outcome.requestStatus,result.outcome.requestStatus,result.outcome.requestStatus,result.summary.settledAmount,actor.id||null,actor.email,dr.id]},
      audit(organizationId,actor,'CANONICAL_DISBURSEMENT_RECONCILED',`outcome=${result.outcome.attemptStatus} · providerFound=${result.providerFound} · providerMissing=${result.providerMissing} · success=${result.summary.succeeded}/${result.summary.total} · settled=${result.summary.settledAmount}`,dr.id),
    ]);
    if(result.outcome.attemptStatus==='MATCHED') await consumeDisbursementRequestLimit(env.DB,dr.id,result.summary.settledAmount);
    if(result.outcome.attemptStatus==='MATCHED') await applyCanonicalEwaSettlement(env.DB,dr,actor.email);
    else if(result.outcome.attemptStatus==='PARTIAL') await consumeDisbursementRequestLimit(env.DB,dr.id,result.summary.settledAmount);
    else if(result.outcome.attemptStatus==='FAILED') await releaseDisbursementRequestLimit(env.DB,dr.id,'RECONCILIATION_CONFIRMED_ALL_FAILED');
    return secureJson({ok:true,attemptId,outcome:result.outcome,summary:result.summary,providerFound:result.providerFound,providerMissing:result.providerMissing,...await detail(env.DB,organizationId,dr.id)},200,request,env,METHODS);
  }finally{await releaseLock(env.DB,execution.id,lock);}
}
