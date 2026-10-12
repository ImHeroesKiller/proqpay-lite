import {d1All,d1First,hasD1} from './_d1.js';
import {authorize,enforceRateLimit,handlePreflight,secureJson} from './_security.js';

// UAT data-only catalog: never mutates source, credential, DR, provider or balance.
const METHODS='GET, OPTIONS';
const ROLES=['SUPER_ADMIN','PAYROLL_PROCESSOR','PAYROLL_CONTROLLER'];
const text=(value,n=140)=>String(value??'').trim().slice(0,n);
export async function onRequest({request,env}){
 if(request.method==='OPTIONS')return handlePreflight(request,env,METHODS);
 if(request.method!=='GET')return secureJson({error:'Data-only cutover cannot execute or delete',code:'CUTOVER_NON_EXECUTABLE'},405,request,env,METHODS);
 const auth=await authorize(request,env,{roles:ROLES,methods:METHODS});
 if(auth.response)return auth.response;
 const rate=await enforceRateLimit(request,env,auth.actor,'legacy-data-cutover',METHODS);
 if(rate)return rate;
 if(!hasD1(env))return secureJson({error:'D1 unavailable'},503,request,env,METHODS);
 const org=String(auth.actor.orgId||env.DEFAULT_ORG_ID||'ORG-OTSINDO');
 const url=new URL(request.url);const clientId=text(url.searchParams.get('clientId'));
 const bindings=[org];let where='ldc.org_id=?';
 if(clientId){where+=' AND ldc.client_id=?';bindings.push(clientId);}
 const rows=await d1All(env.DB,`SELECT ldc.id,ldc.client_id,ldc.project_id,ldc.source_type,ldc.source_id,
   ldc.source_account_id,ldc.legacy_status,ldc.amount_idr,ldc.created_at,ppa.status AS account_status,
   ppa.provider_sub_account_id,pps.credential_state,
   (SELECT COUNT(*) FROM payment_instructions pi WHERE pi.org_id=ldc.org_id AND pi.provider_account_registry_id=ldc.source_account_id) AS linked_pi_count,
   (SELECT COUNT(*) FROM payment_gateway_transactions gt WHERE gt.org_id=ldc.org_id AND gt.payment_instruction_id IN
     (SELECT pi.id FROM payment_instructions pi WHERE pi.org_id=ldc.org_id AND pi.provider_account_registry_id=ldc.source_account_id)) AS linked_gateway_count,
   (SELECT COUNT(*) FROM disbursement_requests dr WHERE dr.org_id=ldc.org_id AND dr.provider_account_registry_id=ldc.source_account_id) AS linked_canonical_count
  FROM legacy_data_cutover_records ldc
  JOIN payment_provider_accounts ppa ON ppa.id=ldc.source_account_id AND ppa.org_id=ldc.org_id
  LEFT JOIN provider_provisioning_sessions pps ON pps.provider_account_registry_id=ppa.id AND pps.org_id=ppa.org_id
  WHERE ${where} ORDER BY ldc.created_at DESC,ldc.id DESC LIMIT 150`,bindings);
 const projected=rows.map(row=>({
  id:row.id,clientId:row.client_id,projectId:row.project_id||null,sourceType:row.source_type,
  sourceId:row.source_id,sourceAccountId:row.source_account_id,
  sourceAccountMasked:row.provider_sub_account_id?'••••'+String(row.provider_sub_account_id).slice(-4):null,
  legacyStatus:row.legacy_status,amountIdr:Number(row.amount_idr||0),
  status:'DATA_ONLY',executionAllowed:false,originalRowsRetained:true,
  credentialState:row.credential_state||'NOT_CONNECTED',
  linkedPiCount:Number(row.linked_pi_count||0),linkedGatewayCount:Number(row.linked_gateway_count||0),
  linkedCanonicalCount:Number(row.linked_canonical_count||0),
  hardDeleteAllowed:false,cutoverAction:'PRESERVE_SOURCE_AND_USE_NEW_WORKSPACE',
 }));
 const summary={accounts:projected.filter(r=>r.sourceType==='UAT_PROVIDER_ACCOUNT').length,
  instructions:projected.filter(r=>r.sourceType==='UAT_PAYMENT_INSTRUCTION').length,
  instructionTotalIdr:projected.filter(r=>r.sourceType==='UAT_PAYMENT_INSTRUCTION').reduce((s,r)=>s+r.amountIdr,0),
  records:projected.length};
 return secureJson({ok:true,environment:'UAT',mode:'DATA_ONLY_NON_EXECUTABLE',summary,records:projected,
  reset:{eligible:false,reason:'FULL_HARD_DELETE_UNSAFE_WHILE_SOURCE_PI_OR_AUDIT_DEPENDS_ON_UAT_PROVIDER_ACCOUNT',requires:'VERIFIED_BACKUP_AND_EXPLICIT_SCOPED_PURGE_PLAN'},
  providerDisbursementEnabled:false,credentialRequiredToView:false},200,request,env,METHODS);
}
