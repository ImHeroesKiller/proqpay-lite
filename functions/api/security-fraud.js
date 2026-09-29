import { d1All, d1First, d1Run, hasD1 } from './_d1.js';
import { authorize, enforceRateLimit, handlePreflight, secureJson } from './_security.js';
import { fraudValueHash, protectedHash, safeLast4 } from './_security-context.js';

const METHODS='GET, POST, OPTIONS';
const TYPES=new Set(['USER_ID','EMAIL','IP','DEVICE','BANK_ACCOUNT']);

async function valueHash(type,value,env,valueIsHash=false){
  const normalized=String(value||'').trim();
  if(valueIsHash && /^[a-f0-9]{64}$/i.test(normalized)) return normalized.toLowerCase();
  if(type==='IP') return protectedHash(normalized,env,'IP');
  if(type==='DEVICE') return protectedHash(normalized,env,'DEVICE');
  return fraudValueHash(type,normalized,env);
}

function limitsPayload(body){
  const integer=(name,min,max)=>{
    const value=Number(body[name]);
    if(!Number.isSafeInteger(value) || value<min || value>max) throw new Error(name);
    return value;
  };
  return {
    maxSingleAmount:integer('maxSingleAmount',1,1_000_000_000_000),
    maxDailyAmount:integer('maxDailyAmount',1,5_000_000_000_000),
    maxDailyExecutions:integer('maxDailyExecutions',1,10000),
    maxRecipients:integer('maxRecipients',1,100000),
    stepUpWindowSeconds:integer('stepUpWindowSeconds',60,3600),
  };
}

async function audit(database,organizationId,actor,action,detail,entityId){
  await d1Run(database,`INSERT INTO audit_logs(id,org_id,username,role,action,detail,entity,entity_id,ip_hash,device_hash)
    VALUES(?,?,?,?,?,?,'security_control',?,?,?)`,[
    `AUD-${crypto.randomUUID()}`,organizationId,actor.email,actor.role,action,detail,entityId,
    actor.requestIpHash||null,actor.requestDeviceHash||null,
  ]);
}

export async function onRequest({request,env}){
  if(request.method==='OPTIONS') return handlePreflight(request,env,METHODS);
  if(!['GET','POST'].includes(request.method)) return secureJson({error:'Method not allowed'},405,request,env,METHODS);
  const authorization=await authorize(request,env,{roles:['SUPER_ADMIN'],mutating:request.method==='POST',methods:METHODS});
  if(authorization.response) return authorization.response;
  const actor=authorization.actor;
  const limited=await enforceRateLimit(request,env,actor,'security-fraud-admin',METHODS);
  if(limited) return limited;
  if(!hasD1(env)) return secureJson({error:'Cloudflare D1 unavailable'},503,request,env,METHODS);
  const organizationId=String(actor.orgId||env.DEFAULT_ORG_ID||'ORG-OTSINDO');

  if(request.method==='GET'){
    const blocks=await d1All(env.DB,`SELECT id,block_type,value_last4,reason,status,expires_at,created_by,created_at,revoked_by,revoked_at
      FROM fraud_blocklist WHERE org_id=? ORDER BY created_at DESC LIMIT 500`,[organizationId]);
    const limits=await d1First(env.DB,'SELECT * FROM payment_security_limits WHERE org_id=? LIMIT 1',[organizationId]);
    return secureJson({
      ok:true,
      blocks,
      limits:limits||{
        max_single_amount:10_000_000_000,
        max_daily_amount:25_000_000_000,
        max_daily_executions:50,
        max_recipients:5000,
        step_up_window_seconds:600,
      },
    },200,request,env,METHODS);
  }

  let body={};
  try{body=await request.json();}catch{return secureJson({error:'Invalid JSON'},400,request,env,METHODS);}
  const action=String(body.action||'').trim().toUpperCase();

  if(action==='BLOCK'){
    const type=String(body.blockType||body.type||'').trim().toUpperCase();
    if(!TYPES.has(type)) return secureJson({error:'blockType tidak valid'},422,request,env,METHODS);
    const value=String(body.value||'').trim();
    const reason=String(body.reason||'').trim().slice(0,500);
    if(!value || !reason) return secureJson({error:'value dan reason wajib diisi'},422,request,env,METHODS);
    const hash=await valueHash(type,value,env,Boolean(body.valueIsHash));
    if(!hash) return secureJson({error:'SECURITY_CONTEXT_KEY belum dikonfigurasi',code:'SECURITY_CONTEXT_KEY_REQUIRED'},503,request,env,METHODS);
    const id=`FBL-${crypto.randomUUID()}`;
    const expiresAt=body.expiresAt && /^\d{4}-\d{2}-\d{2}T/.test(String(body.expiresAt)) ? String(body.expiresAt) : null;
    try{
      await d1Run(env.DB,`INSERT INTO fraud_blocklist
        (id,org_id,block_type,value_hash,value_last4,reason,status,expires_at,created_by)
        VALUES(?,?,?,?,?,?,'ACTIVE',?,?)`,[
        id,organizationId,type,hash,
        ['BANK_ACCOUNT','USER_ID'].includes(type)?safeLast4(value):null,
        reason,expiresAt,actor.email,
      ]);
    }catch(error){
      if(/UNIQUE constraint failed/i.test(String(error?.message||error))){
        return secureJson({error:'Value sudah berada pada active blocklist',code:'FRAUD_BLOCK_EXISTS'},409,request,env,METHODS);
      }
      throw error;
    }

    if(type==='USER_ID'){
      await d1Run(env.DB,'DELETE FROM app_sessions WHERE user_id=?',[value]);
    }else if(type==='EMAIL'){
      const user=await d1First(env.DB,'SELECT id FROM app_users WHERE org_id=? AND email=? COLLATE NOCASE LIMIT 1',[organizationId,value]);
      if(user?.id) await d1Run(env.DB,'DELETE FROM app_sessions WHERE user_id=?',[user.id]);
    }
    await audit(env.DB,organizationId,actor,'FRAUD_BLOCK_ADDED',JSON.stringify({type,reason,expiresAt}),id);
    return secureJson({ok:true,id,status:'ACTIVE'},201,request,env,METHODS);
  }

  if(action==='UNBLOCK'){
    const id=String(body.id||'').trim();
    if(!id) return secureJson({error:'id wajib diisi'},422,request,env,METHODS);
    const current=await d1First(env.DB,`SELECT id FROM fraud_blocklist WHERE id=? AND org_id=? AND status='ACTIVE' LIMIT 1`,[id,organizationId]);
    if(!current) return secureJson({error:'Active block tidak ditemukan'},404,request,env,METHODS);
    await d1Run(env.DB,`UPDATE fraud_blocklist SET status='REVOKED',revoked_by=?,revoked_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE id=? AND org_id=? AND status='ACTIVE'`,[actor.email,id,organizationId]);
    await audit(env.DB,organizationId,actor,'FRAUD_BLOCK_REVOKED','Blocklist entry revoked',id);
    return secureJson({ok:true,id,status:'REVOKED'},200,request,env,METHODS);
  }

  if(action==='UPDATE_LIMITS'){
    let limits;
    try{limits=limitsPayload(body);}catch(error){
      return secureJson({error:`Limit tidak valid: ${String(error?.message||error)}`},422,request,env,METHODS);
    }
    await d1Run(env.DB,`INSERT INTO payment_security_limits
      (org_id,max_single_amount,max_daily_amount,max_daily_executions,max_recipients,step_up_window_seconds,updated_by,updated_at)
      VALUES(?,?,?,?,?,?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      ON CONFLICT(org_id) DO UPDATE SET
        max_single_amount=excluded.max_single_amount,
        max_daily_amount=excluded.max_daily_amount,
        max_daily_executions=excluded.max_daily_executions,
        max_recipients=excluded.max_recipients,
        step_up_window_seconds=excluded.step_up_window_seconds,
        updated_by=excluded.updated_by,
        updated_at=excluded.updated_at`,[
      organizationId,limits.maxSingleAmount,limits.maxDailyAmount,limits.maxDailyExecutions,
      limits.maxRecipients,limits.stepUpWindowSeconds,actor.email,
    ]);
    await audit(env.DB,organizationId,actor,'PAYMENT_SECURITY_LIMITS_UPDATED',JSON.stringify(limits),organizationId);
    return secureJson({ok:true,limits},200,request,env,METHODS);
  }

  return secureJson({error:'Security/fraud action tidak didukung'},422,request,env,METHODS);
}
