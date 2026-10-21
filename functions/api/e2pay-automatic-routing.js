import {d1First} from './_d1.js';
import {gatewayRuntimeEnv} from './payment-gateway-settings-store.js';
import {e2payReadiness,e2payExecutionContract} from './payment-gateway-e2pay.js';
import {sha256Hex} from './payment-instruction-core.js';
import {DISBURSEMENT_INTENTS,providerChannelKey,validateDisbursementIntent} from '../../shared/disbursement-contract.js';

// SSD B2B API Disbursement v1.1 §7.1/7.2: all three business intents use
// the same bank inquiry and transaction API. E2PAY_SDP is an internal audit
// label, NOT a provider-issued channel code or a request payload field.
export const E2PAY_AUTOMATIC_CONTRACT='SSD_B2B_1.1';
export const E2PAY_AUTOMATIC_INTENTS=Object.freeze(Object.values(DISBURSEMENT_INTENTS));

export async function automaticE2PayRoute(database,env,input={}){
  const intent=validateDisbursementIntent(input);
  if(!intent.ok)return {ok:false,code:intent.code};
  const organizationId=String(input.orgId||'');
  if(!organizationId)return {ok:false,code:'MASTER_ROUTING_ORGANIZATION_REQUIRED'};
  const runtime=await gatewayRuntimeEnv(database,env||{},organizationId);
  const environment=String(runtime.E2PAY_ENV||'UAT').toUpperCase();
  if(String(runtime.PAYMENT_GATEWAY_PROVIDER||'').toUpperCase()!=='E2PAY'
    || !['UAT','PRODUCTION'].includes(environment)
    || (input.environment&&String(input.environment).toUpperCase()!==environment))
    return {ok:false,code:'MASTER_ROUTING_ENVIRONMENT_MISMATCH'};
  const account=await d1First(database,`SELECT * FROM payment_provider_accounts
    WHERE org_id=? AND provider='E2PAY' AND environment=? AND account_scope='MASTER'
      AND status='ACTIVE' LIMIT 1`,[organizationId,environment]);
  if(!account || (input.registryId&&input.registryId!==account.id))return {ok:false,code:'MASTER_ROUTING_REGISTRY_MISMATCH'};
  const contract=e2payExecutionContract(runtime,{accountId:account.provider_account_id});
  if(!e2payReadiness(runtime).configured||!contract.valid||contract.sourceMode!=='MERCHANT_ACCOUNT'
    || contract.accountSrcMatchesMerchant!==true)
    return {ok:false,code:'MASTER_ROUTING_CONTRACT_NOT_READY'};
  const snapshot={
    routingMode:'AUTOMATIC',mappingId:null,provider:'E2PAY',environment,
    intentKey:providerChannelKey(intent),sourceDocumentType:intent.sourceDocumentType,
    providerAccountRegistryId:account.id,
    providerChannel:'E2PAY_SDP',contractVersion:E2PAY_AUTOMATIC_CONTRACT,
    inquiryPath:'/b2b/merchant/me/sdp/inquiry',transactionPath:'/b2b/merchant/me/sdp/transaction',
    sourceFingerprint:await sha256Hex(JSON.stringify([organizationId,account.id,runtime.E2PAY_ACCOUNT_SRC,runtime.E2PAY_SOURCE_ID])),
    metadata:{descriptionPrefix:intent.purpose},
  };
  return {ok:true,mapping:null,snapshot:{...snapshot,configHash:await sha256Hex(JSON.stringify(snapshot))}};
}

export async function validateAutomaticE2PaySnapshot(database,env,row,snapshot){
  if(row.provider!=='E2PAY'||row.provider_channel_mapping_id)
    return {ok:false,code:'PROVIDER_CHANNEL_SNAPSHOT_MISMATCH'};
  const route=await automaticE2PayRoute(database,env,{
    ...row,orgId:row.org_id,environment:row.provider_environment,registryId:row.provider_account_registry_id,
  });
  if(!route.ok)return route;
  for(const key of Object.keys(route.snapshot)){
    if(JSON.stringify(snapshot[key])!==JSON.stringify(route.snapshot[key]))return {ok:false,code:'PROVIDER_CHANNEL_SNAPSHOT_MISMATCH'};
  }
  return route;
}
