import {d1All} from './_d1.js';
import {evaluateClientArGate,arGateMessage} from './ar-payment-control.js';
import {activeProviderAccount} from './payment-provider-routing.js';
import {readProviderFundingState} from './e2pay-disbursement-limit-core.js';
import {gatewayRuntimeEnv} from './payment-gateway-settings-store.js';
import {e2payReadiness,e2payExecutionContract} from './payment-gateway-e2pay.js';

// Read-only projection of approved allocations. Master liquidity is shared, never
// copied into a separate client wallet or summed across the displayed clients.
export async function dashboardClientBalances(database,organizationId,env,clientId=null){
 const clients=await d1All(database,`SELECT id,name,status FROM clients WHERE org_id=?${clientId?' AND id=?':''} ORDER BY name,id`,clientId?[organizationId,clientId]:[organizationId]);
 if(!clients.length)return [];
 const runtime=await gatewayRuntimeEnv(database,env,organizationId);
 const environment=String(runtime.E2PAY_ENV||'UAT').toUpperCase();
 const account=await activeProviderAccount(database,organizationId,null,'E2PAY',environment);
 const configured=Boolean(String(runtime.PAYMENT_GATEWAY_PROVIDER).toUpperCase()==='E2PAY'&&account&&e2payReadiness(runtime).configured&&e2payExecutionContract(runtime,{accountId:account.provider_account_id}).valid);
 const rows=[];
 for(const client of clients){
  const ar=await evaluateClientArGate(database,organizationId,client.id);
  const reasons=[];const warnings=[];
  if(client.status!=='ACTIVE')reasons.push({code:'CLIENT_INACTIVE',message:'Klien tidak aktif.'});
  if(ar.blocked)reasons.push({code:ar.code,message:arGateMessage(ar)});
  else if(ar.warning)warnings.push('Ada invoice yang segera jatuh tempo.');
  let remainingLimit=0;let availableAmount=null;let checkedAt=null;
  if(!configured)reasons.push({code:'MASTER_NOT_READY',message:'Koneksi E2Pay Master belum siap.'});
  else{
   const limits=await d1All(database,`SELECT project_id FROM e2pay_disbursement_limit_requests WHERE org_id=? AND provider_account_registry_id=? AND client_id=? AND status='ACTIVE'`,[organizationId,account.id,client.id]);
   const scopes=limits.length?limits:[{project_id:null}];
   let parent=null;let activeCount=0;
   for(const scope of scopes){
    const funding=await readProviderFundingState(database,organizationId,account.id,0,null,Date.now(),null,client.id,scope.project_id);
    parent=funding.parent;
    if(funding.limit.ready){remainingLimit+=funding.limit.remainingAmount;activeCount++;}
   }
   checkedAt=parent?.refreshedAt||null;
   if(!activeCount)reasons.push({code:'NO_AVAILABLE_LIMIT',message:'Limit belum disetujui atau sudah kedaluwarsa.'});
   else if(remainingLimit<=0)reasons.push({code:'LIMIT_EXHAUSTED',message:'Alokasi limit sudah terpakai.'});
   if(!parent?.ready)reasons.push({code:'BALANCE_NOT_READY',message:'Saldo Master perlu diperbarui atau divalidasi.'});
   else{
    availableAmount=Math.max(0,Math.min(remainingLimit,Number(parent.balance||0)));
    if(Number(parent.balance)<=0)reasons.push({code:'MASTER_EMPTY',message:'Saldo Master belum mencukupi.'});
   }
  }
  if(reasons.length&&availableAmount!==null)availableAmount=0;
  rows.push({clientId:client.id,clientName:client.name,availableAmount,remainingLimit,checkedAt,blocked:reasons.length>0,reasons,warnings,environment});
 }
 return rows;
}
