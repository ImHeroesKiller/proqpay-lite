import { authorize, enforceRateLimit, handlePreflight, publicError, secureJson } from './_security.js';
import { d1Batch, hasD1 } from './_d1.js';
import {
  activateGatewaySecureSettings,
  gatewayRuntimeEnv,
  publicGatewaySettings,
  readGatewaySecureSettings,
  writeGatewaySecureSettings,
} from './payment-gateway-settings-store.js';
import { gatewayReadiness } from './payment-gateway-core.js';
import {
  e2payAuthorize,
  e2payBankList,
  e2payHostAuthorize,
  e2payHostReadiness,
  e2payMerchantAccount,
  normalizeE2PayPassword,
  e2payReadiness,
  e2payVerifyUsername,
} from './payment-gateway-e2pay.js';

const METHODS = 'GET, POST, OPTIONS';
const ROLES = ['SUPER_ADMIN'];

function orgId(env, actor) {
  return String(actor?.orgId || env.DEFAULT_ORG_ID || 'ORG-OTSINDO');
}

function clean(value, max = 500) {
  return String(value ?? '').trim().slice(0, max);
}

function correlationId(request) {
  return clean(request.headers.get('X-Request-Id') || request.headers.get('X-Correlation-Id') || crypto.randomUUID(), 120);
}

function auditOperation(organizationId, actor, action, detail, requestId) {
  return {
    statement:`INSERT INTO audit_logs(id,org_id,username,role,action,detail,entity,entity_id,correlation_id)
      VALUES(?,?,?,?,?,?,?,?,?)`,
    bindings:[
      'AUD-' + crypto.randomUUID(),
      organizationId,
      actor.email,
      actor.role,
      action,
      detail,
      'gateway_secure_settings',
      organizationId,
      requestId,
    ],
  };
}

function parseCredentials(body) {
  const password=String(body.password ?? '').slice(0, 200);
  const values = {
    merchantName:clean(body.merchantName, 200),
    clientId:clean(body.clientId, 300),
    clientSecret:clean(body.clientSecret, 500),
    partnerId:clean(body.partnerId, 100),
    sourceId:clean(body.sourceId, 200),
    username:clean(body.username, 200),
    merchantId:clean(body.merchantId, 100),
    passwordMd5:password ? normalizeE2PayPassword(password) : '',
  };
  return Object.fromEntries(Object.entries(values).filter(([, value]) => Boolean(value)));
}

async function testE2PayConnection(database, env, organizationId, body) {
  const environment = clean(body.environment || 'UAT', 40).toUpperCase();
  if (!['UAT','PRODUCTION'].includes(environment)) {
    const error = new Error('Environment E2Pay harus UAT atau PRODUCTION');
    error.code = 'E2PAY_ENV_INVALID';
    throw error;
  }

  const draft = parseCredentials(body);
  const storedRuntime = await gatewayRuntimeEnv(database, env, organizationId, environment);
  const runtimeEnv = Object.assign(Object.create(storedRuntime || null), {
    PAYMENT_GATEWAY_PROVIDER:'E2PAY',
    E2PAY_ENV:environment,
    E2PAY_MERCHANT_NAME:draft.merchantName || storedRuntime.E2PAY_MERCHANT_NAME || '',
    E2PAY_CLIENT_ID:draft.clientId || storedRuntime.E2PAY_CLIENT_ID || '',
    E2PAY_CLIENT_SECRET:draft.clientSecret || storedRuntime.E2PAY_CLIENT_SECRET || '',
    E2PAY_PARTNER_ID:draft.partnerId || storedRuntime.E2PAY_PARTNER_ID || '',
    E2PAY_SOURCE_ID:draft.sourceId || storedRuntime.E2PAY_SOURCE_ID || '',
    E2PAY_USERNAME:draft.username || storedRuntime.E2PAY_USERNAME || '',
    E2PAY_PASSWORD_MD5:draft.passwordMd5 || storedRuntime.E2PAY_PASSWORD_MD5 || '',
    E2PAY_MERCHANT_ID:draft.merchantId || storedRuntime.E2PAY_MERCHANT_ID || '',
  });

  const hostReadiness = e2payHostReadiness(runtimeEnv);
  if (!hostReadiness.configured) {
    const error = new Error(hostReadiness.reason || 'Credential host E2Pay belum lengkap');
    error.code = 'E2PAY_HOST_NOT_READY';
    error.readiness = hostReadiness;
    throw error;
  }

  const hostAuth = await e2payHostAuthorize(runtimeEnv);
  const verified = runtimeEnv.E2PAY_USERNAME
    ? await e2payVerifyUsername(runtimeEnv, hostAuth.accessToken, runtimeEnv.E2PAY_USERNAME)
    : null;

  if (verified?.partnerId && runtimeEnv.E2PAY_PARTNER_ID && String(verified.partnerId) !== String(runtimeEnv.E2PAY_PARTNER_ID)) {
    const error = new Error('Partner ID hasil verifyUsername tidak sesuai credential');
    error.code = 'E2PAY_PARTNER_MISMATCH';
    throw error;
  }

  let account = null;
  let banks = [];
  let accountSrc = clean(verified?.accountId || runtimeEnv.E2PAY_ACCOUNT_SRC || '', 200);
  let executionReadiness = e2payReadiness(Object.assign(Object.create(runtimeEnv), { E2PAY_ACCOUNT_SRC:accountSrc }));

  if (runtimeEnv.E2PAY_USERNAME && runtimeEnv.E2PAY_PASSWORD_MD5) {
    const userAuth = await e2payAuthorize(Object.assign(Object.create(runtimeEnv), { E2PAY_ACCOUNT_SRC:accountSrc || 'DISCOVERY' }));
    [account, banks] = await Promise.all([
      e2payMerchantAccount(runtimeEnv, userAuth.accessToken),
      e2payBankList(runtimeEnv, userAuth.accessToken),
    ]);
    const accountFromLogin = clean(account?.accountId || '', 200);
    if (accountFromLogin && accountSrc && accountFromLogin !== accountSrc) {
      const error = new Error('accountId verifyUsername berbeda dengan Merchant Account');
      error.code = 'E2PAY_ACCOUNT_MISMATCH';
      throw error;
    }
    accountSrc = accountFromLogin || accountSrc;
    if (!accountSrc) {
      const error = new Error('accountId/source account tidak ditemukan dari E2Pay');
      error.code = 'E2PAY_ACCOUNT_SRC_MISSING';
      throw error;
    }
    executionReadiness = e2payReadiness(Object.assign(Object.create(runtimeEnv), { E2PAY_ACCOUNT_SRC:accountSrc }));
  }

  return {
    environment,
    draft,
    accountSrc,
    hostReadiness,
    executionReadiness,
    connection:{
      hostAuthorized:true,
      merchantLoginAuthorized:Boolean(account),
      tokenType:hostAuth.tokenType,
      expiresIn:hostAuth.expiresIn,
      merchantName:clean(verified?.merchantName || runtimeEnv.E2PAY_MERCHANT_NAME, 200),
      merchantStatus:clean(verified?.status || account?.merchantStatus || '', 100),
      merchantId:clean(runtimeEnv.E2PAY_MERCHANT_ID, 100),
      partnerId:clean(verified?.partnerId || runtimeEnv.E2PAY_PARTNER_ID, 100),
      sourceId:clean(runtimeEnv.E2PAY_SOURCE_ID, 200),
      accountSrcMasked:accountSrc ? '••••' + accountSrc.slice(-4) : '',
      bankCount:banks.length,
      nextStep:executionReadiness.configured
        ? 'Merchant login valid dan source account ditemukan. Profile siap diaktifkan.'
        : 'Host credential valid. Lengkapi username/password untuk merchant login validation.',
    },
  };
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

  const organizationId = orgId(env, authorization.actor);
  const requestId = correlationId(request);

  try {
    if (request.method === 'GET') {
      const stored = await readGatewaySecureSettings(env.DB, env, organizationId);
      const runtimeEnv = await gatewayRuntimeEnv(env.DB, env, organizationId);
      return secureJson({
        ok:true,
        settings:publicGatewaySettings(stored),
        readiness:gatewayReadiness(runtimeEnv),
        correlationId:requestId,
      }, 200, request, env, METHODS);
    }

    const body = await request.json();
    const action = String(body.action || 'SAVE').trim().toUpperCase();

    if (action === 'TEST') {
      const tested = await testE2PayConnection(env.DB, env, organizationId, body);
      await d1Batch(env.DB, [auditOperation(
        organizationId,
        authorization.actor,
        'E2PAY_CONNECTION_TESTED',
        'environment=' + tested.environment + ' · executionReady=' + Boolean(tested.executionReadiness?.configured) + ' · accountLast4=' + tested.accountSrc.slice(-4),
        requestId,
      )]);
      return secureJson({
        ok:true,
        readiness:tested.hostReadiness,
        executionReadiness:tested.executionReadiness,
        connection:tested.connection,
        persisted:false,
        correlationId:requestId,
      }, 200, request, env, METHODS);
    }

    if (action === 'ACTIVATE') {
      const provider = clean(body.provider || 'E2PAY', 40).toUpperCase();
      const environment = clean(body.environment || 'UAT', 40).toUpperCase();
      if (!['UNCONFIGURED','E2PAY'].includes(provider)) {
        return secureJson({ error:'Provider payment gateway tidak valid' }, 422, request, env, METHODS);
      }
      if (!['UAT','PRODUCTION'].includes(environment)) {
        return secureJson({ error:'Environment E2Pay harus UAT atau PRODUCTION' }, 422, request, env, METHODS);
      }
      const requiredConfirmation = provider === 'UNCONFIGURED'
        ? 'DISABLE_GATEWAY'
        : environment === 'PRODUCTION' ? 'ACTIVATE_PRODUCTION' : 'ACTIVATE_UAT';
      if (clean(body.confirmation, 80).toUpperCase() !== requiredConfirmation) {
        return secureJson({ error:'Konfirmasi aktivasi tidak valid', code:'ACTIVATION_CONFIRMATION_REQUIRED', requiredConfirmation }, 409, request, env, METHODS);
      }

      let discoveredCredentials = parseCredentials(body);
      let activationDetail = 'provider=' + provider + ' · environment=' + environment;
      if (provider === 'E2PAY') {
        const tested = await testE2PayConnection(env.DB, env, organizationId, { ...body, environment });
        if (!tested.executionReadiness?.configured) {
          return secureJson({
            error:'Profile belum execution-ready. Merchant login dan source account wajib valid sebelum aktivasi.',
            code:'E2PAY_EXECUTION_NOT_READY',
            readiness:tested.executionReadiness,
            connection:tested.connection,
          }, 409, request, env, METHODS);
        }
        discoveredCredentials = { ...tested.draft, accountSrc:tested.accountSrc };
        activationDetail += ' · accountLast4=' + tested.accountSrc.slice(-4);
      }

      const stored = await activateGatewaySecureSettings(
        env.DB,
        env,
        organizationId,
        authorization.actor.email,
        { provider, environment, credentials:discoveredCredentials },
      );
      await d1Batch(env.DB, [auditOperation(
        organizationId,
        authorization.actor,
        provider === 'UNCONFIGURED' ? 'PAYMENT_GATEWAY_DEACTIVATED' : 'PAYMENT_GATEWAY_PROFILE_ACTIVATED',
        activationDetail,
        requestId,
      )]);
      const runtimeEnv = await gatewayRuntimeEnv(env.DB, env, organizationId);
      return secureJson({
        ok:true,
        settings:publicGatewaySettings(stored),
        readiness:gatewayReadiness(runtimeEnv),
        correlationId:requestId,
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
      'PAYMENT_GATEWAY_DRAFT_SAVED',
      'provider=' + provider + ' · environment=' + environment + ' · credentialFields=' + Object.keys(credentials).join(','),
      requestId,
    )]);
    const runtimeEnv = await gatewayRuntimeEnv(env.DB, env, organizationId);
    return secureJson({
      ok:true,
      settings:publicGatewaySettings(stored),
      hostReadiness:e2payHostReadiness(Object.assign(Object.create(runtimeEnv), { E2PAY_ENV:environment })),
      readiness:gatewayReadiness(runtimeEnv),
      activated:false,
      correlationId:requestId,
    }, 200, request, env, METHODS);
  } catch (error) {
    const code = clean(error?.code, 80);
    if (code.startsWith('E2PAY_')) {
      return secureJson({
        error:error instanceof Error ? error.message : 'E2Pay validation failed',
        code,
        readiness:error?.readiness,
        correlationId:requestId,
      }, code === 'E2PAY_ENV_INVALID' ? 422 : 409, request, env, METHODS);
    }
    return secureJson(publicError(error, requestId), 500, request, env, METHODS);
  }
}
