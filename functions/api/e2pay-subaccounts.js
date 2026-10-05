import { authorize, enforceRateLimit, handlePreflight, publicError, secureJson } from './_security.js';
import { d1All, d1Batch, d1First, hasD1 } from './_d1.js';
import { gatewayRuntimeEnv } from './payment-gateway-settings-store.js';
import { e2payAuthorize, e2payHostAuthorize, e2payMerchantAccount, e2payRegisterRequest } from './payment-gateway-e2pay.js';
import { liquidityState } from './payment-provider-routing.js';

const METHODS='GET, POST, OPTIONS';
const READ_ROLES=['SUPER_ADMIN','PAYROLL_PROCESSOR','PAYROLL_CONTROLLER'];
const MANAGE_ROLES=['SUPER_ADMIN','PAYROLL_PROCESSOR'];
const STATUSES=['DRAFT','ACTIVE','INACTIVE'];
const ENVIRONMENTS=['UAT','PRODUCTION'];

function clean(value,max=300){ return String(value ?? '').trim().slice(0,max); }
function orgId(env,actor){ return String(actor?.orgId || env.DEFAULT_ORG_ID || 'ORG-OTSINDO'); }
function correlationId(request){ return clean(request.headers.get('X-Request-Id') || request.headers.get('X-Correlation-Id') || crypto.randomUUID(),120); }
function masked(value){
  const text=clean(value,300);
  return text ? '••••'+text.slice(-4) : null;
}
function publicRow(row,requiredAmount=0){
  return {
    id:row.id,
    clientId:row.client_id,
    clientCode:row.client_code,
    clientName:row.client_name,
    provider:row.provider,
    environment:row.environment,
    accountScope:row.account_scope,
    providerAccountIdMasked:masked(row.provider_account_id),
    providerSubAccountIdMasked:masked(row.provider_sub_account_id),
    accountName:row.account_name,
    currency:row.currency,
    status:row.status,
    balance:row.balance===null?null:Number(row.balance),
    availableBalance:row.available_balance===null?null:Number(row.available_balance),
    lastBalanceSyncAt:row.last_balance_sync_at,
    createdAt:row.created_at,
    updatedAt:row.updated_at,
    liquidity:liquidityState(row,requiredAmount),
  };
}
function audit(org,actor,action,entityId,detail,requestId){
  return {
    statement:`INSERT INTO audit_logs(id,org_id,username,role,action,detail,entity,entity_id,correlation_id)
      VALUES(?,?,?,?,?,?,?,?,?)`,
    bindings:['AUD-'+crypto.randomUUID(),org,actor.email,actor.role,action,detail,'payment_provider_account',entityId,requestId],
  };
}

export async function onRequest({request,env}){
  if(request.method==='OPTIONS') return handlePreflight(request,env,METHODS);
  if(!['GET','POST'].includes(request.method)) return secureJson({error:'Method not allowed'},405,request,env,METHODS);

  const authorization=await authorize(request,env,{
    roles:READ_ROLES,
    mutating:request.method==='POST',
    methods:METHODS,
  });
  if(authorization.response) return authorization.response;
  const limited=await enforceRateLimit(request,env,authorization.actor,'e2pay-subaccounts',METHODS);
  if(limited) return limited;
  if(!hasD1(env)) return secureJson({error:'Cloudflare D1 binding unavailable',code:'D1_REQUIRED'},503,request,env,METHODS);

  const actor=authorization.actor;
  const organizationId=orgId(env,actor);
  const requestId=correlationId(request);

  try{
    if(request.method==='GET'){
      const url=new URL(request.url);
      const environment=clean(url.searchParams.get('environment')||'UAT',40).toUpperCase();
      const requiredAmount=Math.max(0,Number(url.searchParams.get('requiredAmount')||0)||0);
      if(!ENVIRONMENTS.includes(environment)) return secureJson({error:'Environment tidak valid'},422,request,env,METHODS);

      const [rows,clients]=await Promise.all([
        d1All(env.DB,`SELECT ppa.*,c.code AS client_code,c.name AS client_name
          FROM payment_provider_accounts ppa
          LEFT JOIN clients c ON c.id=ppa.client_id
          WHERE ppa.org_id=? AND ppa.provider='E2PAY' AND ppa.environment=?
          ORDER BY CASE ppa.status WHEN 'ACTIVE' THEN 0 WHEN 'DRAFT' THEN 1 ELSE 2 END,c.name,ppa.created_at`,
          [organizationId,environment]),
        d1All(env.DB,`SELECT id,code,name,status FROM clients WHERE org_id=? ORDER BY name`,[organizationId]),
      ]);
      return secureJson({
        ok:true,
        provider:'E2PAY',
        environment,
        accounts:rows.map((row)=>publicRow(row,requiredAmount)),
        clients,
        summary:{
          total:rows.length,
          active:rows.filter((row)=>row.status==='ACTIVE').length,
          draft:rows.filter((row)=>row.status==='DRAFT').length,
          inactive:rows.filter((row)=>row.status==='INACTIVE').length,
          unmappedClients:clients.filter((client)=>!rows.some((row)=>row.client_id===client.id && row.account_scope==='SUB_ACCOUNT')).length,
        },
        correlationId:requestId,
      },200,request,env,METHODS);
    }

    if(!MANAGE_ROLES.includes(actor.role)){
      return secureJson({error:'Mapping sub-account E2Pay hanya tersedia untuk Super Admin atau Payroll Processor'},403,request,env,METHODS);
    }

    const body=await request.json().catch(()=>({}));
    const action=clean(body.action||'UPSERT_SUBACCOUNT',80).toUpperCase();

    if(action==='REGISTER_SUBACCOUNT'){
      const clientId=clean(body.clientId,120);
      const environment=clean(body.environment||'UAT',40).toUpperCase();
      const phone=clean(body.phone,40);
      const email=clean(body.email,254)||null;
      if(!clientId||!phone) return secureJson({error:'clientId dan nomor HP wajib diisi'},422,request,env,METHODS);
      if(!ENVIRONMENTS.includes(environment)) return secureJson({error:'Environment tidak valid'},422,request,env,METHODS);
      const client=await d1First(env.DB,'SELECT id,name,status FROM clients WHERE id=? AND org_id=? LIMIT 1',[clientId,organizationId]);
      if(!client) return secureJson({error:'Client tidak ditemukan'},404,request,env,METHODS);
      const existing=await d1First(env.DB,`SELECT * FROM payment_provider_accounts
        WHERE org_id=? AND client_id=? AND provider='E2PAY' AND environment=? AND account_scope='SUB_ACCOUNT' LIMIT 1`,
        [organizationId,clientId,environment]);
      if(existing?.provider_sub_account_id) return secureJson({error:'Client sudah memiliki sub-account E2Pay',code:'E2PAY_SUBACCOUNT_ALREADY_REGISTERED'},409,request,env,METHODS);

      const runtimeEnv=await gatewayRuntimeEnv(env.DB,env,organizationId,environment);
      const host=await e2payHostAuthorize(runtimeEnv);
      const registration=await e2payRegisterRequest(runtimeEnv,host.accessToken,{phone,name:client.name,email});
      const providerSubAccountId=clean(registration?.accountId||registration?.merchantId||registration?.id,200)||null;
      const id=existing?.id||'PPA-'+crypto.randomUUID();
      const status=providerSubAccountId?'ACTIVE':'DRAFT';
      const metadata=JSON.stringify({registrationRequestedAt:new Date().toISOString(),phoneLast4:phone.slice(-4),registrationState:providerSubAccountId?'PROVISIONED':'PENDING_CONFIRMATION'});
      const operations=[];
      if(existing){
        operations.push({statement:`UPDATE payment_provider_accounts SET provider_sub_account_id=COALESCE(?,provider_sub_account_id),account_name=?,status=?,metadata_json=?,updated_by=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND org_id=?`,
          bindings:[providerSubAccountId,client.name,status,metadata,actor.email,id,organizationId]});
      }else{
        operations.push({statement:`INSERT INTO payment_provider_accounts
          (id,org_id,client_id,provider,environment,account_scope,provider_sub_account_id,account_name,currency,status,metadata_json,created_by,updated_by)
          VALUES(?,?,?,'E2PAY',?,'SUB_ACCOUNT',?,?,'IDR',?,?,?,?)`,
          bindings:[id,organizationId,clientId,environment,providerSubAccountId,client.name,status,metadata,actor.email,actor.email]});
      }
      operations.push(audit(organizationId,actor,'E2PAY_SUBACCOUNT_REGISTRATION_REQUESTED',id,
        `clientId=${clientId} · environment=${environment} · phoneLast4=${phone.slice(-4)} · status=${status}`,requestId));
      await d1Batch(env.DB,operations);
      const row=await d1First(env.DB,`SELECT ppa.*,c.code AS client_code,c.name AS client_name
        FROM payment_provider_accounts ppa LEFT JOIN clients c ON c.id=ppa.client_id WHERE ppa.id=? LIMIT 1`,[id]);
      return secureJson({ok:true,account:publicRow(row),registration:{state:providerSubAccountId?'PROVISIONED':'PENDING_CONFIRMATION'},correlationId:requestId},providerSubAccountId?201:202,request,env,METHODS);
    }

    if(action==='SYNC_BALANCE'){
      const id=clean(body.id,140);
      if(!id) return secureJson({error:'id mapping wajib diisi'},422,request,env,METHODS);
      const current=await d1First(env.DB,`SELECT * FROM payment_provider_accounts
        WHERE id=? AND org_id=? AND provider='E2PAY' AND account_scope='SUB_ACCOUNT' LIMIT 1`,[id,organizationId]);
      if(!current) return secureJson({error:'Mapping sub-account tidak ditemukan'},404,request,env,METHODS);
      if(current.status!=='ACTIVE'||!current.provider_sub_account_id){
        return secureJson({error:'Sub-account harus ACTIVE dan sudah diprovisioning sebelum balance sync',code:'E2PAY_SUBACCOUNT_NOT_READY'},409,request,env,METHODS);
      }
      const runtimeEnv=await gatewayRuntimeEnv(env.DB,env,organizationId,current.environment);
      const auth=await e2payAuthorize(runtimeEnv);
      const account=await e2payMerchantAccount(runtimeEnv,auth.accessToken);
      const providerAccountId=clean(account?.accountId,200);
      if(!providerAccountId||providerAccountId!==clean(current.provider_sub_account_id,200)){
        return secureJson({
          error:'Credential E2Pay aktif tidak merepresentasikan sub-account yang dipilih. Balance tidak diubah.',
          code:'E2PAY_SUBACCOUNT_BALANCE_SOURCE_MISMATCH',
          providerAccountIdMasked:masked(providerAccountId),
          mappedSubAccountIdMasked:masked(current.provider_sub_account_id),
        },409,request,env,METHODS);
      }
      const balance=Number(account?.balance||0);
      await d1Batch(env.DB,[
        {statement:`UPDATE payment_provider_accounts SET provider_account_id=?,account_name=COALESCE(?,account_name),
          balance=?,available_balance=?,last_balance_sync_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
          updated_by=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND org_id=?`,
          bindings:[providerAccountId,clean(account?.accountName,200)||null,balance,balance,actor.email,id,organizationId]},
        audit(organizationId,actor,'E2PAY_SUBACCOUNT_BALANCE_SYNCED',id,
          `balance=${balance} · accountLast4=${providerAccountId.slice(-4)} · environment=${current.environment}`,requestId),
      ]);
      const row=await d1First(env.DB,`SELECT ppa.*,c.code AS client_code,c.name AS client_name
        FROM payment_provider_accounts ppa LEFT JOIN clients c ON c.id=ppa.client_id WHERE ppa.id=? LIMIT 1`,[id]);
      return secureJson({ok:true,account:publicRow(row,Number(body.requiredAmount||0)),correlationId:requestId},200,request,env,METHODS);
    }

    if(action==='UPSERT_SUBACCOUNT'){
      const clientId=clean(body.clientId,120);
      const environment=clean(body.environment||'UAT',40).toUpperCase();
      const status=clean(body.status||'DRAFT',40).toUpperCase();
      const providerAccountId=clean(body.providerAccountId,200)||null;
      const providerSubAccountId=clean(body.providerSubAccountId,200)||null;
      const accountName=clean(body.accountName,200)||null;

      if(!clientId) return secureJson({error:'clientId wajib diisi'},422,request,env,METHODS);
      if(!ENVIRONMENTS.includes(environment)) return secureJson({error:'Environment tidak valid'},422,request,env,METHODS);
      if(!STATUSES.includes(status)) return secureJson({error:'Status mapping tidak valid'},422,request,env,METHODS);
      if(status==='ACTIVE' && !providerSubAccountId){
        return secureJson({error:'providerSubAccountId wajib tersedia sebelum mapping diaktifkan',code:'E2PAY_SUBACCOUNT_ID_REQUIRED'},409,request,env,METHODS);
      }

      const client=await d1First(env.DB,'SELECT id,name,status FROM clients WHERE id=? AND org_id=? LIMIT 1',[clientId,organizationId]);
      if(!client) return secureJson({error:'Client tidak ditemukan'},404,request,env,METHODS);

      const existing=await d1First(env.DB,`SELECT * FROM payment_provider_accounts
        WHERE org_id=? AND client_id=? AND provider='E2PAY' AND environment=? AND account_scope='SUB_ACCOUNT' LIMIT 1`,
        [organizationId,clientId,environment]);
      const id=existing?.id || 'PPA-'+crypto.randomUUID();

      const operations=[];
      if(existing){
        operations.push({
          statement:`UPDATE payment_provider_accounts SET provider_account_id=?,provider_sub_account_id=?,account_name=?,status=?,updated_by=?,
            updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
            WHERE id=? AND org_id=?`,
          bindings:[providerAccountId,providerSubAccountId,accountName,status,actor.email,id,organizationId],
        });
      }else{
        operations.push({
          statement:`INSERT INTO payment_provider_accounts
            (id,org_id,client_id,provider,environment,account_scope,provider_account_id,provider_sub_account_id,account_name,currency,status,created_by,updated_by)
            VALUES(?,?,?,'E2PAY',?,'SUB_ACCOUNT',?,?,?,'IDR',?,?,?)`,
          bindings:[id,organizationId,clientId,environment,providerAccountId,providerSubAccountId,accountName,status,actor.email,actor.email],
        });
      }
      operations.push(audit(
        organizationId,actor,
        existing?'E2PAY_SUBACCOUNT_MAPPING_UPDATED':'E2PAY_SUBACCOUNT_MAPPING_CREATED',
        id,
        `clientId=${clientId} · environment=${environment} · status=${status} · subAccountLast4=${providerSubAccountId?providerSubAccountId.slice(-4):'pending'}`,
        requestId,
      ));
      await d1Batch(env.DB,operations);
      const row=await d1First(env.DB,`SELECT ppa.*,c.code AS client_code,c.name AS client_name
        FROM payment_provider_accounts ppa LEFT JOIN clients c ON c.id=ppa.client_id WHERE ppa.id=? LIMIT 1`,[id]);
      return secureJson({ok:true,account:publicRow(row),correlationId:requestId},existing?200:201,request,env,METHODS);
    }

    if(action==='SET_SUBACCOUNT_STATUS'){
      const id=clean(body.id,140);
      const status=clean(body.status,40).toUpperCase();
      if(!id || !STATUSES.includes(status)) return secureJson({error:'id/status tidak valid'},422,request,env,METHODS);
      const current=await d1First(env.DB,'SELECT * FROM payment_provider_accounts WHERE id=? AND org_id=? LIMIT 1',[id,organizationId]);
      if(!current) return secureJson({error:'Mapping tidak ditemukan'},404,request,env,METHODS);
      if(status==='ACTIVE' && !clean(current.provider_sub_account_id,200)){
        return secureJson({error:'Mapping tidak dapat diaktifkan sebelum providerSubAccountId tersedia',code:'E2PAY_SUBACCOUNT_ID_REQUIRED'},409,request,env,METHODS);
      }
      await d1Batch(env.DB,[
        {statement:`UPDATE payment_provider_accounts SET status=?,updated_by=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND org_id=?`,
          bindings:[status,actor.email,id,organizationId]},
        audit(organizationId,actor,'E2PAY_SUBACCOUNT_STATUS_CHANGED',id,`status=${status}`,requestId),
      ]);
      const row=await d1First(env.DB,`SELECT ppa.*,c.code AS client_code,c.name AS client_name
        FROM payment_provider_accounts ppa LEFT JOIN clients c ON c.id=ppa.client_id WHERE ppa.id=? LIMIT 1`,[id]);
      return secureJson({ok:true,account:publicRow(row),correlationId:requestId},200,request,env,METHODS);
    }

    return secureJson({error:'Action sub-account tidak dikenal'},422,request,env,METHODS);
  }catch(error){
    if(String(error?.message||'').includes('UNIQUE constraint failed')){
      return secureJson({error:'Sub-account provider sudah terhubung ke client lain',code:'E2PAY_SUBACCOUNT_DUPLICATE'},409,request,env,METHODS);
    }
    return secureJson(publicError(error,requestId),500,request,env,METHODS);
  }
}
