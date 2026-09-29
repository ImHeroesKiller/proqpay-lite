import { verifyPassword } from './_account-auth.js';
import { d1First, d1Run, hasD1 } from './_d1.js';
import { recordFraudIncident } from './_fraud-incidents.js';
import { readUserMfa, verifyUserMfa } from './_mfa.js';
import { enforceRateLimit, handlePreflight, secureJson } from './_security.js';
import { isCriticalMfaRole, requestSecurityContext } from './_security-context.js';
import { revokeAllPasskeys } from './_webauthn.js';

const METHODS='POST, OPTIONS';

function sameOrigin(request){
  const origin=request.headers.get('Origin');
  return origin ? origin===new URL(request.url).origin : request.headers.get('Sec-Fetch-Site')==='same-origin';
}

export async function onRequest({request,env}){
  if(request.method==='OPTIONS') return handlePreflight(request,env,METHODS);
  if(request.method!=='POST') return secureJson({error:'Method not allowed'},405,request,env,METHODS);
  if(!sameOrigin(request)) return secureJson({error:'Same-origin request required'},403,request,env,METHODS);
  if(!hasD1(env)) return secureJson({error:'Cloudflare D1 unavailable'},503,request,env,METHODS);

  const limited=await enforceRateLimit(request,env,{id:request.headers.get('CF-Connecting-IP')||'passkey-recovery'},'security-passkey-recovery',METHODS);
  if(limited) return limited;

  let body={};
  try{body=await request.json();}catch{return secureJson({error:'Invalid JSON'},400,request,env,METHODS);}
  const email=String(body.email||'').trim().toLowerCase().slice(0,254);
  const password=String(body.password||'').slice(0,256);
  const code=String(body.mfaCode||body.code||'').replace(/\D/g,'').slice(0,6);
  if(!email||!password||code.length!==6){
    return secureJson({error:'Email, password, dan kode TOTP 6 digit wajib diisi'},422,request,env,METHODS);
  }

  const user=await d1First(env.DB,'SELECT * FROM app_users WHERE email=? COLLATE NOCASE LIMIT 1',[email]);
  if(!user||user.status!=='ACTIVE'||!isCriticalMfaRole(user.role)||!(await verifyPassword(password,user))){
    return secureJson({error:'Recovery credential tidak valid'},401,request,env,METHODS);
  }
  const mfa=await readUserMfa(env.DB,user.id);
  if(mfa?.status!=='ACTIVE') return secureJson({error:'TOTP recovery tidak tersedia',code:'RECOVERY_MFA_UNAVAILABLE'},409,request,env,METHODS);
  const verified=await verifyUserMfa(env.DB,env,user.id,code);
  if(!verified.ok) return secureJson({error:'Kode TOTP tidak valid'},401,request,env,METHODS);

  const context=await requestSecurityContext(request,env).catch(()=>({ipHash:null,deviceHash:null}));
  const revoked=await revokeAllPasskeys(env.DB,user.id,user.email);
  await d1Run(env.DB,'DELETE FROM app_sessions WHERE user_id=?',[user.id]);
  const orgId=String(user.org_id||env.DEFAULT_ORG_ID||'ORG-OTSINDO');
  await recordFraudIncident(env.DB,{
    orgId,
    source:'IDENTITY',
    ruleCode:'PASSKEY_RECOVERY_USED',
    severity:'HIGH',
    entity:'app_user',
    entityId:user.id,
    actorUserId:user.id,
    actorIpHash:context.ipHash,
    actorDeviceHash:context.deviceHash,
    summary:'Privileged passkey recovery used; passkeys revoked and re-enrollment required',
    metadata:{revokedCount:revoked},
  });
  await d1Run(env.DB,`INSERT INTO audit_logs
    (id,org_id,username,role,action,detail,entity,entity_id,ip_hash,device_hash)
    VALUES(?,?,?,?,? ,?,'app_user',?,?,?)`,[
      `AUD-${crypto.randomUUID()}`,orgId,user.email,user.role,'PASSKEY_RECOVERY_USED',
      JSON.stringify({revokedCount:revoked,reEnrollmentRequired:true}),user.id,
      context.ipHash||null,context.deviceHash||null,
    ]);
  return secureJson({
    ok:true,
    code:'PASSKEY_RECOVERY_COMPLETE',
    revokedCount:revoked,
    reEnrollmentRequired:true,
  },200,request,env,METHODS);
}
