import { verifyPassword } from './_account-auth.js';
import { d1First, d1Run, hasD1 } from './_d1.js';
import { activateUserMfa, beginMfaEnrollment, markCurrentSessionMfa, readUserMfa, verifyUserMfa } from './_mfa.js';
import { ROLES, authorize, enforceRateLimit, handlePreflight, secureJson } from './_security.js';
import { isCriticalMfaRole, mfaEnforcementMode } from './_security-context.js';

const METHODS='GET, POST, OPTIONS';

function sameOrigin(request){
  const origin=request.headers.get('Origin');
  return origin ? origin===new URL(request.url).origin : request.headers.get('Sec-Fetch-Site')==='same-origin';
}

async function credentialsUser(database, body){
  const email=String(body.email||'').trim().toLowerCase().slice(0,254);
  const password=String(body.password||'').slice(0,256);
  if(!email || !password) return null;
  const user=await d1First(database,'SELECT * FROM app_users WHERE email=? COLLATE NOCASE LIMIT 1',[email]);
  if(!user || user.status!=='ACTIVE') return null;
  return await verifyPassword(password,user) ? user : null;
}

async function audit(database, organizationId, actor, action, detail, entityId){
  await d1Run(database,`INSERT INTO audit_logs(id,org_id,username,role,action,detail,entity,entity_id,ip_hash,device_hash)
    VALUES(?,?,?,?,?,?,'app_user',?,?,?)`,[
    `AUD-${crypto.randomUUID()}`,
    organizationId,
    actor.email,
    actor.role,
    action,
    detail,
    entityId,
    actor.requestIpHash||null,
    actor.requestDeviceHash||null,
  ]);
}

export async function onRequest({request,env}){
  if(request.method==='OPTIONS') return handlePreflight(request,env,METHODS);
  if(!['GET','POST'].includes(request.method)) return secureJson({error:'Method not allowed'},405,request,env,METHODS);
  if(request.method==='POST' && !sameOrigin(request)) return secureJson({error:'Same-origin request required'},403,request,env,METHODS);
  if(!hasD1(env)) return secureJson({error:'Cloudflare D1 unavailable'},503,request,env,METHODS);

  let body={};
  if(request.method==='POST'){
    try{body=await request.json();}catch{return secureJson({error:'Invalid JSON'},400,request,env,METHODS);}
  }
  const action=String(body.action||'STATUS').trim().toUpperCase();

  if(['ENROLL_START','ENROLL_ACTIVATE'].includes(action)){
    const limited=await enforceRateLimit(request,env,{id:request.headers.get('CF-Connecting-IP')||'mfa-enroll'},'mfa-enrollment',METHODS);
    if(limited) return limited;
    const user=await credentialsUser(env.DB,body);
    if(!user) return secureJson({error:'Email atau password tidak valid'},401,request,env,METHODS);
    if(!isCriticalMfaRole(user.role) && !Boolean(user.mfa_required)){
      return secureJson({error:'MFA enrollment tidak diperlukan untuk role ini',code:'MFA_NOT_REQUIRED'},409,request,env,METHODS);
    }
    if(action==='ENROLL_START'){
      const enrollment=await beginMfaEnrollment(env.DB,env,user);
      await d1Run(env.DB,`DELETE FROM app_sessions WHERE user_id=?`,[user.id]);
      return secureJson({
        ok:true,
        code:'MFA_ENROLLMENT_STARTED',
        secret:enrollment.secret,
        otpauthUri:enrollment.uri,
        message:'Tambahkan secret ke aplikasi authenticator, lalu verifikasi kode 6 digit.',
      },200,request,env,METHODS);
    }
    const activated=await activateUserMfa(env.DB,env,user.id,body.code||body.mfaCode);
    if(!activated.ok) return secureJson({error:'Kode MFA tidak valid',code:activated.reason||'MFA_CODE_INVALID'},422,request,env,METHODS);
    await d1Run(env.DB,`DELETE FROM app_sessions WHERE user_id=?`,[user.id]);
    await d1Run(env.DB,`INSERT INTO audit_logs(id,org_id,username,role,action,detail,entity,entity_id)
      VALUES(?,?,?,?,?,'TOTP MFA activated','app_user',?)`,[
      `AUD-${crypto.randomUUID()}`,
      String(user.org_id||env.DEFAULT_ORG_ID||'ORG-OTSINDO'),
      user.email,
      user.role,
      'MFA_ACTIVATED',
      user.id,
    ]);
    return secureJson({ok:true,code:'MFA_ACTIVATED'},200,request,env,METHODS);
  }

  const authorization=await authorize(request,env,{roles:ROLES,mutating:request.method==='POST',methods:METHODS});
  if(authorization.response) return authorization.response;
  const actor=authorization.actor;
  const organizationId=String(actor.orgId||env.DEFAULT_ORG_ID||'ORG-OTSINDO');
  const limited=await enforceRateLimit(request,env,actor,'mfa-session',METHODS);
  if(limited) return limited;

  const row=await readUserMfa(env.DB,actor.id);
  if(request.method==='GET' || action==='STATUS'){
    return secureJson({
      ok:true,
      mfa:{
        required:Boolean(isCriticalMfaRole(actor.role)),
        configured:Boolean(row),
        active:row?.status==='ACTIVE',
        status:row?.status||'NOT_ENROLLED',
        lastVerifiedAt:row?.last_verified_at||null,
        sessionVerifiedAt:actor.mfaVerifiedAt||null,
        enforcement:mfaEnforcementMode(env),
      },
    },200,request,env,METHODS);
  }

  if(action==='STEP_UP'){
    if(row?.status!=='ACTIVE') return secureJson({error:'MFA belum aktif',code:'MFA_ENROLLMENT_REQUIRED'},428,request,env,METHODS);
    const verified=await verifyUserMfa(env.DB,env,actor.id,body.code||body.mfaCode);
    if(!verified.ok) return secureJson({error:'Kode MFA tidak valid',code:verified.reason||'MFA_CODE_INVALID'},401,request,env,METHODS);
    const marked=await markCurrentSessionMfa(request,env.DB);
    if(!marked) return secureJson({error:'Session tidak dapat diperbarui',code:'MFA_SESSION_UPDATE_FAILED'},409,request,env,METHODS);
    await audit(env.DB,organizationId,actor,'MFA_STEP_UP_VERIFIED','Payment/security step-up verified',actor.id);
    return secureJson({ok:true,verifiedAt:new Date().toISOString()},200,request,env,METHODS);
  }

  return secureJson({error:'MFA action tidak didukung'},422,request,env,METHODS);
}
