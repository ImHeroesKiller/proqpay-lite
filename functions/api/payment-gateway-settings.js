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
  e2payHostAuthorize,
  e2payHostReadiness,
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
    merchantName:clean(body.merchantName, 200),
    clientId:clean(body.clientId, 300),
    clientSecret:clean(body.clientSecret, 500),
    partnerId:clean(body.partnerId, 100),
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
      const environment = clean(body.environment || 'UAT', 40).toUpperCase();
      if (!['UAT','PRODUCTION'].includes(environment)) {
        return secureJson({ error:'Environment E2Pay harus UAT atau PRODUCTION' }, 422, request, env, METHODS);
      }
      const draft = parseCredentials(body);
      const storedRuntime = await gatewayRuntimeEnv(env.DB, env, organizationId, environment);
      const runtimeEnv = Object.assign(Object.create(storedRuntime || null), {
        PAYMENT_GATEWAY_PROVIDER:'E2PAY',
        E2PAY_ENV:environment,
        E2PAY_MERCHANT_NAME:draft.merchantName || storedRuntime.E2PAY_MERCHANT_NAME || '',
        E2PAY_CLIENT_ID:draft.clientId || storedRuntime.E2PAY_CLIENT_ID || '',
        E2PAY_CLIENT_SECRET:draft.clientSecret || storedRuntime.E2PAY_CLIENT_SECRET || '',
        E2PAY_PARTNER_ID:draft.partnerId || storedRuntime.E2PAY_PARTNER_ID || '',
        E2PAY_SOURCE_ID:draft.sourceId || storedRuntime.E2PAY_SOURCE_ID || '',
      });
      const hostReadiness = e2payHostReadiness(runtimeEnv);
      if (!hostReadiness.configured) {
        return secureJson({ error:hostReadiness.reason, code:'E2PAY_HOST_NOT_READY', readiness:hostReadiness }, 409, request, env, METHODS);
      }
      const auth = await e2payHostAuthorize(runtimeEnv);
      const executionReadiness = e2payReadiness(runtimeEnv);
      await d1Batch(env.DB, [auditOperation(
        organizationId,
        authorization.actor,
        'E2PAY_HOST_CONNECTION_TESTED',
        'environment=' + hostReadiness.environment + ' · merchant=' + clean(runtimeEnv.E2PAY_MERCHANT_NAME, 120),
      )]);
      return secureJson({
        ok:true,
        readiness:hostReadiness,
        executionReadiness,
        connection:{
          hostAuthorized:true,
          tokenType:auth.tokenType,
          expiresIn:auth.expiresIn,
          merchantName:clean(runtimeEnv.E2PAY_MERCHANT_NAME, 200),
          partnerId:clean(runtimeEnv.E2PAY_PARTNER_ID, 100),
          sourceId:clean(runtimeEnv.E2PAY_SOURCE_ID, 200),
          nextStep:executionReadiness.configured
            ? 'Disbursement execution ready.'
            : 'Host credential valid. Merchant registration/login data is still required before disbursement execution.',
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
      hostReadiness:e2payHostReadiness(runtimeEnv),
      readiness:gatewayReadiness(runtimeEnv),
    }, 200, request, env, METHODS);
  } catch (error) {
    const requestId = crypto.randomUUID();
    return secureJson(publicError(error, requestId), 500, request, env, METHODS);
  }
}
