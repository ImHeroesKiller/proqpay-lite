import { authorize, enforceRateLimit, handlePreflight, publicError, secureJson } from './_security.js';
import { d1Batch, hasD1 } from './_d1.js';
import {
  gatewayRuntimeEnv,
  publicGatewaySettings,
  readGatewaySecureSettings,
  writeGatewaySecureSettings,
} from './payment-gateway-settings-store.js';
import { gatewayReadiness } from './payment-gateway-core.js';
import {
  e2payAuthorize,
  e2payBankList,
  e2payMerchantAccount,
  e2payReadiness,
} from './payment-gateway-e2pay.js';

const METHODS = 'GET, POST, OPTIONS';
const ROLES = ['SUPER_ADMIN'];

function orgId(env) {
  return String(env.DEFAULT_ORG_ID || 'ORG-OTSINDO');
}

function clean(value, max = 500) {
  return String(value ?? '').trim().slice(0, max);
}

function auditOperation(organizationId, actor, action, detail) {
  return {
    statement:`INSERT INTO audit_logs(id,org_id,username,role,action,detail,entity,entity_id)
      VALUES(?,?,?,?,?,?,?,?)`,
    bindings:[
      'AUD-' + crypto.randomUUID(),
      organizationId,
      actor.email,
      actor.role,
      action,
      detail,
      'gateway_secure_settings',
      organizationId,
    ],
  };
}

function parseCredentials(body) {
  const values = {
    clientId:clean(body.clientId, 300),
    clientSecret:clean(body.clientSecret, 500),
    username:clean(body.username, 200),
    passwordMd5:clean(body.passwordMd5, 64).toUpperCase(),
    accountSrc:clean(body.accountSrc, 200),
    sourceId:clean(body.sourceId, 200),
  };
  return Object.fromEntries(Object.entries(values).filter(([, value]) => Boolean(value)));
}

export async function onRequest({ request, env }) {
  if (request.method === 'OPTIONS') return handlePreflight(request, env, METHODS);
  if (!['GET','POST'].includes(request.method)) {
    return secureJson({ error:'Method not allowed' }, 405, request, env, METHODS);
  }

  const authorization = await authorize(request, env, {
    roles:ROLES,
    mutating:request.method === 'POST',
    methods:METHODS,
  });
  if (authorization.response) return authorization.response;
  const limited = await enforceRateLimit(request, env, authorization.actor, 'gateway-settings', METHODS);
  if (limited) return limited;
  if (!hasD1(env)) {
    return secureJson({ error:'Cloudflare D1 binding unavailable', code:'D1_REQUIRED' }, 503, request, env, METHODS);
  }

  const organizationId = orgId(env);
  try {
    if (request.method === 'GET') {
      const stored = await readGatewaySecureSettings(env.DB, env, organizationId);
      const runtimeEnv = await gatewayRuntimeEnv(env.DB, env, organizationId);
      return secureJson({
        ok:true,
        settings:publicGatewaySettings(stored),
        readiness:gatewayReadiness(runtimeEnv),
      }, 200, request, env, METHODS);
    }

    const body = await request.json();
    const action = String(body.action || 'SAVE').trim().toUpperCase();

    if (action === 'TEST') {
      const runtimeEnv = await gatewayRuntimeEnv(env.DB, env, organizationId);
      const readiness = e2payReadiness(runtimeEnv);
      if (!readiness.configured) {
        return secureJson({ error:readiness.reason, code:'E2PAY_NOT_READY', readiness }, 409, request, env, METHODS);
      }
      const auth = await e2payAuthorize(runtimeEnv);
      const [account, banks] = await Promise.all([
        e2payMerchantAccount(runtimeEnv, auth.accessToken),
        e2payBankList(runtimeEnv, auth.accessToken),
      ]);
      await d1Batch(env.DB, [auditOperation(
        organizationId,
        authorization.actor,
        'E2PAY_CONNECTION_TESTED',
        'environment=' + readiness.environment + ' · banks=' + banks.length,
      )]);
      return secureJson({
        ok:true,
        readiness,
        connection:{
          accountName:String(account?.accountName || ''),
          merchantStatus:String(account?.merchantStatus || ''),
          balance:Number(account?.balance || 0),
          bankCount:banks.length,
        },
      }, 200, request, env, METHODS);
    }

    if (action !== 'SAVE') {
      return secureJson({ error:'Action tidak dikenal' }, 422, request, env, METHODS);
    }

    const provider = clean(body.provider, 40).toUpperCase();
    const environment = clean(body.environment, 40).toUpperCase();
    if (!['UNCONFIGURED','E2PAY'].includes(provider)) {
      return secureJson({ error:'Provider payment gateway tidak valid' }, 422, request, env, METHODS);
    }
    if (!['UAT','PRODUCTION'].includes(environment)) {
      return secureJson({ error:'Environment E2Pay harus UAT atau PRODUCTION' }, 422, request, env, METHODS);
    }

    const credentials = parseCredentials(body);
    if (credentials.passwordMd5 && !/^[A-F0-9]{32}$/.test(credentials.passwordMd5)) {
      return secureJson({ error:'E2PAY_PASSWORD_MD5 harus MD5 uppercase 32 karakter' }, 422, request, env, METHODS);
    }

    const stored = await writeGatewaySecureSettings(
      env.DB,
      env,
      organizationId,
      authorization.actor.email,
      { provider, environment, credentials },
    );
    await d1Batch(env.DB, [auditOperation(
      organizationId,
      authorization.actor,
      'PAYMENT_GATEWAY_SETTINGS_UPDATED',
      'provider=' + provider + ' · environment=' + environment + ' · credentialFields=' + Object.keys(credentials).join(','),
    )]);
    const runtimeEnv = await gatewayRuntimeEnv(env.DB, env, organizationId);
    return secureJson({
      ok:true,
      settings:publicGatewaySettings(stored),
      readiness:gatewayReadiness(runtimeEnv),
    }, 200, request, env, METHODS);
  } catch (error) {
    const requestId = crypto.randomUUID();
    return secureJson(publicError(error, requestId), 500, request, env, METHODS);
  }
}
