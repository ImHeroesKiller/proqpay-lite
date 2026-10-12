import { d1All, d1Batch, d1First, hasD1 } from './_d1.js';
import { authorize, enforceRateLimit, handlePreflight, secureJson } from './_security.js';
import { encryptAccountNumber, sha256Hex } from './payment-instruction-core.js';
import { hasRecentMfa, mfaEnforcementMode } from './_security-context.js';
import { roleCanAction } from '../../shared/authority-matrix.js';

const METHODS='GET, POST, OPTIONS';
function clean(value,limit=300){ return String(value??'').trim().replace(/[\r\n\t]+/g,' ').slice(0,limit); }
function digits(value){ return String(value??'').replace(/\D/g,''); }
function orgId(env,actor){ return String(actor?.orgId||env.DEFAULT_ORG_ID||'ORG-OTSINDO'); }
function audit(org,actor,action,detail,id){ return {statement:`INSERT INTO audit_logs(id,org_id,username,role,action,detail,entity,entity_id) VALUES(?,?,?,?,?,?, 'client_bank_account',?)`,bindings:[`AUD-${crypto.randomUUID()}`,org,actor.email||actor.name||'system',actor.role,action,clean(detail,1000),id]}; }
function publicAccount(row){
  return {
    id:row.id,clientId:row.client_id,bankCode:row.bank_code,bankName:row.bank_name||null,accountName:row.account_name,
    accountLast4:row.account_number_last4,purpose:row.purpose,status:row.status,isPrimary:Boolean(row.is_primary),
    verificationVersion:Number(row.verification_version||0),verifiedBy:row.verified_by_email||null,verifiedAt:row.verified_at||null,
    activatedAt:row.activated_at||null,suspendedAt:row.suspended_at||null,revokedAt:row.revoked_at||null,updatedAt:row.updated_at,
    governed:Boolean(row.source_change_request_id),
  };
}
function publicChange(row){
  return {
    id:row.id,clientId:row.client_id,purpose:row.purpose,action:row.action,targetAccountId:row.target_account_id||null,
    previousPrimaryAccountId:row.previous_primary_account_id||null,bankCode:row.proposed_bank_code||null,bankName:row.proposed_bank_name||null,
    accountName:row.proposed_account_name||null,accountLast4:row.proposed_account_number_last4||null,reason:row.reason,status:row.status,
    requestedBy:row.requested_by_email,requestedAt:row.requested_at,reviewedBy:row.reviewed_by_email||null,reviewedAt:row.reviewed_at||null,
    verificationReference:row.verification_reference||null,rejectionReason:row.rejection_reason||null,
  };
}
async function clientExists(db,org,clientId){ return d1First(db,'SELECT id,name,status FROM clients WHERE id=? AND org_id=? LIMIT 1',[clientId,org]); }
async function primaryAccount(db,org,clientId){ return d1First(db,`SELECT * FROM client_bank_accounts WHERE org_id=? AND client_id=? AND purpose='PAYROLL_SETTLEMENT' AND status='VERIFIED' AND is_primary=1 LIMIT 1`,[org,clientId]); }

export async function onRequest({request,env}){
  if(request.method==='OPTIONS') return handlePreflight(request,env,METHODS);
  if(!['GET','POST'].includes(request.method)) return secureJson({error:'Method not allowed'},405,request,env,METHODS);
  const authorization=await authorize(request,env,{mutating:request.method==='POST',methods:METHODS});
  if(authorization.response) return authorization.response;
  const limited=await enforceRateLimit(request,env,authorization.actor,'client-bank-beneficiaries',METHODS);
  if(limited) return limited;
  if(!hasD1(env)) return secureJson({error:'Cloudflare D1 unavailable'},503,request,env,METHODS);
  const actor=authorization.actor;
  const organizationId=orgId(env,actor);

  if(request.method==='GET'){
    const url=new URL(request.url);
    const clientId=clean(url.searchParams.get('clientId'),140);
    if(!clientId) return secureJson({error:'clientId wajib'},422,request,env,METHODS);
    if(!(await clientExists(env.DB,organizationId,clientId))) return secureJson({error:'Client tidak ditemukan'},404,request,env,METHODS);
    const [accounts,changes]=await Promise.all([
      d1All(env.DB,`SELECT * FROM client_bank_accounts WHERE org_id=? AND client_id=? AND purpose='PAYROLL_SETTLEMENT' ORDER BY is_primary DESC,updated_at DESC`,[organizationId,clientId]),
      d1All(env.DB,`SELECT * FROM client_bank_account_change_requests WHERE org_id=? AND client_id=? AND purpose='PAYROLL_SETTLEMENT' ORDER BY requested_at DESC LIMIT 50`,[organizationId,clientId]),
    ]);
    return secureJson({ok:true,accounts:accounts.map(publicAccount),changes:changes.map(publicChange),readiness:{ready:accounts.some(row=>row.status==='VERIFIED'&&Number(row.is_primary)===1&&Boolean(row.source_change_request_id)),reason:accounts.some(row=>row.status==='VERIFIED'&&Number(row.is_primary)===1&&Boolean(row.source_change_request_id))?'READY':'GOVERNED_PRIMARY_REQUIRED'}},200,request,env,METHODS);
  }

  const body=await request.json().catch(()=>null);
  const action=String(body?.action||'').toUpperCase();

  if(['APPROVE_CHANGE','REJECT_CHANGE'].includes(action)){
    if(!roleCanAction(actor.role,'corporate-beneficiary.approve')) return secureJson({error:'Hanya Payroll Controller yang dapat approve/reject perubahan rekening perusahaan',code:'CORPORATE_BENEFICIARY_APPROVE_PERMISSION_REQUIRED'},403,request,env,METHODS);
    const id=clean(body?.id,140);
    const change=await d1First(env.DB,'SELECT * FROM client_bank_account_change_requests WHERE id=? AND org_id=? LIMIT 1',[id,organizationId]);
    if(!change) return secureJson({error:'Change request tidak ditemukan'},404,request,env,METHODS);
    if(action==='REJECT_CHANGE'){
      if(change.status==='REJECTED') return secureJson({ok:true,change:publicChange(change),idempotentReplay:true},200,request,env,METHODS);
      if(change.status!=='PENDING_APPROVAL') return secureJson({error:'Change request tidak menunggu approval',code:'CORPORATE_BENEFICIARY_CHANGE_NOT_PENDING'},409,request,env,METHODS);
      if(String(change.requested_by_user_id||'')===String(actor.id||'')) return secureJson({error:'Maker tidak dapat mereview request sendiri',code:'CORPORATE_BENEFICIARY_MAKER_CHECKER_VIOLATION'},409,request,env,METHODS);
      const reason=clean(body?.reason,500);
      if(reason.length<10) return secureJson({error:'Alasan reject minimal 10 karakter'},422,request,env,METHODS);
      await d1Batch(env.DB,[
        {statement:`UPDATE client_bank_account_change_requests SET status='REJECTED',rejection_reason=?,reviewed_by_user_id=?,reviewed_by_email=?,reviewed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='PENDING_APPROVAL'`,bindings:[reason,actor.id||null,actor.email,id]},
        audit(organizationId,actor,'CORPORATE_BENEFICIARY_CHANGE_REJECTED',`${change.action} · ${reason}`,id),
      ]);
      return secureJson({ok:true,change:publicChange(await d1First(env.DB,'SELECT * FROM client_bank_account_change_requests WHERE id=?',[id]))},200,request,env,METHODS);
    }

    if(change.status==='APPROVED') return secureJson({ok:true,change:publicChange(change),idempotentReplay:true},200,request,env,METHODS);
    if(change.status!=='PENDING_APPROVAL') return secureJson({error:'Change request tidak menunggu approval',code:'CORPORATE_BENEFICIARY_CHANGE_NOT_PENDING'},409,request,env,METHODS);
    if(String(change.requested_by_user_id||'')===String(actor.id||'')) return secureJson({error:'Maker tidak dapat approve request sendiri',code:'CORPORATE_BENEFICIARY_MAKER_CHECKER_VIOLATION'},409,request,env,METHODS);
    if(mfaEnforcementMode(env)==='ENFORCE'&&!hasRecentMfa(actor,600)) return secureJson({error:'MFA step-up terbaru diperlukan sebelum perubahan rekening perusahaan.',code:'MFA_STEP_UP_REQUIRED',stepUpWindowSeconds:600},428,request,env,METHODS);
    const verificationReference=clean(body?.verificationReference,300);
    if(verificationReference.length<5) return secureJson({error:'Verification reference wajib diisi (bank statement/call-back/ticket/reference).',code:'CORPORATE_BENEFICIARY_VERIFICATION_REFERENCE_REQUIRED'},422,request,env,METHODS);
    const currentPrimary=await primaryAccount(env.DB,organizationId,change.client_id);
    if(change.previous_primary_account_id && String(currentPrimary?.id||'')!==String(change.previous_primary_account_id)) return secureJson({error:'Primary account berubah sejak request dibuat. Buat request baru.',code:'CORPORATE_BENEFICIARY_PRIMARY_CHANGED'},409,request,env,METHODS);

    const ops=[{statement:`UPDATE client_bank_account_change_requests SET status='APPROVED',reviewed_by_user_id=?,reviewed_by_email=?,reviewed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),verification_reference=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='PENDING_APPROVAL'`,bindings:[actor.id||null,actor.email,verificationReference,id]}];
    let affectedAccountId=change.target_account_id||null;
    if(['CREATE_PRIMARY','REPLACE_PRIMARY'].includes(change.action)){
      const newId=`CBA-${crypto.randomUUID()}`;
      affectedAccountId=newId;
      if(currentPrimary){
        ops.push({statement:`UPDATE client_bank_accounts SET status='SUSPENDED',is_primary=0,suspended_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),last_change_request_id=?,updated_by_user_id=?,updated_by_email=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND org_id=? AND status='VERIFIED' AND is_primary=1`,bindings:[id,actor.id||null,actor.email,currentPrimary.id,organizationId]});
      }
      ops.push({statement:`INSERT INTO client_bank_accounts(id,org_id,client_id,bank_code,bank_name,account_name,account_number_ciphertext,account_number_iv,account_number_hash,account_number_last4,purpose,status,is_primary,verified_by_user_id,verified_by_email,verified_at,created_by_user_id,created_by_email,updated_by_user_id,updated_by_email,source_change_request_id,last_change_request_id,verification_version,activated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,'VERIFIED',1,?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now'),?,?,?,?,?,?,1,strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,bindings:[newId,organizationId,change.client_id,change.proposed_bank_code,change.proposed_bank_name,change.proposed_account_name,change.proposed_account_number_ciphertext,change.proposed_account_number_iv,change.proposed_account_number_hash,change.proposed_account_number_last4,change.purpose,actor.id||null,actor.email,change.requested_by_user_id||null,change.requested_by_email,actor.id||null,actor.email,id,id]});
    }else if(change.action==='SET_PRIMARY'){
      const target=await d1First(env.DB,`SELECT * FROM client_bank_accounts WHERE id=? AND org_id=? AND client_id=? AND status='VERIFIED' LIMIT 1`,[change.target_account_id,organizationId,change.client_id]);
      if(!target) return secureJson({error:'Target account tidak lagi VERIFIED',code:'CORPORATE_BENEFICIARY_TARGET_NOT_VERIFIED'},409,request,env,METHODS);
      if(currentPrimary&&currentPrimary.id!==target.id) ops.push({statement:`UPDATE client_bank_accounts SET is_primary=0,last_change_request_id=?,updated_by_user_id=?,updated_by_email=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`,bindings:[id,actor.id||null,actor.email,currentPrimary.id]});
      ops.push({statement:`UPDATE client_bank_accounts SET is_primary=1,last_change_request_id=?,verification_version=verification_version+1,verified_by_user_id=?,verified_by_email=?,verified_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),updated_by_user_id=?,updated_by_email=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`,bindings:[id,actor.id||null,actor.email,actor.id||null,actor.email,target.id]});
    }else if(['SUSPEND','REVOKE'].includes(change.action)){
      const target=await d1First(env.DB,`SELECT * FROM client_bank_accounts WHERE id=? AND org_id=? AND client_id=? LIMIT 1`,[change.target_account_id,organizationId,change.client_id]);
      if(!target||!['VERIFIED','SUSPENDED'].includes(String(target.status))) return secureJson({error:'Target account tidak dapat diubah',code:'CORPORATE_BENEFICIARY_TARGET_INVALID'},409,request,env,METHODS);
      const next=change.action==='SUSPEND'?'SUSPENDED':'REVOKED';
      ops.push({statement:`UPDATE client_bank_accounts SET status=?,is_primary=0,last_change_request_id=?,suspended_at=CASE WHEN ?='SUSPENDED' THEN strftime('%Y-%m-%dT%H:%M:%fZ','now') ELSE suspended_at END,revoked_at=CASE WHEN ?='REVOKED' THEN strftime('%Y-%m-%dT%H:%M:%fZ','now') ELSE revoked_at END,updated_by_user_id=?,updated_by_email=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`,bindings:[next,id,next,next,actor.id||null,actor.email,target.id]});
    }
    ops.push(audit(organizationId,actor,'CORPORATE_BENEFICIARY_CHANGE_APPROVED',`${change.action} · accountLast4=${change.proposed_account_number_last4||'existing'} · verification=${verificationReference}`,affectedAccountId||id));
    await d1Batch(env.DB,ops);
    return secureJson({ok:true,change:publicChange(await d1First(env.DB,'SELECT * FROM client_bank_account_change_requests WHERE id=?',[id])),account:affectedAccountId?publicAccount(await d1First(env.DB,'SELECT * FROM client_bank_accounts WHERE id=?',[affectedAccountId])):null},200,request,env,METHODS);
  }

  if(!roleCanAction(actor.role,'corporate-beneficiary.request')) return secureJson({error:'Hanya Payroll Processor yang dapat mengajukan perubahan rekening perusahaan',code:'CORPORATE_BENEFICIARY_REQUEST_PERMISSION_REQUIRED'},403,request,env,METHODS);
  const clientId=clean(body?.clientId,140);
  const client=await clientExists(env.DB,organizationId,clientId);
  if(!client) return secureJson({error:'Client tidak ditemukan'},404,request,env,METHODS);
  const pending=await d1First(env.DB,`SELECT id FROM client_bank_account_change_requests WHERE org_id=? AND client_id=? AND purpose='PAYROLL_SETTLEMENT' AND status='PENDING_APPROVAL' LIMIT 1`,[organizationId,clientId]);
  if(pending) return secureJson({error:'Masih ada perubahan rekening yang menunggu approval Controller',code:'CORPORATE_BENEFICIARY_CHANGE_ALREADY_PENDING',pendingId:pending.id},409,request,env,METHODS);
  const currentPrimary=await primaryAccount(env.DB,organizationId,clientId);
  const reason=clean(body?.reason,500);
  if(reason.length<10) return secureJson({error:'Alasan perubahan minimal 10 karakter'},422,request,env,METHODS);
  const id=`CBCR-${crypto.randomUUID()}`;

  if(action==='REQUEST_PRIMARY_ACCOUNT'){
    const bankCode=clean(body?.bankCode,40).toUpperCase();
    const bankName=clean(body?.bankName,120);
    const accountName=clean(body?.accountName,180);
    const accountNumber=digits(body?.accountNumber);
    if(!bankCode||accountName.length<3||!/^\d{6,34}$/.test(accountNumber)) return secureJson({error:'Bank, nama rekening, dan nomor rekening valid wajib diisi'},422,request,env,METHODS);
    if(!env.PI_ENCRYPTION_KEY||String(env.PI_ENCRYPTION_KEY).length<32) return secureJson({error:'PI_ENCRYPTION_KEY belum dikonfigurasi'},503,request,env,METHODS);
    const accountHash=await sha256Hex(`CLIENT_BANK|${env.PI_ENCRYPTION_KEY}|${organizationId}|${clientId}|${accountNumber}`);
    const duplicate=await d1First(env.DB,`SELECT * FROM client_bank_accounts WHERE org_id=? AND client_id=? AND account_number_hash=? AND status<>'REVOKED' LIMIT 1`,[organizationId,clientId,accountHash]);
    if(duplicate) return secureJson({error:'Rekening ini sudah terdaftar. Gunakan request Set Primary bila diperlukan.',code:'CORPORATE_BENEFICIARY_ALREADY_EXISTS',account:publicAccount(duplicate)},409,request,env,METHODS);
    const encrypted=await encryptAccountNumber(accountNumber,env.PI_ENCRYPTION_KEY);
    const changeAction=currentPrimary?'REPLACE_PRIMARY':'CREATE_PRIMARY';
    await d1Batch(env.DB,[
      {statement:`INSERT INTO client_bank_account_change_requests(id,org_id,client_id,purpose,action,previous_primary_account_id,proposed_bank_code,proposed_bank_name,proposed_account_name,proposed_account_number_ciphertext,proposed_account_number_iv,proposed_account_number_hash,proposed_account_number_last4,reason,status,requested_by_user_id,requested_by_email) VALUES(?,?,?,'PAYROLL_SETTLEMENT',?,?,?,?,?,?,?,?,?,?,'PENDING_APPROVAL',?,?)`,bindings:[id,organizationId,clientId,changeAction,currentPrimary?.id||null,bankCode,bankName||bankCode,accountName,encrypted.ciphertext,encrypted.iv,accountHash,encrypted.last4,reason,actor.id||null,actor.email]},
      audit(organizationId,actor,'CORPORATE_BENEFICIARY_CHANGE_REQUESTED',`${changeAction} · client=${client.name} · bank=${bankCode} · accountLast4=${encrypted.last4} · reason=${reason}`,id),
    ]);
  }else if(['REQUEST_SET_PRIMARY','REQUEST_SUSPEND','REQUEST_REVOKE'].includes(action)){
    const targetId=clean(body?.accountId,140);
    const target=await d1First(env.DB,`SELECT * FROM client_bank_accounts WHERE id=? AND org_id=? AND client_id=? AND purpose='PAYROLL_SETTLEMENT' LIMIT 1`,[targetId,organizationId,clientId]);
    if(!target) return secureJson({error:'Rekening perusahaan tidak ditemukan'},404,request,env,METHODS);
    let changeAction='SET_PRIMARY';
    if(action==='REQUEST_SUSPEND') changeAction='SUSPEND';
    if(action==='REQUEST_REVOKE') changeAction='REVOKE';
    if(changeAction==='SET_PRIMARY'&&target.status!=='VERIFIED') return secureJson({error:'Hanya rekening VERIFIED yang dapat dijadikan primary'},409,request,env,METHODS);
    if(changeAction==='SET_PRIMARY'&&target.is_primary) return secureJson({error:'Rekening sudah menjadi primary'},409,request,env,METHODS);
    await d1Batch(env.DB,[
      {statement:`INSERT INTO client_bank_account_change_requests(id,org_id,client_id,purpose,action,target_account_id,previous_primary_account_id,reason,status,requested_by_user_id,requested_by_email) VALUES(?,?,?,'PAYROLL_SETTLEMENT',?,?,? ,?,'PENDING_APPROVAL',?,?)`,bindings:[id,organizationId,clientId,changeAction,target.id,currentPrimary?.id||null,reason,actor.id||null,actor.email]},
      audit(organizationId,actor,'CORPORATE_BENEFICIARY_CHANGE_REQUESTED',`${changeAction} · accountLast4=${target.account_number_last4} · reason=${reason}`,id),
    ]);
  }else return secureJson({error:'Action tidak didukung'},422,request,env,METHODS);

  return secureJson({ok:true,change:publicChange(await d1First(env.DB,'SELECT * FROM client_bank_account_change_requests WHERE id=?',[id]))},201,request,env,METHODS);
}
