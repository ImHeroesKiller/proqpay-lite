import { d1First } from './_d1.js';

export const PROVIDER_BALANCE_MAX_AGE_MS=5*60*1000;

export async function activeProviderAccount(database,organizationId,clientId,provider,environment){
  return d1First(database,`SELECT * FROM payment_provider_accounts
    WHERE org_id=? AND client_id=? AND provider=? AND environment=? AND account_scope='SUB_ACCOUNT' AND status='ACTIVE'
    LIMIT 1`,[organizationId,clientId,String(provider||'E2PAY').toUpperCase(),String(environment||'UAT').toUpperCase()]);
}

export function liquidityState(account,requiredAmount,nowMs=Date.now(),maxAgeMs=PROVIDER_BALANCE_MAX_AGE_MS){
  const required=Math.max(0,Number(requiredAmount||0));
  if(!account) return {state:'NOT_MAPPED',ready:false,requiredAmount,availableBalance:null,gap:required};
  if(String(account.status)!=='ACTIVE') return {state:'INACTIVE',ready:false,requiredAmount:required,availableBalance:null,gap:required};
  if(!account.provider_sub_account_id) return {state:'NOT_PROVISIONED',ready:false,requiredAmount:required,availableBalance:null,gap:required};
  if(account.available_balance===null||account.available_balance===undefined||!account.last_balance_sync_at){
    return {state:'NOT_SYNCED',ready:false,requiredAmount:required,availableBalance:null,gap:required};
  }
  const ageMs=nowMs-new Date(account.last_balance_sync_at).getTime();
  const available=Number(account.available_balance||0);
  if(!Number.isFinite(ageMs)||ageMs<0||ageMs>maxAgeMs){
    return {state:'STALE',ready:false,requiredAmount:required,availableBalance:available,gap:Math.max(0,required-available),ageMs};
  }
  if(available<required){
    return {state:'INSUFFICIENT',ready:false,requiredAmount:required,availableBalance:available,gap:required-available,ageMs};
  }
  return {state:'FUNDED',ready:true,requiredAmount:required,availableBalance:available,gap:0,ageMs};
}

export function providerSnapshot(account){
  if(!account) return null;
  return {
    registryId:account.id,
    provider:account.provider,
    environment:account.environment,
    clientId:account.client_id,
    subAccountLast4:String(account.provider_sub_account_id||'').slice(-4)||null,
    accountName:account.account_name||null,
    currency:account.currency||'IDR',
    capturedAt:new Date().toISOString(),
  };
}

export function validatePaymentProviderSnapshot(payment,account){
  if(!payment?.provider_account_registry_id||!payment?.provider_sub_account_id){
    return {ok:false,code:'PI_PROVIDER_SNAPSHOT_REQUIRED',error:'PI tidak memiliki immutable provider sub-account snapshot; regenerate PI diperlukan.'};
  }
  if(!account) return {ok:false,code:'PI_PROVIDER_ACCOUNT_NOT_ACTIVE',error:'Sub-account provider PI tidak lagi ACTIVE.'};
  if(String(payment.client_id)!==String(account.client_id)) return {ok:false,code:'PI_PROVIDER_CLIENT_MISMATCH',error:'Client PI tidak cocok dengan owner sub-account provider.'};
  if(String(payment.provider_account_registry_id)!==String(account.id)) return {ok:false,code:'PI_PROVIDER_REGISTRY_MISMATCH',error:'Registry sub-account PI berubah.'};
  if(String(payment.provider_sub_account_id)!==String(account.provider_sub_account_id)) return {ok:false,code:'PI_PROVIDER_SUBACCOUNT_MISMATCH',error:'Provider sub-account PI berubah setelah snapshot.'};
  if(String(payment.provider||'').toUpperCase()!==String(account.provider||'').toUpperCase()) return {ok:false,code:'PI_PROVIDER_MISMATCH',error:'Provider PI tidak cocok dengan registry.'};
  if(String(payment.provider_environment||'').toUpperCase()!==String(account.environment||'').toUpperCase()) return {ok:false,code:'PI_PROVIDER_ENVIRONMENT_MISMATCH',error:'Environment provider PI tidak cocok dengan registry.'};
  return {ok:true};
}
