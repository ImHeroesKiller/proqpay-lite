import { d1All, d1Batch } from './_d1.js';
import { e2payAuthorize, e2payResponseStatus, e2payTransactionHistory } from './payment-gateway-e2pay.js';

const NOW="strftime('%Y-%m-%dT%H:%M:%fZ','now')";
function num(v){const n=Number(v||0);return Number.isFinite(n)?n:0;}

export function summarizeReconciliationItems(items=[]){
  const summary={total:items.length,succeeded:0,failed:0,unresolved:0,settledAmount:0,failedAmount:0,unresolvedAmount:0};
  for(const item of items){
    const amount=num(item.amount);
    if(item.status==='SUCCEEDED'){summary.succeeded++;summary.settledAmount+=amount;}
    else if(item.status==='FAILED'){summary.failed++;summary.failedAmount+=amount;}
    else if(['PENDING','PROCESSING','UNKNOWN'].includes(String(item.status))){summary.unresolved++;summary.unresolvedAmount+=amount;}
  }
  return summary;
}

export function canonicalReconciliationOutcome(summary){
  if(summary.unresolved>0) return {attemptStatus:'PENDING',executionStatus:'RECONCILIATION_REQUIRED',requestStatus:'RECONCILIATION_REQUIRED'};
  if(summary.total>summary.succeeded+summary.failed+summary.unresolved) return {attemptStatus:'PENDING',executionStatus:summary.failed?'RECONCILIATION_REQUIRED':'PROCESSING',requestStatus:summary.failed?'RECONCILIATION_REQUIRED':'PROCESSING'};
  if(summary.total>0&&summary.succeeded===summary.total) return {attemptStatus:'MATCHED',executionStatus:'SUCCEEDED',requestStatus:'RECONCILED'};
  if(summary.succeeded>0&&summary.failed>0) return {attemptStatus:'PARTIAL',executionStatus:'FAILED',requestStatus:'PARTIALLY_SETTLED'};
  if(summary.failed===summary.total&&summary.total>0) return {attemptStatus:'FAILED',executionStatus:'FAILED',requestStatus:'FAILED'};
  return {attemptStatus:'ERROR',executionStatus:'RECONCILIATION_REQUIRED',requestStatus:'RECONCILIATION_REQUIRED'};
}

export async function reconcileCanonicalE2Pay({database,env,execution,requestRow}){
  const auth=await e2payAuthorize(env);
  let items=await d1All(database,'SELECT * FROM disbursement_execution_items WHERE disbursement_execution_id=? ORDER BY created_at,id',[execution.id]);
  let providerFound=0,providerMissing=0;
  for(const item of items){
    if(!['PENDING','PROCESSING','UNKNOWN'].includes(String(item.status)) && !(item.status==='FAILED' && item.error_code==='E2PAY_INVALID_JSON' && Number(item.attempt_count)>0)) continue;
    try{
      const history=await e2payTransactionHistory(env,auth.accessToken,item.client_ref);
      if(!history){providerMissing++;await d1Batch(database,[{statement:`UPDATE disbursement_execution_items SET status='UNKNOWN' WHERE id=?`,bindings:[item.id]}]);await d1Batch(database,[{statement:`UPDATE disbursement_execution_items SET last_checked_at=${NOW},updated_at=${NOW} WHERE id=?`,bindings:[item.id]}]);continue;}
      providerFound++;
      const normalized=e2payResponseStatus(history.responseCode);
      const status=normalized==='PENDING'?'UNKNOWN':normalized;
      await d1Batch(database,[{statement:`UPDATE disbursement_execution_items SET status=?,provider_transaction_id=?,journal_id=?,response_code=?,response_message=?,last_checked_at=${NOW},error_code=?,error_message=?,updated_at=${NOW} WHERE id=?`,bindings:[status,String(history?.journalId||item.provider_transaction_id||'')||null,String(history?.journalId||item.journal_id||'')||null,String(history?.responseCode??''),String(history?.responseMessage||'').slice(0,300)||null,status==='FAILED'?'E2PAY_PROVIDER_REJECTED':null,status==='FAILED'?String(history?.responseMessage||'E2Pay transaction failed').slice(0,300):null,item.id]}]);
    }catch(error){
      await d1Batch(database,[{statement:`UPDATE disbursement_execution_items SET status='UNKNOWN',last_checked_at=${NOW},error_code='E2PAY_HISTORY_FAILED',error_message=?,updated_at=${NOW} WHERE id=?`,bindings:[String(error?.message||'Reconciliation history failed').slice(0,300),item.id]}]);
    }
  }
  items=await d1All(database,'SELECT * FROM disbursement_execution_items WHERE disbursement_execution_id=? ORDER BY created_at,id',[execution.id]);
  const summary=summarizeReconciliationItems(items);
  const outcome=canonicalReconciliationOutcome(summary);
  await d1Batch(database,[
    {statement:`UPDATE disbursement_executions SET status=?,error_code=?,error_message=?,completed_at=CASE WHEN ?='SUCCEEDED' THEN COALESCE(completed_at,${NOW}) ELSE completed_at END,updated_at=${NOW} WHERE id=?`,bindings:[outcome.executionStatus,outcome.executionStatus==='RECONCILIATION_REQUIRED'?'E2PAY_RECONCILIATION_REQUIRED':null,outcome.executionStatus==='RECONCILIATION_REQUIRED'?'Provider status unresolved':null,outcome.executionStatus,execution.id]},
    ...items.map(item=>({statement:`UPDATE disbursement_request_items SET provider_transaction_id=?,provider_status=?,status=?,error_code=?,error_message=?,settled_at=CASE WHEN ?='SETTLED' THEN COALESCE(settled_at,${NOW}) ELSE settled_at END,reconciled_at=CASE WHEN ? IN ('SETTLED','FAILED') THEN ${NOW} ELSE reconciled_at END,updated_at=${NOW} WHERE id=?`,bindings:[item.provider_transaction_id||null,item.response_code||null,item.status==='SUCCEEDED'?'SETTLED':item.status==='FAILED'?'FAILED':item.status==='UNKNOWN'?'UNKNOWN':'PROCESSING',item.error_code||null,item.error_message||null,item.status==='SUCCEEDED'?'SETTLED':'PROCESSING',item.status==='SUCCEEDED'?'SETTLED':item.status==='FAILED'?'FAILED':'PROCESSING',item.disbursement_request_item_id]})),
  ]);
  return {items,summary,outcome,providerFound,providerMissing};
}
