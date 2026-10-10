import { d1All, d1Batch, d1First, hasD1 } from './_d1.js';
import { authorize, enforceRateLimit, handlePreflight, secureJson } from './_security.js';
import { activeProviderAccount } from './payment-provider-routing.js';
import { providerAccountCredentialState } from './payment-provider-account-credentials.js';
import { canonicalBankCode, encryptAccountNumber, sha256Hex } from './payment-instruction-core.js';
import { revealEmployeeBankAccount } from './_employee-bank-security.js';
import { gatewayRuntimeEnv } from './payment-gateway-settings-store.js';
import { canonicalSourceType, disbursementIdentity, intentFromSource, publicDisbursementRequest } from './disbursement-request-core.js';

const METHODS='GET, POST, OPTIONS';
const SOURCE_READY_PI=new Set(['PAYMENT_APPROVAL_PENDING','APPROVED_FOR_PAYMENT']);

function orgId(env,actor){ return String(actor?.orgId||env.DEFAULT_ORG_ID||'ORG-OTSINDO'); }
function clean(value,limit=180){ return String(value??'').trim().replace(/[\r\n\t]+/g,' ').slice(0,limit); }
function audit(org,actor,action,detail,entityId){
  return {statement:`INSERT INTO audit_logs(id,org_id,username,role,action,detail,entity,entity_id)
    VALUES(?,?,?,?,?,?, 'disbursement_request',?)`,bindings:[`AUD-${crypto.randomUUID()}`,org,actor.email||actor.name||'system',actor.role,action,clean(detail,1000),entityId]};
}
async function requestWithItems(db,org,id){
  const row=await d1First(db,'SELECT * FROM disbursement_requests WHERE id=? AND org_id=? LIMIT 1',[id,org]);
  if(!row) return null;
  const items=await d1All(db,'SELECT * FROM disbursement_request_items WHERE disbursement_request_id=? ORDER BY sequence_no',[id]);
  return publicDisbursementRequest(row,items);
}
async function existingForSource(db,org,sourceType,sourceId){
  return d1First(db,`SELECT * FROM disbursement_requests WHERE org_id=? AND source_document_type=? AND source_document_id=?
    AND status NOT IN ('REJECTED','CANCELLED') LIMIT 1`,[org,sourceType,sourceId]);
}
function ensureRequestPermission(actor){ return actor?.permissions?.includes('disbursement:request'); }

async function payrollSource(db,org,sourceId,destinationMode){
  const pi=await d1First(db,`SELECT pi.*,s.project_id,s.period AS payroll_period
    FROM payment_instructions pi JOIN payroll_submissions s ON s.id=pi.submission_id
    WHERE pi.id=? AND pi.org_id=? LIMIT 1`,[sourceId,org]);
  if(!pi) return {error:'Payment Instruction tidak ditemukan',status:404,code:'DISBURSEMENT_SOURCE_NOT_FOUND'};
  if(!SOURCE_READY_PI.has(String(pi.status))) return {error:'PI belum berada pada tahap payment yang dapat dibuatkan Disbursement Request',status:409,code:'DISBURSEMENT_PI_NOT_READY'};
  if(!pi.provider_account_registry_id||!pi.provider_sub_account_id||String(pi.provider||'').toUpperCase()!=='E2PAY'){
    return {error:'Payment Readiness belum READY. Submit/bind routing PI ke E2Pay terlebih dahulu.',status:409,code:'PAYMENT_READINESS_PENDING'};
  }
  const account=await d1First(db,`SELECT * FROM payment_provider_accounts WHERE id=? AND org_id=? AND provider='E2PAY' AND status='ACTIVE' LIMIT 1`,[pi.provider_account_registry_id,org]);
  if(!account||String(account.provider_sub_account_id)!==String(pi.provider_sub_account_id)) return {error:'Snapshot provider PI tidak lagi cocok dengan registry aktif',status:409,code:'DISBURSEMENT_PROVIDER_SNAPSHOT_MISMATCH'};
  if(!providerAccountCredentialState(account).ready) return {error:'Credential provider belum READY',status:409,code:'PAYMENT_READINESS_CREDENTIAL_PENDING'};

  let items=[];
  if(destinationMode==='DIRECT_EMPLOYEE'){
    const lines=await d1All(db,`SELECT * FROM payment_instruction_lines WHERE payment_instruction_id=? ORDER BY beneficiary_name,id`,[pi.id]);
    if(lines.length!==Number(pi.recipient_count||0)) return {error:'Jumlah recipient PI tidak sesuai snapshot',status:409,code:'DISBURSEMENT_PI_RECIPIENT_MISMATCH'};
    const total=lines.reduce((sum,row)=>sum+Number(row.amount||0),0);
    if(total!==Number(pi.expected_total||0)) return {error:'Total PI tidak sesuai snapshot',status:409,code:'DISBURSEMENT_PI_TOTAL_MISMATCH'};
    items=await Promise.all(lines.map(async(row,index)=>{
      const accountHash=await sha256Hex(`PI_ACCOUNT|${row.line_hash}`);
      const beneficiaryHash=await sha256Hex(JSON.stringify({employeeId:row.employee_id,name:row.beneficiary_name,bankCode:row.bank_code,last4:row.account_last4,amount:Number(row.amount),lineHash:row.line_hash}));
      return {sequence:index+1,sourceItemType:'PAYMENT_INSTRUCTION_LINE',sourceItemId:row.id,beneficiaryType:'EMPLOYEE',beneficiaryReference:row.employee_id,employeeId:row.employee_id,clientBankAccountId:null,
        bankCode:row.bank_code,bankName:row.bank_name,beneficiaryName:row.beneficiary_name,ciphertext:row.account_ciphertext,iv:row.account_iv,accountHash,last4:row.account_last4,beneficiaryHash,amount:Number(row.amount)};
    }));
  }else if(destinationMode==='CLIENT_ACCOUNT'){
    const bank=await d1First(db,`SELECT * FROM client_bank_accounts WHERE org_id=? AND client_id=? AND purpose='PAYROLL_SETTLEMENT' AND status='VERIFIED' AND is_primary=1 LIMIT 1`,[org,pi.client_id]);
    if(!bank) return {error:'Rekening perusahaan klien belum VERIFIED dan PRIMARY untuk payroll settlement',status:409,code:'CORPORATE_BENEFICIARY_REQUIRED'};
    const beneficiaryHash=await sha256Hex(JSON.stringify({clientId:pi.client_id,bankCode:bank.bank_code,accountHash:bank.account_number_hash,amount:Number(pi.expected_total)}));
    items=[{sequence:1,sourceItemType:'CORPORATE_SETTLEMENT',sourceItemId:bank.id,beneficiaryType:'CORPORATE',beneficiaryReference:pi.client_id,employeeId:null,clientBankAccountId:bank.id,
      bankCode:bank.bank_code,bankName:bank.bank_name,beneficiaryName:bank.account_name,ciphertext:bank.account_number_ciphertext,iv:bank.account_number_iv,accountHash:bank.account_number_hash,last4:bank.account_number_last4,beneficiaryHash,amount:Number(pi.expected_total)}];
  }else return {error:'Destination mode payroll tidak didukung',status:422,code:'DISBURSEMENT_INTENT_UNSUPPORTED'};

  return {pi,account,items,clientId:pi.client_id,projectId:pi.project_id||null,amount:Number(pi.expected_total),provider:'E2PAY',environment:pi.provider_environment||account.environment};
}

async function ewaSource(db,org,sourceId,env){
  const ewa=await d1First(db,`SELECT er.*,e.name AS employee_name,e.project_id FROM ewa_requests er
    JOIN employees e ON e.id=er.employee_id WHERE er.id=? AND er.org_id=? LIMIT 1`,[sourceId,org]);
  if(!ewa) return {error:'EWA Request tidak ditemukan',status:404,code:'DISBURSEMENT_SOURCE_NOT_FOUND'};
  if(String(ewa.status)!=='APPROVED') return {error:'EWA Request harus APPROVED sebelum dibuatkan Disbursement Request',status:409,code:'DISBURSEMENT_EWA_NOT_APPROVED'};
  const runtime=await gatewayRuntimeEnv(db,env,org);
  const environment=String(runtime.E2PAY_ENV||'UAT').toUpperCase();
  const account=await activeProviderAccount(db,org,ewa.client_id,'E2PAY',environment,ewa.project_id||null);
  if(!account?.provider_sub_account_id||!providerAccountCredentialState(account).ready) return {error:'Payment Readiness E2Pay client belum READY untuk EWA',status:409,code:'PAYMENT_READINESS_PENDING'};
  const bank=await d1First(db,`SELECT * FROM employee_bank_accounts WHERE employee_id=? AND is_primary=1 ORDER BY created_at DESC,id DESC LIMIT 1`,[ewa.employee_id]);
  if(!bank) return {error:'Rekening utama karyawan belum tersedia',status:409,code:'EMPLOYEE_BENEFICIARY_REQUIRED'};
  let digits='';
  try{ digits=await revealEmployeeBankAccount(bank,env); }catch{}
  if(!/^\d{6,34}$/.test(digits)) return {error:'Rekening utama karyawan tidak dapat diverifikasi',status:409,code:'EMPLOYEE_BENEFICIARY_INVALID'};
  if(!env.PI_ENCRYPTION_KEY||String(env.PI_ENCRYPTION_KEY).length<32) return {error:'PI_ENCRYPTION_KEY belum dikonfigurasi',status:503,code:'PI_ENCRYPTION_KEY_REQUIRED'};
  const encrypted=await encryptAccountNumber(digits,env.PI_ENCRYPTION_KEY);
  const bankCode=canonicalBankCode(bank.bank_name);
  const accountHash=await sha256Hex(`DR_ACCOUNT|${bankCode}|${digits}`);
  const beneficiaryHash=await sha256Hex(JSON.stringify({employeeId:ewa.employee_id,bankCode,accountHash,amount:Number(ewa.amount)}));
  const item={sequence:1,sourceItemType:'EWA_REQUEST',sourceItemId:ewa.id,beneficiaryType:'EMPLOYEE',beneficiaryReference:ewa.employee_id,employeeId:ewa.employee_id,clientBankAccountId:null,
    bankCode,bankName:bank.bank_name,beneficiaryName:ewa.employee_name,ciphertext:encrypted.ciphertext,iv:encrypted.iv,accountHash,last4:encrypted.last4,beneficiaryHash,amount:Number(ewa.amount)};
  return {ewa,account,items:[item],clientId:ewa.client_id,projectId:ewa.project_id||null,amount:Number(ewa.amount),provider:'E2PAY',environment};
}

export async function onRequest({request,env}){
  if(request.method==='OPTIONS') return handlePreflight(request,env,METHODS);
  if(!['GET','POST'].includes(request.method)) return secureJson({error:'Method not allowed'},405,request,env,METHODS);
  const authorization=await authorize(request,env,{mutating:request.method==='POST',methods:METHODS});
  if(authorization.response) return authorization.response;
  const limited=await enforceRateLimit(request,env,authorization.actor,'disbursement-requests',METHODS);
  if(limited) return limited;
  if(!hasD1(env)) return secureJson({error:'Cloudflare D1 unavailable'},503,request,env,METHODS);
  const actor=authorization.actor;
  const organizationId=orgId(env,actor);
  const correlationId=crypto.randomUUID();

  if(request.method==='GET'){
    const url=new URL(request.url);
    const id=clean(url.searchParams.get('id'),140);
    if(id){
      const detail=await requestWithItems(env.DB,organizationId,id);
      return detail?secureJson({ok:true,request:detail},200,request,env,METHODS):secureJson({error:'Disbursement Request tidak ditemukan'},404,request,env,METHODS);
    }
    const status=clean(url.searchParams.get('status'),40).toUpperCase();
    const clientId=clean(url.searchParams.get('clientId'),140);
    const bindings=[organizationId];
    let where='org_id=?';
    if(status){where+=' AND status=?';bindings.push(status);}
    if(clientId){where+=' AND client_id=?';bindings.push(clientId);}
    const rows=await d1All(env.DB,`SELECT * FROM disbursement_requests WHERE ${where} ORDER BY created_at DESC LIMIT 200`,bindings);
    return secureJson({ok:true,requests:rows.map((row)=>publicDisbursementRequest(row,[]))},200,request,env,METHODS);
  }

  if(!ensureRequestPermission(actor)) return secureJson({error:'Permission disbursement:request diperlukan',code:'DISBURSEMENT_REQUEST_PERMISSION_REQUIRED'},403,request,env,METHODS);
  const body=await request.json().catch(()=>null);
  const action=String(body?.action||'CREATE').toUpperCase();

  if(action==='SUBMIT_REQUEST'){
    const id=clean(body?.id,140);
    const current=await d1First(env.DB,'SELECT * FROM disbursement_requests WHERE id=? AND org_id=? LIMIT 1',[id,organizationId]);
    if(!current) return secureJson({error:'Disbursement Request tidak ditemukan'},404,request,env,METHODS);
    if(current.status==='PENDING_APPROVAL') return secureJson({ok:true,request:await requestWithItems(env.DB,organizationId,id),idempotentReplay:true},200,request,env,METHODS);
    if(current.status!=='READY') return secureJson({error:'Disbursement Request tidak berada pada status READY',code:'DISBURSEMENT_NOT_READY'},409,request,env,METHODS);
    await d1Batch(env.DB,[
      {statement:`UPDATE disbursement_requests SET status='PENDING_APPROVAL',requested_by_user_id=?,requested_by_email=?,requested_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),updated_by_user_id=?,updated_by_email=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND org_id=? AND status='READY'`,bindings:[actor.id||null,actor.email,actor.id||null,actor.email,id,organizationId]},
      audit(organizationId,actor,'DISBURSEMENT_REQUEST_SUBMITTED',`purpose=${current.purpose} · destination=${current.destination_mode} · amount=${current.amount}`,id),
    ]);
    return secureJson({ok:true,request:await requestWithItems(env.DB,organizationId,id)},200,request,env,METHODS);
  }

  if(action!=='CREATE') return secureJson({error:'Action tidak didukung'},422,request,env,METHODS);
  const sourceDocumentType=canonicalSourceType(body?.sourceDocumentType);
  const sourceDocumentId=clean(body?.sourceDocumentId,160);
  let destinationMode=String(body?.destinationMode||'').trim().toUpperCase();
  if(sourceDocumentType==='EWA_REQUEST'&&!destinationMode) destinationMode='DIRECT_EMPLOYEE';
  const intent=intentFromSource(sourceDocumentType,destinationMode);
  if(!sourceDocumentId||!intent.ok) return secureJson({error:'Source document / destination mode tidak valid',code:intent.code||'DISBURSEMENT_INTENT_UNSUPPORTED'},422,request,env,METHODS);

  const existing=await existingForSource(env.DB,organizationId,sourceDocumentType,sourceDocumentId);
  if(existing){
    if(existing.destination_mode!==destinationMode) return secureJson({error:'Source document sudah memiliki settlement strategy aktif yang berbeda',code:'DISBURSEMENT_SETTLEMENT_STRATEGY_LOCKED',request:publicDisbursementRequest(existing,[])},409,request,env,METHODS);
    return secureJson({ok:true,request:await requestWithItems(env.DB,organizationId,existing.id),idempotentReplay:true},200,request,env,METHODS);
  }

  const source=sourceDocumentType==='PAYMENT_INSTRUCTION'
    ? await payrollSource(env.DB,organizationId,sourceDocumentId,destinationMode)
    : await ewaSource(env.DB,organizationId,sourceDocumentId,env);
  if(source.error) return secureJson({error:source.error,code:source.code},source.status||409,request,env,METHODS);

  const identity=await disbursementIdentity({orgId:organizationId,clientId:source.clientId,sourceDocumentType,sourceDocumentId,destinationMode,provider:source.provider,environment:source.environment,providerAccountId:source.account.id,amount:source.amount,items:source.items});
  const id=`DR-${crypto.randomUUID()}`;
  const ops=[
    {statement:`INSERT INTO disbursement_requests(
      id,org_id,client_id,project_id,provider,provider_account_registry_id,provider_sub_account_id_snapshot,provider_environment,
      purpose,destination_mode,beneficiary_type,source_document_type,source_document_id,amount,currency,recipient_count,
      client_reference,correlation_id,idempotency_key,routing_hash,status,created_by_user_id,created_by_email,updated_by_user_id,updated_by_email
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'IDR',?,?,?,?,?,'READY',?,?,?,?)`,bindings:[
      id,organizationId,source.clientId,source.projectId,source.provider,source.account.id,source.account.provider_sub_account_id,source.environment,
      intent.purpose,intent.destinationMode,intent.beneficiaryType,sourceDocumentType,sourceDocumentId,source.amount,source.items.length,
      identity.clientReference,correlationId,identity.idempotencyKey,identity.routingHash,actor.id||null,actor.email,actor.id||null,actor.email,
    ]},
    ...source.items.map((item)=>({statement:`INSERT INTO disbursement_request_items(
      id,disbursement_request_id,sequence_no,source_item_type,source_item_id,beneficiary_type,beneficiary_reference,employee_id,client_bank_account_id,
      bank_code,bank_name,beneficiary_name,account_number_ciphertext,account_number_iv,account_number_hash,account_number_last4,beneficiary_hash,amount,currency,client_reference,status
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'IDR',?,'CREATED')`,bindings:[
      `DRI-${crypto.randomUUID()}`,id,item.sequence,item.sourceItemType,item.sourceItemId,item.beneficiaryType,item.beneficiaryReference,item.employeeId,item.clientBankAccountId,
      item.bankCode,item.bankName,item.beneficiaryName,item.ciphertext,item.iv,item.accountHash,item.last4,item.beneficiaryHash,item.amount,`${identity.clientReference}-${String(item.sequence).padStart(4,'0')}`,
    ]})),
    audit(organizationId,actor,'DISBURSEMENT_REQUEST_CREATED',`purpose=${intent.purpose} · destination=${intent.destinationMode} · source=${sourceDocumentType}:${sourceDocumentId} · recipients=${source.items.length} · amount=${source.amount} · routing=${identity.routingHash}`,id),
  ];
  try{ await d1Batch(env.DB,ops); }
  catch(error){
    if(/UNIQUE constraint failed|constraint failed/i.test(String(error?.message||error))){
      const replay=await existingForSource(env.DB,organizationId,sourceDocumentType,sourceDocumentId);
      if(replay) return secureJson({ok:true,request:await requestWithItems(env.DB,organizationId,replay.id),idempotentReplay:true,concurrentReplay:true},200,request,env,METHODS);
    }
    throw error;
  }
  return secureJson({ok:true,request:await requestWithItems(env.DB,organizationId,id)},201,request,env,METHODS);
}
