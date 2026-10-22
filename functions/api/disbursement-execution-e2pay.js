import { d1All, d1Batch, d1Run } from './_d1.js';
import { decryptAccountNumber, sha256Hex } from './payment-instruction-core.js';
import {automaticE2PaySourceFingerprint} from './e2pay-automatic-routing.js';
import {
  E2PayRequestError,
  e2payAuthorize,
  e2payBankList,
  e2payDisburse,
  e2payEffectiveDestination,
  e2payExecutionContract,
  e2payExecutionDiagnostics,
  e2payInquiry,
  e2payMerchantAccount,
  e2payResponseStatus,
  resolveE2PayBank,
} from './payment-gateway-e2pay.js';

const NOW="strftime('%Y-%m-%dT%H:%M:%fZ','now')";

function num(value){ const n=Number(value||0); return Number.isFinite(n)?n:0; }
function ambiguousError(error){
  // Once the financial request might have left the process, only a documented
  // rejection or a proven pre-send failure is final. Parsing errors are UNKNOWN.
  if(error instanceof E2PayRequestError){
    if(['E2PAY_AUDIT_REQUIRED','E2PAY_AUDIT_PREPARE_FAILED','E2PAY_TRANSACTION_INVALID'].includes(error.code)) return false;
    if(error.code==='E2PAY_HTTP_ERROR' && Number(error.httpStatus)>=400 && Number(error.httpStatus)<500 && ![408,429].includes(Number(error.httpStatus))) return false;
  }
  return true;
}
async function providerClientRef(request,item){
  const digest=await sha256Hex(`${request.id}|${item.id}|${request.routing_hash}|${item.beneficiary_hash}`);
  return `PQP-${digest.slice(0,28)}`;
}
async function updateExecution(database,id,fields){
  const names=Object.keys(fields); if(!names.length) return;
  await d1Batch(database,[{statement:`UPDATE disbursement_executions SET ${names.map(n=>`${n}=?`).join(',')},updated_at=${NOW} WHERE id=?`,bindings:[...names.map(n=>fields[n]),id]}]);
}
async function updateItem(database,id,fields){
  const names=Object.keys(fields); if(!names.length) return;
  await d1Batch(database,[{statement:`UPDATE disbursement_execution_items SET ${names.map(n=>`${n}=?`).join(',')},updated_at=${NOW} WHERE id=?`,bindings:[...names.map(n=>fields[n]),id]}]);
}
export function summarizeCanonicalExecutionItems(items=[]){
  const counts={}; for(const item of items) counts[item.status]=(counts[item.status]||0)+1;
  return {
    total:items.length,
    amount:items.reduce((s,i)=>s+num(i.amount),0),
    fees:items.reduce((s,i)=>s+num(i.fee_amount),0),
    succeeded:counts.SUCCEEDED||0,
    failed:counts.FAILED||0,
    unresolved:(counts.PENDING||0)+(counts.PROCESSING||0)+(counts.UNKNOWN||0),
    ready:(counts.CREATED||0)+(counts.INQUIRY_READY||0),
    counts,
  };
}
export function canonicalExecutionParentStatus(summary,remaining=0){
  const allSuccess=Number(summary?.total||0)>0&&Number(summary?.succeeded||0)===Number(summary?.total||0);
  const unresolved=Number(summary?.unresolved||0)>0;
  const partialFailure=Number(summary?.failed||0)>0&&(Number(summary?.succeeded||0)>0||unresolved);
  if(allSuccess) return 'SUCCEEDED';
  if(unresolved||partialFailure) return 'RECONCILIATION_REQUIRED';
  if(Number(remaining||0)>0) return 'PROCESSING';
  if(Number(summary?.failed||0)>0) return 'FAILED';
  return 'PROCESSING';
}

async function ensureExecutionItems(database,execution,request,requestItems){
  const existing=await d1All(database,'SELECT * FROM disbursement_execution_items WHERE disbursement_execution_id=? ORDER BY created_at,id',[execution.id]);
  const known=new Set(existing.map(row=>row.disbursement_request_item_id));
  const ops=[];
  for(const item of requestItems){
    if(known.has(item.id)) continue;
    ops.push({statement:`INSERT OR IGNORE INTO disbursement_execution_items(
      id,disbursement_execution_id,disbursement_request_item_id,provider,client_ref,beneficiary_name,account_last4,amount,status
    ) VALUES(?,?,?,?,?,?,?,?,'CREATED')`,bindings:[
      `DXI-${crypto.randomUUID()}`,execution.id,item.id,'E2PAY',await providerClientRef(request,item),item.beneficiary_name,item.account_number_last4,Number(item.amount),
    ]});
  }
  for(let i=0;i<ops.length;i+=50) await d1Batch(database,ops.slice(i,i+50));
  return d1All(database,'SELECT * FROM disbursement_execution_items WHERE disbursement_execution_id=? ORDER BY created_at,id',[execution.id]);
}

export async function executeCanonicalE2Pay({database,env,execution,request,requestItems,channelSnapshot,liquidityBalance=null,assertExecutionLock=async()=>{}}){
  let items=await ensureExecutionItems(database,execution,request,requestItems);
  if(items.some(item=>['PENDING','PROCESSING','UNKNOWN'].includes(String(item.status)))){
    await updateExecution(database,execution.id,{status:'RECONCILIATION_REQUIRED',error_code:'E2PAY_RECONCILIATION_REQUIRED',error_message:'Provider status unresolved; financial retry blocked'});
    return {ok:false,statusCode:409,parentStatus:'RECONCILIATION_REQUIRED',code:'E2PAY_RECONCILIATION_REQUIRED',summary:summarizeCanonicalExecutionItems(items),items};
  }

  if(channelSnapshot?.routingMode==='AUTOMATIC' && (
    channelSnapshot.environment!==String(env.E2PAY_ENV||'UAT').toUpperCase()
    || channelSnapshot.providerAccountRegistryId!==request.provider_account_registry_id
    || channelSnapshot.sourceFingerprint!==await automaticE2PaySourceFingerprint(request.org_id,request.provider_account_registry_id,env)
  )){
    const financialPostStarted=items.some(item=>Number(item.attempt_count)>0||item.status==='SUCCEEDED');
    const parentStatus=financialPostStarted?'RECONCILIATION_REQUIRED':'FAILED';
    await updateExecution(database,execution.id,{status:parentStatus,error_code:'MASTER_ROUTING_SOURCE_CHANGED',error_message:'Master source differs from approved routing snapshot'});
    return {ok:false,statusCode:409,parentStatus,code:'MASTER_ROUTING_SOURCE_CHANGED',financialPostStarted,summary:summarizeCanonicalExecutionItems(items),items};
  }
  if(items.some(item=>item.status==='FAILED')){
    const financialPostStarted=items.some(item=>Number(item.attempt_count)>0||item.status==='SUCCEEDED');
    const parentStatus=financialPostStarted?'RECONCILIATION_REQUIRED':'FAILED';
    await updateExecution(database,execution.id,{status:parentStatus,error_code:'E2PAY_PREFLIGHT_FAILED',error_message:'Review failed beneficiaries before controlled recovery'});
    return {ok:false,statusCode:409,parentStatus,code:'E2PAY_PREFLIGHT_FAILED',error:'Pemeriksaan rekening sebelumnya gagal. Tinjau diagnostik sebelum pemulihan terkontrol.',summary:summarizeCanonicalExecutionItems(items),items,financialPostStarted};
  }
  const auth=await e2payAuthorize(env);
  const [merchant,banks]=await Promise.all([e2payMerchantAccount(env,auth.accessToken),e2payBankList(env,auth.accessToken)]);
  const contract=e2payExecutionContract(env,merchant);
  if(!contract.valid || String(merchant?.merchantStatus||'').toUpperCase()!=='ACTIVE'){
    await updateExecution(database,execution.id,{status:'FAILED',error_code:contract.issues[0]||'E2PAY_EXECUTION_CONTRACT_INVALID',error_message:'E2Pay execution contract invalid'});
    return {ok:false,statusCode:409,parentStatus:'FAILED',code:contract.issues[0]||'E2PAY_EXECUTION_CONTRACT_INVALID',executionContract:contract,summary:summarizeCanonicalExecutionItems(items),items};
  }

  const requestById=new Map(requestItems.map(item=>[item.id,item]));
  // Inquiry and financial POST have separate bounded phases. Never send funds
  // until ALL beneficiaries passed preflight. Resume only untouched CREATED rows.
  const inquiryLimit=Math.max(1,Math.min(5,Math.trunc(Number(env.E2PAY_INQUIRY_BATCH_LIMIT)||5)));
  const inquiryDeadline=Date.now()+20000;
  for(const ledger of items.filter(item=>item.status==='CREATED').slice(0,inquiryLimit)){
    if(Date.now()>=inquiryDeadline) break;
    await assertExecutionLock();
    const source=requestById.get(ledger.disbursement_request_item_id);
    if(!source) continue;
    let accountNumber='';
    try{ accountNumber=await decryptAccountNumber(source.account_number_ciphertext,source.account_number_iv,env.PI_ENCRYPTION_KEY); }
    catch{
      await updateItem(database,ledger.id,{status:'FAILED',failure_stage:'PREFLIGHT',error_code:'BENEFICIARY_SNAPSHOT_DECRYPT_FAILED',error_message:'Beneficiary snapshot cannot be decrypted'});
      break;
    }
    const beneficiary={bankCode:source.bank_code,bankName:source.bank_name,accountNumber,amount:Number(source.amount)};
    const destination=e2payEffectiveDestination(env,beneficiary);
    const bank=destination.isUatDummy
      ? resolveE2PayBank(banks,{bankCode:destination.bankId,bankName:destination.bankId})
      : resolveE2PayBank(banks,beneficiary);
    if(!bank){
      await updateItem(database,ledger.id,{status:'FAILED',failure_stage:'PREFLIGHT',error_code:'E2PAY_BANK_NOT_MAPPED',error_message:'Bank beneficiary tidak ditemukan pada directory E2Pay'});
      break;
    }
    try{
      const inquiry=await e2payInquiry(env,auth.accessToken,{accountId:destination.accountId,bankId:bank.id,amount:destination.amount});
      const returnedAccount=String(inquiry?.accountId||'').trim();
      const returnedAmount=Math.trunc(num(inquiry?.amount));
      const inquiryId=String(inquiry?.id||'').trim();
      if(!inquiryId||returnedAccount!==destination.accountId||returnedAmount!==destination.amount||String(inquiry?.bankId||'')!==String(bank.id)){
        await updateItem(database,ledger.id,{status:'FAILED',bank_id:String(bank.id),failure_stage:'PREFLIGHT',error_code:'E2PAY_INQUIRY_CONTROL_MISMATCH',error_message:'Inquiry response tidak sesuai beneficiary snapshot'});
        break;
      }
      await updateItem(database,ledger.id,{status:'INQUIRY_READY',bank_id:String(bank.id),provider_beneficiary_name:String(inquiry?.name||'').slice(0,180)||null,inquiry_id:inquiryId,fee_amount:Math.max(0,Math.trunc(num(inquiry?.feeAmount))),error_code:null,error_message:null});
    }catch(error){
      await updateItem(database,ledger.id,{status:'FAILED',bank_id:String(bank.id),failure_stage:'PREFLIGHT',error_code:error instanceof E2PayRequestError?error.code:'E2PAY_INQUIRY_FAILED',error_message:String(error?.message||'Inquiry E2Pay gagal').slice(0,300)});
      // Fail fast: a rejected or unavailable inquiry cannot be followed by transfers.
      break;
    }
  }

  items=await d1All(database,'SELECT * FROM disbursement_execution_items WHERE disbursement_execution_id=? ORDER BY created_at,id',[execution.id]);
  let summary=summarizeCanonicalExecutionItems(items);
  if(summary.failed>0){
    if(summary.succeeded>0||summary.unresolved>0){
      await updateExecution(database,execution.id,{status:'RECONCILIATION_REQUIRED',error_code:'E2PAY_PARTIAL_FAILURE',error_message:'Preflight failed after prior financial activity'});
      return {ok:false,statusCode:409,parentStatus:'RECONCILIATION_REQUIRED',code:'E2PAY_PARTIAL_FAILURE',summary,items,financialPostStarted:true};
    }
    await updateExecution(database,execution.id,{status:'FAILED',error_code:'E2PAY_PREFLIGHT_FAILED',error_message:`${summary.failed} beneficiary gagal preflight`});
    return {ok:false,statusCode:409,parentStatus:'FAILED',code:'E2PAY_PREFLIGHT_FAILED',error:`Pemeriksaan rekening gagal: ${items.find(item=>item.status==='FAILED')?.error_message||'Tinjau diagnostik E2Pay'}`,summary,items,financialPostStarted:false};
  }
  const inquiryRemaining=items.filter(item=>item.status==='CREATED').length;
  if(inquiryRemaining>0){
    await updateExecution(database,execution.id,{status:'PROCESSING',error_code:null,error_message:null});
    return {ok:true,statusCode:202,parentStatus:'PROCESSING',phase:'INQUIRY',summary,items,hasMore:true,remaining:inquiryRemaining,financialPostStarted:false};
  }
  const remainingRequired=items.filter(item=>item.status==='INQUIRY_READY').reduce((sum,item)=>sum+num(item.amount)+num(item.fee_amount),0);
  const liveBalance=Number(merchant?.balance);
  const merchantBalance=Number.isFinite(liveBalance)&&liveBalance>=0
    ? (liquidityBalance===null||liquidityBalance===undefined?liveBalance:Math.min(liveBalance,num(liquidityBalance))) : 0;
  if(merchantBalance<remainingRequired){
    await updateExecution(database,execution.id,{status:'FAILED',error_code:'E2PAY_INSUFFICIENT_BALANCE',error_message:`Balance ${merchantBalance} < required ${remainingRequired}`});
    return {ok:false,statusCode:409,parentStatus:'FAILED',code:'E2PAY_INSUFFICIENT_BALANCE',summary,items,merchantBalance,requiredBalance:remainingRequired,financialPostStarted:items.some(item=>Number(item.attempt_count||0)>0)};
  }

  const maxChunk=Math.max(1,Math.min(25,Number(env.E2PAY_SYNC_BENEFICIARY_LIMIT||25)||25));
  const paymentChunk=items.filter(item=>item.status==='INQUIRY_READY'&&Number(item.attempt_count||0)===0).slice(0,maxChunk);
  for(const ledger of paymentChunk){
    const source=requestById.get(ledger.disbursement_request_item_id);
    if(!source) continue;
    const prefix=String(channelSnapshot?.metadata?.descriptionPrefix||channelSnapshot?.providerChannel||request.purpose||'PQP').slice(0,24);
    const description=`${prefix} ${request.client_reference} ${source.sequence_no}`;
    const diagnostics=await e2payExecutionDiagnostics(env,{clientRef:ledger.client_ref,description,inquiryId:ledger.inquiry_id},merchant);
    await assertExecutionLock();
    // Atomic claim is a second fence against a stale worker after lock expiry.
    const claim=await d1Run(database,`UPDATE disbursement_execution_items SET status='PENDING',attempt_count=attempt_count+1,last_attempt_at=?,failure_stage='DISBURSEMENT_POST',request_diagnostics_json=?,updated_at=${NOW} WHERE id=? AND status='INQUIRY_READY' AND attempt_count=0`,[new Date().toISOString(),JSON.stringify({...diagnostics,providerChannel:channelSnapshot?.providerChannel||null,channelConfigHash:channelSnapshot?.configHash||null}),ledger.id]);
    if(Number(claim?.meta?.changes||0)!==1) break;
    let result;
    try{ result=await e2payDisburse(env,auth.accessToken,{clientRef:ledger.client_ref,description,inquiryId:ledger.inquiry_id}); }
    catch(error){
      const ambiguous=ambiguousError(error);
      await updateItem(database,ledger.id,{status:ambiguous?'UNKNOWN':'FAILED',last_checked_at:new Date().toISOString(),failure_stage:'DISBURSEMENT_POST',error_code:error instanceof E2PayRequestError?error.code:'E2PAY_TRANSACTION_FAILED',error_message:String(error?.message||'Transaksi E2Pay gagal').slice(0,300)});
      if(ambiguous) break;
      continue;
    }
    const providerStatus=e2payResponseStatus(result?.responseCode);
    const status=providerStatus==='PENDING'?'UNKNOWN':providerStatus;
    try{
      await updateItem(database,ledger.id,{status,provider_transaction_id:String(result?.journalId||'')||null,journal_id:String(result?.journalId||'')||null,response_code:String(result?.responseCode??''),response_message:String(result?.responseMessage||'').slice(0,300)||null,last_checked_at:new Date().toISOString(),failure_stage:status==='FAILED'?'PROVIDER_RESPONSE':null,error_code:status==='FAILED'?'E2PAY_PROVIDER_REJECTED':null,error_message:status==='FAILED'?String(result?.responseMessage||'E2Pay transaction failed').slice(0,300):null});
    }catch{
      try{ await updateItem(database,ledger.id,{status:'UNKNOWN',last_checked_at:new Date().toISOString(),error_code:'E2PAY_RESULT_PERSISTENCE_UNKNOWN',error_message:'Provider merespons tetapi hasil belum dapat dipersist; reconcile wajib'}); }catch{}
      break;
    }
  }

  items=await d1All(database,'SELECT * FROM disbursement_execution_items WHERE disbursement_execution_id=? ORDER BY created_at,id',[execution.id]);
  summary=summarizeCanonicalExecutionItems(items);
  const unresolved=summary.unresolved>0;
  const remaining=items.filter(item=>item.status==='INQUIRY_READY'&&Number(item.attempt_count||0)===0).length;
  const partialFailure=summary.failed>0&&(summary.succeeded>0||unresolved);
  const parentStatus=canonicalExecutionParentStatus(summary,remaining);
  await updateExecution(database,execution.id,{status:parentStatus,error_code:unresolved?'E2PAY_EXECUTION_UNKNOWN':partialFailure?'E2PAY_PARTIAL_FAILURE':null,error_message:unresolved?'Provider status unresolved; reconcile before retry':partialFailure?`${summary.failed} beneficiary gagal`:null,completed_at:parentStatus==='SUCCEEDED'?new Date().toISOString():null});
  return {ok:!unresolved,statusCode:unresolved?409:201,parentStatus,summary,items,merchantBalance,hasMore:remaining>0,remaining,financialPostStarted:items.some(item=>Number(item.attempt_count||0)>0)};
}
