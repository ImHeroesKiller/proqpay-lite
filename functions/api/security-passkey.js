import { markCurrentSessionAuthStrength } from './_account-auth.js';
import { d1Run, hasD1 } from './_d1.js';
import { isCriticalMfaRole, hasRecentMfa } from './_security-context.js';
import { authorize, enforceRateLimit, handlePreflight, secureJson } from './_security.js';
import {
  activePasskeys,
  beginPasskeyRegistration,
  finishPasskeyRegistration,
  passkeyEnforcementMode,
} from './_webauthn.js';

const METHODS='GET, POST, OPTIONS';
const PRIVILEGED=['SUPER_ADMIN','PAYROLL_CONTROLLER'];

async function audit(database,orgId,actor,action,detail){
  await d1Run(database,`INSERT INTO audit_logs
    (id,org_id,username,role,action,detail,entity,entity_id,ip_hash,device_hash)
    VALUES(?,?,?,?,?,?,'app_user',?,?,?)`,[
      `AUD-${crypto.randomUUID()}`,orgId,actor.email,actor.role,action,
      JSON.stringify(detail || {}),actor.id,actor.requestIpHash||null,actor.requestDeviceHash||null,
    ]);
}

export async function onRequest({request,env}){
  if(request.method==='OPTIONS') return handlePreflight(request,env,METHODS);
  if(!['GET','POST'].includes(request.method)) return secureJson({error:'Method not allowed'},405,request,env,METHODS);
  if(!hasD1(env)) return secureJson({error:'Cloudflare D1 unavailable'},503,request,env,METHODS);

  const authorization=await authorize(request,env,{
    roles:PRIVILEGED,
    mutating:request.method==='POST',
    methods:METHODS,
    allowPasskeyEnrollment:true,
  });
  if(authorization.response) return authorization.response;
  const actor=authorization.actor;
  if(!isCriticalMfaRole(actor.role)) return secureJson({error:'Passkey privileged role only'},403,request,env,METHODS);

  const limited=await enforceRateLimit(request,env,actor,'security-passkey',METHODS);
  if(limited) return limited;
  const orgId=String(actor.orgId||env.DEFAULT_ORG_ID||'ORG-OTSINDO');
  const keys=await activePasskeys(env.DB,actor.id);

  if(request.method==='GET'){
    return secureJson({
      ok:true,
      passkey:{
        required:passkeyEnforcementMode(env)==='ENFORCE',
        configured:keys.length>0,
        count:keys.length,
        sessionStrength:actor.authStrength||'PASSWORD',
        credentials:keys.map((row)=>({
          id:row.id,
          label:row.label||null,
          deviceType:row.device_type||null,
          backedUp:Boolean(row.backed_up),
          createdAt:row.created_at,
          lastUsedAt:row.last_used_at||null,
        })),
      },
    },200,request,env,METHODS);
  }

  let body={};
  try{body=await request.json();}catch{return secureJson({error:'Invalid JSON'},400,request,env,METHODS);}
  const action=String(body.action||'').trim().toUpperCase();

  if(action==='REGISTER_OPTIONS'){
    if(!hasRecentMfa(actor,900) && actor.authStrength!=='PASSKEY_UV'){
      return secureJson({
        error:'Verifikasi TOTP terbaru diperlukan sebelum mendaftarkan passkey.',
        code:'MFA_STEP_UP_REQUIRED',
      },428,request,env,METHODS);
    }
    const started=await beginPasskeyRegistration(env.DB,request,env,actor);
    return secureJson({
      ok:true,
      challengeId:started.challengeId,
      options:started.options,
    },200,request,env,METHODS);
  }

  if(action==='REGISTER_VERIFY'){
    if(!body.challengeId || !body.response){
      return secureJson({error:'challengeId dan response wajib diisi'},422,request,env,METHODS);
    }
    let verified;
    try{
      verified=await finishPasskeyRegistration(env.DB,request,env,actor,{
        challengeId:body.challengeId,
        response:body.response,
        label:body.label,
      });
    }catch(error){
      console.error(JSON.stringify({event:'PASSKEY_REGISTRATION_ERROR',message:error instanceof Error?error.message:String(error)}));
      return secureJson({error:'Registrasi passkey tidak dapat diverifikasi',code:'PASSKEY_REGISTRATION_FAILED'},422,request,env,METHODS);
    }
    if(!verified.ok){
      return secureJson({error:'Registrasi passkey tidak terverifikasi',code:verified.reason},422,request,env,METHODS);
    }
    const marked=await markCurrentSessionAuthStrength(request,env.DB,'PASSKEY_UV');
    if(!marked) return secureJson({error:'Session passkey tidak dapat diperbarui'},409,request,env,METHODS);
    await audit(env.DB,orgId,actor,'PASSKEY_REGISTERED',{
      credentialIdSuffix:String(verified.credentialId||'').slice(-8),
      deviceType:verified.deviceType,
      backedUp:verified.backedUp,
    });
    return secureJson({ok:true,code:'PASSKEY_REGISTERED',credential:{
      deviceType:verified.deviceType,
      backedUp:verified.backedUp,
    }},200,request,env,METHODS);
  }

  return secureJson({error:'Passkey action tidak didukung'},422,request,env,METHODS);
}
