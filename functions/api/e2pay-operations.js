import { authorize, enforceRateLimit, handlePreflight, publicError, secureJson } from './_security.js';
import { d1Batch, d1First, d1Run, hasD1 } from './_d1.js';
import { activateGatewaySecureSettings, gatewayRuntimeEnv } from './payment-gateway-settings-store.js';
import {
  e2payAuthorize,
  e2payBankListPage,
  e2payChangePassword,
  e2payChangePhoneConfirm,
  e2payChangePhoneRequest,
  e2payHostAuthorize,
  e2payInquiry,
  e2payLogout,
  e2payMerchantAccount,
  e2payReadiness,
  e2payRefreshAccessToken,
  e2payRegisterConfirm,
  e2payRegisterRequest,
  e2payResetPasswordConfirm,
  e2payResetPasswordRequest,
  e2payTransactionHistoryList,
  e2payVerifyUsername,
  normalizeE2PayPassword,
} from './payment-gateway-e2pay.js';

const METHODS='GET, POST, OPTIONS';
const READ_ROLES=['SUPER_ADMIN','PAYROLL_PROCESSOR','PAYROLL_CONTROLLER'];
const MANAGE_ROLES=['SUPER_ADMIN'];
const SNAPSHOT_TTL_MS=60_000;

const CATALOG=Object.freeze([
  { id:'HOST_AUTH', method:'POST', path:'/rest/oauth/token', function:'Client Host Authorization', mode:'SERVER_MANAGED' },
  { id:'REGISTER_REQUEST', method:'POST', path:'/b2b/merchant/register/request', function:'Merchant Registration Request', mode:'ADMIN_ACTION' },
  { id:'REGISTER_CONFIRM', method:'POST', path:'/b2b/merchant/register/confirm', function:'Complete Registration', mode:'ADMIN_ACTION' },
  { id:'AUTHORIZE', method:'POST', path:'/rest/h2h/authorization/', function:'Merchant Authorization Code', mode:'SERVER_MANAGED' },
  { id:'ACCESS_TOKEN', method:'POST', path:'/rest/oauth/token', function:'Merchant Access Token', mode:'SERVER_MANAGED' },
  { id:'REFRESH_TOKEN', method:'POST', path:'/rest/oauth/token', function:'Refresh Access Token', mode:'DIAGNOSTIC' },
  { id:'ACCOUNT', method:'GET', path:'/b2b/merchant/me/account', function:'Merchant Account & Balance', mode:'LIVE_READ' },
  { id:'TRANSACTIONS', method:'GET', path:'/b2b/merchant/me/transaction', function:'Transaction History', mode:'LIVE_READ' },
  { id:'CHANGE_PASSWORD', method:'PUT', path:'/b2b/merchant/me/auth/password', function:'Change Merchant Password', mode:'ADMIN_ACTION' },
  { id:'RESET_PASSWORD_REQUEST', method:'POST', path:'/b2b/merchant/auth/password/resetRequest', function:'Reset Password Request', mode:'ADMIN_ACTION' },
  { id:'RESET_PASSWORD_CONFIRM', method:'POST', path:'/b2b/merchant/auth/password/resetConfirm', function:'Reset Password Confirm', mode:'ADMIN_ACTION' },
  { id:'CHANGE_PHONE_REQUEST', method:'POST', path:'/b2b/merchant/me/phone/updateRequest', function:'Change Phone Request', mode:'ADMIN_ACTION' },
  { id:'CHANGE_PHONE_CONFIRM', method:'PUT', path:'/b2b/merchant/me/phone/updateConfirm', function:'Change Phone Confirm', mode:'ADMIN_ACTION' },
  { id:'INQUIRY', method:'GET', path:'/b2b/merchant/me/sdp/inquiry', function:'Disbursement Inquiry', mode:'ADMIN_ACTION' },
  { id:'DISBURSEMENT', method:'POST', path:'/b2b/merchant/me/sdp/transaction', function:'Disbursement Process', mode:'PAYMENT_CONTROL_ONLY' },
  { id:'VERIFY_USERNAME', method:'GET', path:'/b2b/merchant/auth/verifyUsername', function:'Verify Merchant Username', mode:'ADMIN_ACTION' },
  { id:'LOGOUT', method:'POST', path:'/rest/oauth/token/logout', function:'Logout', mode:'DIAGNOSTIC' },
  { id:'BANKS', method:'GET', path:'/b2b/bank/sdp', function:'Bank List Disbursement', mode:'LIVE_READ' },
]);

function orgId(env,actor){ return String(actor?.orgId || env.DEFAULT_ORG_ID || 'ORG-OTSINDO'); }
function clean(value,max=500){ return String(value ?? '').trim().slice(0,max); }
function requestId(request){ return clean(request.headers.get('X-Request-Id') || request.headers.get('X-Correlation-Id') || crypto.randomUUID(),120); }
function maskPhone(value){ const v=String(value||''); return v ? '••••'+v.slice(-4) : null; }
function isFresh(value){ const t=new Date(value||0).getTime(); return Number.isFinite(t) && Date.now()-t<SNAPSHOT_TTL_MS; }

function audit(organizationId,actor,action,detail,correlationId){
  return {
    statement:`INSERT INTO audit_logs(id,org_id,username,role,action,detail,entity,entity_id,correlation_id)
      VALUES(?,?,?,?,?,?,?,?,?)`,
    bindings:['AUD-'+crypto.randomUUID(),organizationId,actor.email,actor.role,action,detail,'payment_gateway','E2PAY',correlationId],
  };
}

async function snapshot(database,organizationId,environment){
  return d1First(database,`SELECT * FROM payment_gateway_provider_snapshots
    WHERE org_id=? AND provider='E2PAY' AND environment=? LIMIT 1`,[organizationId,environment]);
}

async function saveSnapshot(database,organizationId,environment,account,bankCount=null){
  await d1Run(database,`INSERT INTO payment_gateway_provider_snapshots
    (org_id,provider,environment,account_id,account_name,merchant_status,account_type_name,account_group_name,balance,phone_masked,bank_count,source,refreshed_at)
    VALUES(?,'E2PAY',?,?,?,?,?,?,?,?,?,?,'PROVIDER',strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    ON CONFLICT(org_id,provider,environment) DO UPDATE SET
      account_id=excluded.account_id,account_name=excluded.account_name,merchant_status=excluded.merchant_status,
      account_type_name=excluded.account_type_name,account_group_name=excluded.account_group_name,balance=excluded.balance,
      phone_masked=excluded.phone_masked,bank_count=COALESCE(excluded.bank_count,payment_gateway_provider_snapshots.bank_count),
      source='PROVIDER',refreshed_at=excluded.refreshed_at`,
    [
      organizationId,environment,clean(account?.accountId,120),clean(account?.accountName,200),
      clean(account?.merchantStatus,80),clean(account?.accountTypeName,120),clean(account?.accountGroupName,160),
      Number(account?.balance || 0),maskPhone(account?.phone),bankCount,
    ]);
  return snapshot(database,organizationId,environment);
}

async function liveAccount(database,runtimeEnv,organizationId,includeBanks=false){
  const auth=await e2payAuthorize(runtimeEnv);
  const account=await e2payMerchantAccount(runtimeEnv,auth.accessToken);
  let bankCount=null;
  if(includeBanks){
    const banks=await e2payBankListPage(runtimeEnv,auth.accessToken,{limit:1000,sortField:'name',sortOrder:'ASCENDING'});
    bankCount=banks.rowCount || banks.data.length;
  }
  return saveSnapshot(database,organizationId,String(runtimeEnv.E2PAY_ENV||'UAT'),account,bankCount);
}

function publicSnapshot(row,readiness){
  if(!row) return { available:false,balance:null,refreshedAt:null,readiness };
  return {
    available:true,
    provider:'E2PAY',
    environment:row.environment,
    accountIdMasked:row.account_id ? '••••'+String(row.account_id).slice(-4) : null,
    accountName:row.account_name,
    merchantStatus:row.merchant_status,
    accountTypeName:row.account_type_name,
    accountGroupName:row.account_group_name,
    balance:Number(row.balance || 0),
    phoneMasked:row.phone_masked,
    bankCount:row.bank_count===null ? null : Number(row.bank_count),
    refreshedAt:row.refreshed_at,
    readiness,
  };
}

async function userToken(runtimeEnv){ return e2payAuthorize(runtimeEnv); }
async function hostToken(runtimeEnv){ return e2payHostAuthorize(runtimeEnv); }

export async function onRequest({request,env}){
  if(request.method==='OPTIONS') return handlePreflight(request,env,METHODS);
  if(!['GET','POST'].includes(request.method)) return secureJson({error:'Method not allowed'},405,request,env,METHODS);

  const authorization=await authorize(request,env,{roles:READ_ROLES,mutating:request.method==='POST',methods:METHODS});
  if(authorization.response) return authorization.response;
  const limited=await enforceRateLimit(request,env,authorization.actor,'e2pay-operations',METHODS);
  if(limited) return limited;
  if(!hasD1(env)) return secureJson({error:'Cloudflare D1 binding unavailable',code:'D1_REQUIRED'},503,request,env,METHODS);

  const organizationId=orgId(env,authorization.actor);
  const correlationId=requestId(request);

  try{
    const runtimeEnv=await gatewayRuntimeEnv(env.DB,env,organizationId);
    if(String(runtimeEnv.PAYMENT_GATEWAY_PROVIDER||'').toUpperCase()!=='E2PAY'){
      return secureJson({error:'E2Pay bukan active payment gateway',code:'E2PAY_NOT_ACTIVE'},409,request,env,METHODS);
    }
    const readiness=e2payReadiness(runtimeEnv);

    if(request.method==='GET'){
      const url=new URL(request.url);
      const resource=String(url.searchParams.get('resource')||'overview').toLowerCase();
      if(!['overview','account','catalog'].includes(resource) && !MANAGE_ROLES.includes(authorization.actor.role)){
        return secureJson({error:'Resource E2Pay ini hanya tersedia untuk Super Admin'},403,request,env,METHODS);
      }
      if(resource==='catalog') return secureJson({ok:true,catalog:CATALOG,environment:runtimeEnv.E2PAY_ENV||'UAT'},200,request,env,METHODS);

      if(resource==='overview' || resource==='account'){
        let row=await snapshot(env.DB,organizationId,String(runtimeEnv.E2PAY_ENV||'UAT'));
        const force=url.searchParams.get('refresh')==='1';
        if(readiness.configured && (force || !row || !isFresh(row.refreshed_at))){
          row=await liveAccount(env.DB,runtimeEnv,organizationId,resource==='overview');
        }
        return secureJson({ok:true,account:publicSnapshot(row,readiness),catalogCount:CATALOG.length},200,request,env,METHODS);
      }

      if(!readiness.configured) return secureJson({error:readiness.reason,code:'E2PAY_NOT_READY',readiness},503,request,env,METHODS);
      const auth=await userToken(runtimeEnv);

      if(resource==='banks'){
        const result=await e2payBankListPage(runtimeEnv,auth.accessToken,{
          limit:url.searchParams.get('limit')||1000,
          id:url.searchParams.get('id')||'',
          name:url.searchParams.get('name')||'',
          sortField:url.searchParams.get('sortField')||'name',
          sortOrder:url.searchParams.get('sortOrder')||'ASCENDING',
        });
        return secureJson({ok:true,...result},200,request,env,METHODS);
      }

      if(resource==='transactions'){
        const filters=Object.fromEntries(url.searchParams.entries());
        delete filters.resource;
        const result=await e2payTransactionHistoryList(runtimeEnv,auth.accessToken,filters);
        return secureJson({ok:true,...result},200,request,env,METHODS);
      }

      return secureJson({error:'Resource E2Pay tidak dikenal'},404,request,env,METHODS);
    }

    if(!MANAGE_ROLES.includes(authorization.actor.role)){
      return secureJson({error:'Operasi administratif E2Pay hanya tersedia untuk Super Admin'},403,request,env,METHODS);
    }

    const body=await request.json();
    const action=String(body.action||'').trim().toUpperCase();
    let result;

    if(action==='REFRESH_ACCOUNT'){
      if(!readiness.configured) return secureJson({error:readiness.reason,code:'E2PAY_NOT_READY'},503,request,env,METHODS);
      const row=await liveAccount(env.DB,runtimeEnv,organizationId,true);
      result={account:publicSnapshot(row,readiness)};
    } else if(action==='VERIFY_USERNAME'){
      const host=await hostToken(runtimeEnv);
      result={verification:await e2payVerifyUsername(runtimeEnv,host.accessToken,body.username||runtimeEnv.E2PAY_USERNAME)};
    } else if(action==='TOKEN_REFRESH_TEST'){
      const auth=await userToken(runtimeEnv);
      if(!auth.refreshToken) return secureJson({error:'E2Pay tidak mengembalikan refresh_token',code:'E2PAY_REFRESH_TOKEN_MISSING'},409,request,env,METHODS);
      const refreshed=await e2payRefreshAccessToken(runtimeEnv,auth.refreshToken);
      result={token:{refreshed:true,tokenType:refreshed.tokenType,expiresIn:refreshed.expiresIn,refreshTokenReturned:Boolean(refreshed.refreshToken)}};
    } else if(action==='REGISTER_REQUEST'){
      const host=await hostToken(runtimeEnv);
      result={registration:await e2payRegisterRequest(runtimeEnv,host.accessToken,body)};
    } else if(action==='REGISTER_CONFIRM'){
      const host=await hostToken(runtimeEnv);
      result={registration:await e2payRegisterConfirm(runtimeEnv,host.accessToken,body)};
    } else if(action==='CHANGE_PASSWORD'){
      const auth=await userToken(runtimeEnv);
      await e2payChangePassword(runtimeEnv,auth.accessToken,body);
      await activateGatewaySecureSettings(env.DB,env,organizationId,authorization.actor.email,{
        provider:'E2PAY',environment:runtimeEnv.E2PAY_ENV,credentials:{passwordMd5:normalizeE2PayPassword(body.newPassword)},
      });
      result={changed:true};
    } else if(action==='RESET_PASSWORD_REQUEST'){
      const host=await hostToken(runtimeEnv);
      result={reset:await e2payResetPasswordRequest(runtimeEnv,host.accessToken,body)};
    } else if(action==='RESET_PASSWORD_CONFIRM'){
      const host=await hostToken(runtimeEnv);
      await e2payResetPasswordConfirm(runtimeEnv,host.accessToken,body);
      await activateGatewaySecureSettings(env.DB,env,organizationId,authorization.actor.email,{
        provider:'E2PAY',environment:runtimeEnv.E2PAY_ENV,credentials:{passwordMd5:normalizeE2PayPassword(body.newPassword)},
      });
      result={changed:true};
    } else if(action==='CHANGE_PHONE_REQUEST'){
      const auth=await userToken(runtimeEnv);
      result={phone:await e2payChangePhoneRequest(runtimeEnv,auth.accessToken,body)};
    } else if(action==='CHANGE_PHONE_CONFIRM'){
      const auth=await userToken(runtimeEnv);
      await e2payChangePhoneConfirm(runtimeEnv,auth.accessToken,body);
      await activateGatewaySecureSettings(env.DB,env,organizationId,authorization.actor.email,{
        provider:'E2PAY',environment:runtimeEnv.E2PAY_ENV,credentials:{username:clean(body.phone,200)},
      });
      result={changed:true};
    } else if(action==='INQUIRY'){
      const auth=await userToken(runtimeEnv);
      result={inquiry:await e2payInquiry(runtimeEnv,auth.accessToken,body)};
    } else if(action==='LOGOUT'){
      const auth=await userToken(runtimeEnv);
      result={logout:await e2payLogout(runtimeEnv,auth.accessToken)};
    } else if(action==='DISBURSEMENT'){
      return secureJson({
        error:'Raw disbursement dinonaktifkan di Integration Console. Jalankan pembayaran melalui approved Payment Instruction agar maker-checker, idempotency, beneficiary snapshot, reconciliation, dan audit trail tetap berlaku.',
        code:'E2PAY_PAYMENT_CONTROL_REQUIRED',
      },409,request,env,METHODS);
    } else {
      return secureJson({error:'Action E2Pay tidak dikenal'},422,request,env,METHODS);
    }

    await d1Batch(env.DB,[audit(organizationId,authorization.actor,'E2PAY_'+action,'E2Pay Integration Console action',correlationId)]);
    return secureJson({ok:true,action,...result,correlationId},200,request,env,METHODS);
  } catch(error){
    const code=clean(error?.code,100);
    const status=code.startsWith('E2PAY_') ? 409 : 500;
    return secureJson({
      ...(status===500 ? publicError(error,correlationId) : {error:error instanceof Error?error.message:'E2Pay operation failed'}),
      code:code||undefined,
      correlationId,
    },status,request,env,METHODS);
  }
}
