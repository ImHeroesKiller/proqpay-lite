import {hasD1} from './_d1.js';
import {authorize,enforceRateLimit,handlePreflight,secureJson} from './_security.js';
import {automaticE2PayRoute,E2PAY_AUTOMATIC_INTENTS,E2PAY_AUTOMATIC_CONTRACT} from './e2pay-automatic-routing.js';
import {gatewayRuntimeEnv} from './payment-gateway-settings-store.js';
import {roleHasCapability} from '../../shared/authority-matrix.js';

const METHODS='GET, POST, OPTIONS';
export async function onRequest({request,env}){
  if(request.method==='OPTIONS')return handlePreflight(request,env,METHODS);
  if(!['GET','POST'].includes(request.method))return secureJson({error:'Method not allowed'},405,request,env,METHODS);
  const authorization=await authorize(request,env,{roles:['SUPER_ADMIN','PAYROLL_PROCESSOR','PAYROLL_CONTROLLER'],mutating:request.method==='POST',methods:METHODS});
  if(authorization.response)return authorization.response;
  const actor=authorization.actor;
  const limited=await enforceRateLimit(request,env,actor,'provider-channel-mappings',METHODS);
  if(limited)return limited;
  if(!hasD1(env))return secureJson({error:'Cloudflare D1 unavailable'},503,request,env,METHODS);
  if(request.method==='POST'){
    if(!roleHasCapability(actor.role,'integrations:manage'))return secureJson({error:'Permission required',code:'PROVIDER_CHANNEL_MANAGE_PERMISSION_REQUIRED'},403,request,env,METHODS);
    // Do not create confirmation evidence or silently rewrite historical routing.
    return secureJson({error:'Jalur E2Pay ditentukan otomatis dari konfigurasi Master. Pengisian channel manual tidak digunakan.',code:'E2PAY_AUTOMATIC_ROUTING'},410,request,env,METHODS);
  }
  if(!actor.permissions?.includes('read'))return secureJson({error:'Read permission required'},403,request,env,METHODS);
  const orgId=String(actor.orgId||env.DEFAULT_ORG_ID||'ORG-OTSINDO');
  try{
    const runtime=await gatewayRuntimeEnv(env.DB,env,orgId);
    const environment=String(runtime.E2PAY_ENV||'UAT').toUpperCase();
    const routes=await Promise.all(E2PAY_AUTOMATIC_INTENTS.map(async intent=>{
      const route=await automaticE2PayRoute(env.DB,env,{...intent,orgId,environment});
      return {...intent,ready:route.ok,reason:route.ok?null:route.code};
    }));
    return secureJson({ok:true,routingMode:'AUTOMATIC',environment,contractVersion:E2PAY_AUTOMATIC_CONTRACT,routes},200,request,env,METHODS);
  }catch{
    return secureJson({error:'Konfigurasi Master belum dapat diverifikasi',code:'MASTER_ROUTING_UNAVAILABLE'},503,request,env,METHODS);
  }
}
