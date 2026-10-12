import { d1All, d1Batch, d1First, d1Run, hasD1 } from './_d1.js';
import { authorize, enforceRateLimit, handlePreflight, publicError, secureJson } from './_security.js';
import { gatewayRuntimeEnv } from './payment-gateway-settings-store.js';
import { scopedE2PayRuntimeEnv, providerAccountCredentialState } from './payment-provider-account-credentials.js';
import { validateProviderChannelSnapshot } from './provider-channel-router.js';
import { executeCanonicalE2Pay } from './disbursement-execution-e2pay.js';
import { readProviderFundingState, reserveDisbursementRequestLimit, consumeDisbursementRequestLimit, releaseDisbursementRequestLimit } from './e2pay-disbursement-limit-core.js';
import { actorFraudDecision, beneficiaryFraudDecision, paymentLimitDecision } from './_fraud-controls.js';
import { recordFraudIncident } from './_fraud-incidents.js';
import { hasRecentMfa, mfaEnforcementMode } from './_security-context.js';
import { decryptAccountNumber, sha256Hex } from './payment-instruction-core.js';
import { roleHasCapability } from '../../shared/authority-matrix.js';

const METHODS='GET, POST, OPTIONS';
function orgId(env,actor){ return String(actor?.orgId||env.DEFAULT_ORG_ID||'ORG-OTSINDO'); }
function clean(value,limit=500){ return String(value??'').trim().replace(/[\r\n\t]+/g,' ').slice(0,limit); }
function audit(org,actor,action,detail,id){ return {statement:`INSERT INTO audit_logs(id,org_id,username,role,action,detail,entity,entity_id) VALUES(?,?,?,?,?,?, 'disbursement_request',?)`,bindings:[`AUD-${crypto.randomUUID()}`,org,actor.email||actor.name||'system',actor.role,action,clean(detail,1000),id]}; }
function safeExecution(row){
  if(!row) return null;
  const {execution_lock_token,request_hash,idempotency_key,...safe}=row;
  return safe;
}
function safeItem(row){
  if(!row) return null;
  const {request_diagnostics_json,...safe}=row;
  let requestDiagnostics=null; try{ requestDiagnostics=request_diagnostics_json?JSON.parse(request_diagnostics_json):null; }catch{}
  return {...safe,requestDiagnostics};
}
async function loadExecution(database,org,drId){
  return d1First(database,'SELECT * FROM disbursement_executions WHERE org_id=? AND disbursement_request_id=? LIMIT 1',[org,drId]);
}
async function acquireLock(database,id){
  const token=crypto.randomUUID();
  const result=await d1Run(database,`UPDATE disbursement_executions SET execution_lock_token=?,execution_lock_expires_at=datetime('now','+2 minutes'),updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND (execution_lock_token IS NULL OR execution_lock_expires_at IS NULL OR datetime(execution_lock_expires_at)<=datetime('now'))`,[token,id]);
  return Number(result?.meta?.changes||0)===1?token:null;
}
async function releaseLock(database,id,token){
  await d1Run(database,`UPDATE disbursement_executions SET execution_lock_token=NULL,execution_lock_expires_at=NULL,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND execution_lock_token=?`,[id,token]);
}

export async function onRequest({request,env}){
  if(request.method==='OPTIONS') return handlePreflight(request,env,METHODS);
  if(!['GET','POST'].includes(request.method)) return secureJson({error:'Method not allowed'},405,request,env,METHODS);
  const authorization=await authorize(request,env,{mutating:request.method==='POST',methods:METHODS});
  if(authorization.response) return authorization.response;
  const limited=await enforceRateLimit(request,env,authorization.actor,'disbursement-executions',METHODS);
  if(limited) return limited;
  if(!hasD1(env)) return secureJson({error:'Cloudflare D1 unavailable'},503,request,env,METHODS);
  const actor=authorization.actor;
  const organizationId=orgId(env,actor);

  if(request.method==='GET'){
    const url=new URL(request.url);
    const drId=clean(url.searchParams.get('disbursementRequestId'),140);
    const execution=drId?await loadExecution(env.DB,organizationId,drId):null;
    if(drId&&!execution) return secureJson({error:'Execution ledger belum tersedia'},404,request,env,METHODS);
    const items=execution?await d1All(env.DB,'SELECT * FROM disbursement_execution_items WHERE disbursement_execution_id=? ORDER BY created_at,id',[execution.id]):[];
    return secureJson({ok:true,execution:safeExecution(execution),items:items.map(safeItem)},200,request,env,METHODS);
  }

  if(actor.role!=='PAYROLL_CONTROLLER'||!roleHasCapability(actor.role,'gateway:execute')) return secureJson({error:'Hanya Payroll Controller yang dapat mengeksekusi disbursement',code:'DISBURSEMENT_EXECUTE_PERMISSION_REQUIRED'},403,request,env,METHODS);
  const body=await request.json().catch(()=>null);
  const action=String(body?.action||'EXECUTE').toUpperCase();
  if(action!=='EXECUTE') return secureJson({error:'Action tidak didukung. Retry/reconcile ditangani bundle reconciliation terkontrol.',code:'DISBURSEMENT_EXECUTION_ACTION_UNSUPPORTED'},422,request,env,METHODS);
  const drId=clean(body?.disbursementRequestId,140);
  if(!drId) return secureJson({error:'disbursementRequestId wajib'},422,request,env,METHODS);

  try{
    const dr=await d1First(env.DB,'SELECT * FROM disbursement_requests WHERE id=? AND org_id=? LIMIT 1',[drId,organizationId]);
    if(!dr) return secureJson({error:'Disbursement Request tidak ditemukan'},404,request,env,METHODS);
    let execution=await loadExecution(env.DB,organizationId,drId);
    if(execution?.status==='SUCCEEDED') return secureJson({ok:true,execution:safeExecution(execution),idempotentReplay:true},200,request,env,METHODS);
    if(execution?.status==='RECONCILIATION_REQUIRED'||dr.status==='RECONCILIATION_REQUIRED') return secureJson({error:'Status provider belum final. Reconciliation wajib sebelum tindakan berikutnya.',code:'E2PAY_RECONCILIATION_REQUIRED',execution:safeExecution(execution)},409,request,env,METHODS);
    if(execution?.status==='FAILED') return secureJson({error:'Execution sebelumnya gagal. Blind retry diblokir; review/reconciliation diperlukan.',code:'DISBURSEMENT_CONTROLLED_RECOVERY_REQUIRED',execution:safeExecution(execution)},409,request,env,METHODS);
    if(!['APPROVED','EXECUTING','PROCESSING'].includes(String(dr.status))) return secureJson({error:`DR berstatus ${dr.status} belum dapat dieksekusi`,code:'DISBURSEMENT_NOT_APPROVED'},409,request,env,METHODS);

    const route=await validateProviderChannelSnapshot(env.DB,dr);
    if(!route.ok) return secureJson({error:'Provider channel snapshot tidak valid untuk execution',code:route.code},409,request,env,METHODS);
    const account=await d1First(env.DB,`SELECT * FROM payment_provider_accounts WHERE id=? AND org_id=? AND provider=? AND environment=? AND status='ACTIVE' LIMIT 1`,[dr.provider_account_registry_id,organizationId,dr.provider,dr.provider_environment]);
    if(!account||String(account.provider_sub_account_id)!==String(dr.provider_sub_account_id_snapshot)) return secureJson({error:'Provider routing snapshot mismatch',code:'DISBURSEMENT_PROVIDER_SNAPSHOT_MISMATCH'},409,request,env,METHODS);
    if(!providerAccountCredentialState(account).ready) return secureJson({error:'Scoped credential provider belum READY',code:'PAYMENT_READINESS_CREDENTIAL_PENDING'},409,request,env,METHODS);

    const actorFraud=await actorFraudDecision(env.DB,organizationId,actor,env);
    if(actorFraud.blocked) return secureJson({error:'Execution diblokir kontrol fraud actor',code:actorFraud.code||'DISBURSEMENT_FRAUD_BLOCKED'},403,request,env,METHODS);
    const risk=await paymentLimitDecision(env.DB,organizationId,{expected_total:Number(dr.amount),recipient_count:Number(dr.recipient_count)},{isNewExecution:!execution});
    if(risk.blocked) return secureJson({error:'Execution diblokir security transaction limit',code:risk.code,risk},409,request,env,METHODS);
    if(mfaEnforcementMode(env)==='ENFORCE'&&!hasRecentMfa(actor,risk.limits.stepUpWindowSeconds)) return secureJson({error:'MFA step-up terbaru diperlukan sebelum execution.',code:'MFA_STEP_UP_REQUIRED',stepUpWindowSeconds:risk.limits.stepUpWindowSeconds},428,request,env,METHODS);

    const requestItems=await d1All(env.DB,'SELECT * FROM disbursement_request_items WHERE disbursement_request_id=? ORDER BY sequence_no',[dr.id]);
    if(requestItems.length!==Number(dr.recipient_count)||requestItems.reduce((sum,row)=>sum+Number(row.amount||0),0)!==Number(dr.amount)) return secureJson({error:'Canonical DR control total/recipient snapshot mismatch',code:'DISBURSEMENT_CONTROL_TOTAL_MISMATCH'},409,request,env,METHODS);
    const beneficiaries=[];
    for(const item of requestItems){
      try{ beneficiaries.push({employeeId:item.employee_id||null,accountNumber:await decryptAccountNumber(item.account_number_ciphertext,item.account_number_iv,env.PI_ENCRYPTION_KEY)}); }
      catch{ return secureJson({error:'Beneficiary snapshot gagal diverifikasi',code:'DISBURSEMENT_BENEFICIARY_DECRYPT_FAILED'},409,request,env,METHODS); }
    }
    const beneficiaryFraud=await beneficiaryFraudDecision(env.DB,organizationId,beneficiaries,env);
    if(beneficiaryFraud.blocked){
      await recordFraudIncident(env.DB,{orgId:organizationId,source:'DISBURSEMENT_REQUEST',ruleCode:beneficiaryFraud.code||'FRAUD_BLOCK_BENEFICIARY_ACCOUNT',severity:'CRITICAL',entity:'disbursement_request',entityId:dr.id,actorUserId:actor.id||null,actorIpHash:actor.requestIpHash||actor.sessionIpHash||null,actorDeviceHash:actor.requestDeviceHash||actor.sessionDeviceHash||null,summary:'Canonical disbursement blocked because beneficiary account matched fraud blocklist',metadata:{matches:beneficiaryFraud.matches.map(item=>({employeeId:item.employeeId,accountLast4:item.accountLast4,blockId:item.blockId}))}});
      return secureJson({error:'Disbursement diblokir karena rekening beneficiary berada pada fraud blocklist.',code:beneficiaryFraud.code,blockedBeneficiaries:beneficiaryFraud.matches.map(item=>({employeeId:item.employeeId,accountLast4:item.accountLast4}))},409,request,env,METHODS);
    }

    const funding=await readProviderFundingState(env.DB,organizationId,dr.provider_account_registry_id,Number(dr.amount),null,Date.now(),dr.id);
    if(!funding.ready) return secureJson({error:'Funding/sub-client balance/approved limit belum siap untuk execution.',code:`E2PAY_FUNDING_${funding.state}`,funding},409,request,env,METHODS);
    const reservation=await reserveDisbursementRequestLimit(env.DB,{organizationId,providerAccountRegistryId:dr.provider_account_registry_id,disbursementRequestId:dr.id,amount:Number(dr.amount)});
    if(!reservation.ok) return secureJson({error:'Approved disbursement limit berubah atau tidak mencukupi saat reservation.',code:reservation.code,funding},409,request,env,METHODS);

    let channelSnapshot; try{channelSnapshot=JSON.parse(String(dr.provider_channel_snapshot||'{}'));}catch{channelSnapshot={};}
    const requestHash=await sha256Hex(JSON.stringify({drId:dr.id,routingHash:dr.routing_hash,channelConfigHash:channelSnapshot.configHash,amount:Number(dr.amount),items:requestItems.map(i=>[i.id,i.beneficiary_hash,Number(i.amount)])}));
    const idempotencyKey=await sha256Hex(`DR_EXECUTION|${dr.id}|${dr.idempotency_key}|${channelSnapshot.configHash||''}`);
    if(!execution){
      const id=`DX-${crypto.randomUUID()}`;
      try{
        await d1Batch(env.DB,[{statement:`INSERT INTO disbursement_executions(id,org_id,client_id,disbursement_request_id,provider,provider_account_registry_id,provider_channel,status,amount,currency,idempotency_key,request_hash,created_by,actor_user_id,actor_ip_hash,actor_device_hash,mfa_verified_at,risk_decision_json) VALUES(?,?,?,?,?,?,?,'CREATED',?,'IDR',?,?,?,?,?,?,?,?)`,bindings:[id,organizationId,dr.client_id,dr.id,dr.provider,dr.provider_account_registry_id,channelSnapshot.providerChannel||'UNKNOWN',Number(dr.amount),idempotencyKey,requestHash,actor.email,actor.id||null,actor.requestIpHash||actor.sessionIpHash||null,actor.requestDeviceHash||actor.sessionDeviceHash||null,actor.mfaVerifiedAt||null,JSON.stringify(risk)]},audit(organizationId,actor,'DISBURSEMENT_EXECUTION_LEDGER_CREATED',`execution=${id} · channel=${channelSnapshot.providerChannel} · amount=${dr.amount}`,dr.id)]);
      }catch(error){
        if(!/UNIQUE constraint failed/i.test(String(error?.message||error))) throw error;
      }
      execution=await loadExecution(env.DB,organizationId,dr.id);
    }else if(execution.request_hash!==requestHash){
      return secureJson({error:'Execution request hash berbeda dari ledger canonical',code:'DISBURSEMENT_EXECUTION_REQUEST_MISMATCH'},409,request,env,METHODS);
    }

    const lock=await acquireLock(env.DB,execution.id);
    if(!lock) return secureJson({error:'Disbursement sedang diproses request lain',code:'DISBURSEMENT_EXECUTION_BUSY'},409,request,env,METHODS);
    try{
      const runtime=await gatewayRuntimeEnv(env.DB,env,organizationId,dr.provider_environment);
      const routedEnv=await scopedE2PayRuntimeEnv(env.DB,runtime,account);
      await d1Batch(env.DB,[{statement:`UPDATE disbursement_requests SET status='EXECUTING',execution_started_at=COALESCE(execution_started_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')),updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status IN ('APPROVED','PROCESSING','EXECUTING')`,bindings:[dr.id]}]);
      const result=await executeCanonicalE2Pay({database:env.DB,env:routedEnv,execution,request:dr,requestItems,channelSnapshot,liquidityBalance:account.available_balance});
      let nextDrStatus='PROCESSING';
      if(result.parentStatus==='SUCCEEDED') nextDrStatus='SETTLED';
      else if(result.parentStatus==='RECONCILIATION_REQUIRED') nextDrStatus='RECONCILIATION_REQUIRED';
      else if(result.parentStatus==='FAILED') nextDrStatus='FAILED';
      await d1Batch(env.DB,[
        {statement:`UPDATE disbursement_requests SET status=?,settled_at=CASE WHEN ?='SETTLED' THEN strftime('%Y-%m-%dT%H:%M:%fZ','now') ELSE settled_at END,updated_by_user_id=?,updated_by_email=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`,bindings:[nextDrStatus,nextDrStatus,actor.id||null,actor.email,dr.id]},
        audit(organizationId,actor,result.parentStatus==='SUCCEEDED'?'DISBURSEMENT_SETTLED':result.parentStatus==='RECONCILIATION_REQUIRED'?'DISBURSEMENT_EXECUTION_UNCERTAIN':result.parentStatus==='FAILED'?'DISBURSEMENT_EXECUTION_FAILED':'DISBURSEMENT_EXECUTION_PROCESSING',`execution=${execution.id} · provider=${dr.provider} · channel=${channelSnapshot.providerChannel} · status=${result.parentStatus} · succeeded=${result.summary?.succeeded||0}/${result.summary?.total||requestItems.length}`,dr.id),
      ]);
      if(result.parentStatus==='SUCCEEDED') await consumeDisbursementRequestLimit(env.DB,dr.id,Number(dr.amount));
      else if(result.parentStatus==='FAILED'&&!result.financialPostStarted) await releaseDisbursementRequestLimit(env.DB,dr.id,'PRE_PROVIDER_EXECUTION_FAILED');
      execution=await loadExecution(env.DB,organizationId,dr.id);
      const items=await d1All(env.DB,'SELECT * FROM disbursement_execution_items WHERE disbursement_execution_id=? ORDER BY created_at,id',[execution.id]);
      return secureJson({...result,execution:safeExecution(execution),items:items.map(safeItem),funding},result.statusCode||200,request,env,METHODS);
    }finally{
      await releaseLock(env.DB,execution.id,lock);
    }
  }catch(error){
    const requestId=crypto.randomUUID();
    return secureJson(publicError(error,requestId),500,request,env,METHODS);
  }
}
