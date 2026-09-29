import {
  createSession, verifyPassword,
} from './_account-auth.js';
import { d1First, d1Run, hasD1 } from './_d1.js';
import { enforceRateLimit, handlePreflight, secureJson } from './_security.js';
import { actorFraudDecision } from './_fraud-controls.js';
import { recordFraudIncident } from './_fraud-incidents.js';
import { readUserMfa, verifyUserMfa } from './_mfa.js';
import { isCriticalMfaRole, mfaEnforcementMode, requestSecurityContext } from './_security-context.js';

const METHODS = 'POST, OPTIONS';

function sameOrigin(request) {
  const origin = request.headers.get('Origin');
  return origin ? origin === new URL(request.url).origin : request.headers.get('Sec-Fetch-Site') === 'same-origin';
}

export async function onRequest({ request, env }) {
  if (request.method === 'OPTIONS') return handlePreflight(request, env, METHODS);
  if (request.method !== 'POST') return secureJson({ error: 'Method not allowed' }, 405, request, env, METHODS);
  if (!sameOrigin(request)) return secureJson({ error: 'Same-origin request required' }, 403, request, env, METHODS);

  const limited = await enforceRateLimit(
    request,
    env,
    { id: request.headers.get('CF-Connecting-IP') || 'anonymous-login' },
    'account-login',
    METHODS
  );
  if (limited) return limited;

  if (!hasD1(env)) return secureJson({ error: 'Cloudflare D1 unavailable' }, 503, request, env, METHODS);
  let body;
  try { body = await request.json(); } catch { return secureJson({ error: 'Invalid JSON' }, 400, request, env, METHODS); }
  const email = String(body.email || '').trim().toLowerCase().slice(0, 254);
  const password = String(body.password || '').slice(0, 256);
  if (!email || !password) return secureJson({ error: 'Email dan password wajib diisi' }, 422, request, env, METHODS);

  const user = await d1First(env.DB, 'SELECT * FROM app_users WHERE email=? COLLATE NOCASE LIMIT 1', [email]);
  if (user?.locked_until && new Date(user.locked_until).getTime() > Date.now()) {
    return secureJson({ error: 'Akun terkunci sementara. Coba kembali 15 menit lagi.' }, 429, request, env, METHODS);
  }
  const valid = user ? await verifyPassword(password, user) : false;
  if (!valid || user.status !== 'ACTIVE') {
    if (user) {
      const nextFailedAttempts=Number(user.failed_login_attempts || 0)+1;
      await d1Run(env.DB, `UPDATE app_users SET
        failed_login_attempts=failed_login_attempts+1,
        locked_until=CASE WHEN failed_login_attempts+1 >= 5 THEN strftime('%Y-%m-%dT%H:%M:%fZ','now','+15 minutes') ELSE NULL END,
        updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`, [user.id]);
      if(nextFailedAttempts >= 5){
        const failedContext=await requestSecurityContext(request,env).catch(()=>({ipHash:null,deviceHash:null}));
        await recordFraudIncident(env.DB,{
          orgId:String(user.org_id || env.DEFAULT_ORG_ID || 'ORG-OTSINDO'),
          source:'AUTH',
          ruleCode:'LOGIN_LOCKOUT_THRESHOLD',
          severity:'MEDIUM',
          entity:'app_user',
          entityId:user.id,
          actorUserId:user.id,
          actorIpHash:failedContext.ipHash,
          actorDeviceHash:failedContext.deviceHash,
          summary:'Account reached failed-login lockout threshold',
          metadata:{failedAttempts:nextFailedAttempts},
        });
      }
    }
    return secureJson({ error: 'Email atau password tidak valid' }, 401, request, env, METHODS);
  }

  const context = await requestSecurityContext(request, env).catch(() => ({ ipHash:null, deviceHash:null }));
  const fraud = await actorFraudDecision(env.DB, String(user.org_id || env.DEFAULT_ORG_ID || 'ORG-OTSINDO'), {
    id:user.id,
    email:user.email,
    requestIpHash:context.ipHash,
    requestDeviceHash:context.deviceHash,
  }, env);
  if (fraud.blocked) {
    await recordFraudIncident(env.DB,{
      orgId:String(user.org_id || env.DEFAULT_ORG_ID || 'ORG-OTSINDO'),
      source:'AUTH',
      ruleCode:fraud.code || 'SECURITY_LOGIN_BLOCKED_FRAUD',
      severity:'HIGH',
      entity:'app_user',
      entityId:user.id,
      actorUserId:user.id,
      actorIpHash:context.ipHash,
      actorDeviceHash:context.deviceHash,
      summary:'Valid account login blocked by fraud control',
      metadata:{blockId:fraud.blockId,blockType:fraud.blockType},
    });
    await d1Run(env.DB, `INSERT INTO audit_logs(id,org_id,username,role,action,detail,entity,entity_id,ip_hash,device_hash)
      VALUES(?,?,?,?,? ,?,'app_user',?,?,?)`, [
      `AUD-${crypto.randomUUID()}`,
      String(user.org_id || env.DEFAULT_ORG_ID || 'ORG-OTSINDO'),
      user.email,
      user.role,
      'SECURITY_LOGIN_BLOCKED_FRAUD',
      JSON.stringify({ code:fraud.code, blockId:fraud.blockId, blockType:fraud.blockType }),
      user.id,
      context.ipHash || null,
      context.deviceHash || null,
    ]);
    return secureJson({ error:'Akses diblokir oleh kontrol keamanan. Hubungi administrator.', code:'SECURITY_FRAUD_BLOCKED' }, 403, request, env, METHODS);
  }

  const mfa = await readUserMfa(env.DB, user.id);
  const mfaRequired = Boolean(user.mfa_required) || isCriticalMfaRole(user.role);
  const enforceMfa = mfaEnforcementMode(env) === 'ENFORCE' && mfaRequired;
  const mfaCode = String(body.mfaCode || body.otp || '').replace(/\D/g, '').slice(0, 6);
  let mfaVerifiedAt = null;

  if (enforceMfa && mfa?.status !== 'ACTIVE') {
    return secureJson({
      error:'MFA wajib diaktifkan untuk role ini sebelum login.',
      code:'MFA_ENROLLMENT_REQUIRED',
      mfaRequired:true,
    }, 428, request, env, METHODS);
  }
  if (enforceMfa && !mfaCode) {
    return secureJson({
      error:'Masukkan kode MFA 6 digit.',
      code:'MFA_REQUIRED',
      mfaRequired:true,
    }, 428, request, env, METHODS);
  }
  if (mfaCode && mfa?.status === 'ACTIVE') {
    const verified = await verifyUserMfa(env.DB, env, user.id, mfaCode);
    if (!verified.ok) {
      return secureJson({ error:'Kode MFA tidak valid.', code:'MFA_CODE_INVALID' }, 401, request, env, METHODS);
    }
    mfaVerifiedAt = new Date().toISOString();
  } else if (enforceMfa) {
    return secureJson({ error:'MFA belum terverifikasi.', code:'MFA_REQUIRED' }, 428, request, env, METHODS);
  }

  const session = await createSession(env.DB, user.id, env, { context, mfaVerifiedAt });
  await d1Run(env.DB, `UPDATE app_users SET last_login_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
    failed_login_attempts=0, locked_until=NULL, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`, [user.id]);
  return secureJson({
    ok: true,
    user: {
      id: user.id, name: user.name, email: user.email, role: user.role,
      mustChangePassword: Boolean(user.must_change_password),
      mfaRequired,
      mfaActive:mfa?.status === 'ACTIVE',
      mfaVerified:Boolean(mfaVerifiedAt),
    },
    security:{ mfaMode:mfaEnforcementMode(env) },
  }, 200, request, env, METHODS, { 'Set-Cookie': session.cookie });
}
