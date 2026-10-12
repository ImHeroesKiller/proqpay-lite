import { d1All, d1Batch, d1First, hasD1 } from './_d1.js';
import { authorize, enforceRateLimit, handlePreflight, secureJson } from './_security.js';
import { roleHasCapability } from '../../shared/authority-matrix.js';

const METHODS='GET, POST, OPTIONS';
function orgId(env,actor){return String(actor?.orgId||env.DEFAULT_ORG_ID||'ORG-OTSINDO');}
function clean(v,n=300){return String(v??'').trim().replace(/[\r\n\t]+/g,' ').slice(0,n);}
function audit(org,actor,action,detail,id){return {statement:`INSERT INTO audit_logs(id,org_id,username,role,action,detail,entity,entity_id) VALUES(?,?,?,?,?,?, 'legacy_compatibility',?)`,bindings:[`AUD-${crypto.randomUUID()}`,org,actor.email||actor.name||'system',actor.role,action,clean(detail,1000),id]};}
function safeRecord(row){let detail={};try{detail=JSON.parse(row.safe_detail_json||'{}');}catch{}return {id:row.id,resourceType:row.resource_type,resourceId:row.resource_id,classification:row.classification,status:row.compatibility_status,resolutionStrategy:row.resolution_strategy,detail,firstDetectedAt:row.first_detected_at,lastDetectedAt:row.last_detected_at,resolvedAt:row.resolved_at||null,resolvedBy:row.resolved_by||null};}

function upsertRecord({id,org,resourceType,resourceId,classification,status,strategy,detail,resolvedBy=null}){
  return {statement:`INSERT INTO legacy_compatibility_records(id,org_id,resource_type,resource_id,classification,compatibility_status,resolution_strategy,safe_detail_json,resolved_at,resolved_by)
    VALUES(?,?,?,?,?,?,?,?,CASE WHEN ?='RESOLVED' THEN strftime('%Y-%m-%dT%H:%M:%fZ','now') ELSE NULL END,?)
    -- Classification is a state transition for the same resource, not a new
    -- primary-key row. P5.7.9 used the resource-stable id but targeted the
    -- classification UNIQUE key, colliding on the existing PRIMARY KEY when
    -- LEGACY_MANUAL becomes HEALTHY (or gateway in-flight becomes terminal).
    ON CONFLICT(id) DO UPDATE SET
      classification=excluded.classification,
      compatibility_status=excluded.compatibility_status,resolution_strategy=excluded.resolution_strategy,safe_detail_json=excluded.safe_detail_json,
      last_detected_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),resolved_at=CASE WHEN excluded.compatibility_status='RESOLVED' THEN COALESCE(legacy_compatibility_records.resolved_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')) ELSE NULL END,
      resolved_by=CASE WHEN excluded.compatibility_status='RESOLVED' THEN COALESCE(excluded.resolved_by,legacy_compatibility_records.resolved_by) ELSE NULL END,
      updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')`,bindings:[id,org,resourceType,resourceId,classification,status,strategy,JSON.stringify(detail),status,resolvedBy]};
}

async function refreshAudit(database,org,actor){
  const ops=[];
  const providerRows=await d1All(database,`SELECT ppa.id,ppa.client_id,ppa.project_id,ppa.environment,ppa.status,ppa.provisioning_state,ppa.provider_sub_account_id,
      pps.state AS session_state,pps.credential_state,pps.credential_version
    FROM payment_provider_accounts ppa
    LEFT JOIN provider_provisioning_sessions pps ON pps.provider_account_registry_id=ppa.id
    WHERE ppa.org_id=? AND ppa.provider='E2PAY' AND ppa.account_scope='SUB_ACCOUNT' AND ppa.provider_sub_account_id IS NOT NULL`,[org]);
  for(const row of providerRows){
    const recovery=String(row.credential_state||'')==='LEGACY_MANUAL'||(!row.session_state&&row.status==='ACTIVE');
    const resolved=String(row.credential_state||'')==='HEALTHY'&&Number(row.credential_version||0)>0;
    if(!recovery&&!resolved) continue;
    ops.push(upsertRecord({id:`LCR-PROVIDER-${row.id}`,org,resourceType:'PROVIDER_ACCOUNT',resourceId:row.id,
      classification:recovery?'LEGACY_CREDENTIAL_RECOVERY_REQUIRED':'LEGACY_PROVIDER_SESSION_BACKFILLED',status:recovery?'RECOVERY_REQUIRED':'RESOLVED',
      strategy:recovery?'RECOVER_EXISTING_SUBACCOUNT_CREDENTIAL_ONCE_NO_RECREATE':'NO_ACTION_SERVICE_MANAGED_READY',resolvedBy:resolved?'P5.7.9':null,
      detail:{clientId:row.client_id,projectId:row.project_id||null,environment:row.environment,providerSubAccountLast4:String(row.provider_sub_account_id).slice(-4),provisioningState:row.provisioning_state,credentialState:row.credential_state||null}}));
  }

  const payments=await d1All(database,`SELECT pi.id,pi.client_id,pi.status,pi.expected_total,pi.provider,pi.provider_environment,pi.provider_sub_account_id,
      (SELECT COUNT(*) FROM disbursement_requests dr WHERE dr.org_id=pi.org_id AND dr.source_document_type='PAYMENT_INSTRUCTION' AND dr.source_document_id=pi.id AND dr.status NOT IN ('REJECTED','CANCELLED')) AS canonical_dr_count,
      (SELECT COUNT(*) FROM payment_gateway_transactions pgt WHERE pgt.payment_instruction_id=pi.id) AS gateway_count,
      (SELECT COUNT(*) FROM payment_gateway_transactions pgt WHERE pgt.payment_instruction_id=pi.id AND pgt.status IN ('CREATED','PENDING','PROCESSING')) AS active_gateway_count,
      (SELECT status FROM payment_gateway_transactions pgt WHERE pgt.payment_instruction_id=pi.id ORDER BY pgt.created_at DESC LIMIT 1) AS latest_gateway_status
    FROM payment_instructions pi WHERE pi.org_id=?`,[org]);
  for(const row of payments){
    if(Number(row.canonical_dr_count)>0){
      ops.push(upsertRecord({id:`LCR-PI-CANON-${row.id}`,org,resourceType:'PAYMENT_INSTRUCTION',resourceId:row.id,classification:'CANONICAL_DR_PRESENT',status:'RESOLVED',strategy:'NO_LEGACY_MIGRATION_REQUIRED',resolvedBy:'P5.7.9',detail:{clientId:row.client_id,piStatus:row.status,amount:Number(row.expected_total||0)}}));
      continue;
    }
    if(Number(row.gateway_count)>0){
      const inflight=Number(row.active_gateway_count)>0;
      ops.push(upsertRecord({id:`LCR-PI-LEGACY-${row.id}`,org,resourceType:'PAYMENT_INSTRUCTION',resourceId:row.id,classification:inflight?'LEGACY_FINANCIAL_IN_FLIGHT_RETAIN':'LEGACY_FINANCIAL_TERMINAL_READ_ONLY',status:inflight?'RETAIN_LEGACY':'RESOLVED',strategy:inflight?'FINISH_AND_RECONCILE_IN_LEGACY_PIPELINE_NO_CANONICAL_REEXECUTION':'READ_ONLY_AUDIT_HISTORY',resolvedBy:inflight?null:'P5.7.9',detail:{clientId:row.client_id,piStatus:row.status,gatewayStatus:row.latest_gateway_status,amount:Number(row.expected_total||0),provider:row.provider||null,providerSubAccountLast4:row.provider_sub_account_id?String(row.provider_sub_account_id).slice(-4):null}}));
      continue;
    }
    if(['PAYMENT_APPROVAL_PENDING','APPROVED_FOR_PAYMENT'].includes(String(row.status))){
      ops.push(upsertRecord({id:`LCR-PI-ELIGIBLE-${row.id}`,org,resourceType:'PAYMENT_INSTRUCTION',resourceId:row.id,classification:'CANONICAL_DR_ELIGIBLE',status:'CANONICAL_ELIGIBLE',strategy:'CREATE_CANONICAL_DR_FROM_EXISTING_PI_BEFORE_ANY_FINANCIAL_EXECUTION',detail:{clientId:row.client_id,piStatus:row.status,amount:Number(row.expected_total||0),provider:row.provider||null,providerEnvironment:row.provider_environment||null,providerSubAccountLast4:row.provider_sub_account_id?String(row.provider_sub_account_id).slice(-4):null}}));
    }
  }

  const gatewayRows=await d1All(database,`SELECT pgt.id,pgt.payment_instruction_id,pgt.client_id,pgt.provider,pgt.status,pgt.amount,pgt.provider_transaction_id,pgt.created_at
    FROM payment_gateway_transactions pgt WHERE pgt.org_id=?`,[org]);
  for(const row of gatewayRows){
    const inflight=['CREATED','PENDING','PROCESSING'].includes(String(row.status));
    ops.push(upsertRecord({id:`LCR-GW-${row.id}`,org,resourceType:'GATEWAY_TRANSACTION',resourceId:row.id,classification:inflight?'LEGACY_GATEWAY_IN_FLIGHT':'LEGACY_GATEWAY_TERMINAL',status:inflight?'RETAIN_LEGACY':'RESOLVED',strategy:inflight?'LEGACY_RECONCILIATION_ONLY_NO_CANONICAL_RETRY':'READ_ONLY_AUDIT_HISTORY',resolvedBy:inflight?null:'P5.7.9',detail:{paymentInstructionId:row.payment_instruction_id,clientId:row.client_id,provider:row.provider,status:row.status,amount:Number(row.amount||0),providerTransactionPresent:Boolean(row.provider_transaction_id)}}));
  }

  const orphanLimits=await d1All(database,`SELECT elu.id,elu.payment_instruction_id,elu.reserved_amount,elu.status,pi.status AS pi_status,
      (SELECT COUNT(*) FROM payment_gateway_transactions pgt WHERE pgt.payment_instruction_id=elu.payment_instruction_id AND pgt.status IN ('CREATED','PENDING','PROCESSING')) AS active_gateway_count
    FROM e2pay_disbursement_limit_usage elu
    JOIN payment_instructions pi ON pi.id=elu.payment_instruction_id
    WHERE elu.org_id=? AND elu.status='RESERVED'`,[org]);
  for(const row of orphanLimits){
    if(Number(row.active_gateway_count)>0) continue;
    const terminal=['COMPLETED','REJECTED','PAYMENT_EXCEPTION'].includes(String(row.pi_status));
    if(!terminal) continue;
    ops.push(upsertRecord({id:`LCR-LIMIT-${row.id}`,org,resourceType:'LIMIT_USAGE',resourceId:row.id,classification:'LEGACY_LIMIT_RESERVATION_REVIEW_REQUIRED',status:'RECOVERY_REQUIRED',strategy:'CONTROLLER_REVIEW_BEFORE_RELEASE_NO_AUTOMATIC_MUTATION',detail:{paymentInstructionId:row.payment_instruction_id,piStatus:row.pi_status,reservedAmount:Number(row.reserved_amount||0)}}));
  }

  const corporateRows=await d1All(database,`SELECT id,client_id,bank_code,account_number_last4,status,is_primary,verification_version,source_change_request_id FROM client_bank_accounts
    WHERE org_id=? AND status='VERIFIED' AND is_primary=1`,[org]);
  for(const row of corporateRows){
    const governed=Boolean(row.source_change_request_id)&&Number(row.verification_version||0)>0;
    ops.push(upsertRecord({id:`LCR-CBA-${row.id}`,org,resourceType:'CORPORATE_BENEFICIARY',resourceId:row.id,classification:governed?'CORPORATE_BENEFICIARY_GOVERNED':'LEGACY_CORPORATE_BENEFICIARY_REVIEW_REQUIRED',status:governed?'RESOLVED':'RECOVERY_REQUIRED',strategy:governed?'NO_ACTION_GOVERNED_PRIMARY':'REVERIFY_THROUGH_P5_7_7_MAKER_CHECKER',resolvedBy:governed?'P5.7.9':null,detail:{clientId:row.client_id,bankCode:row.bank_code,accountLast4:row.account_number_last4}}));
  }

  for(let i=0;i<ops.length;i+=50) await d1Batch(database,ops.slice(i,i+50));
  await d1Batch(database,[audit(org,actor,'LEGACY_COMPATIBILITY_AUDIT_REFRESHED',`recordsEvaluated=${ops.length}`,'P5.7.9')]);
  return ops.length;
}

export async function onRequest({request,env}){
  if(request.method==='OPTIONS') return handlePreflight(request,env,METHODS);
  if(!['GET','POST'].includes(request.method)) return secureJson({error:'Method not allowed'},405,request,env,METHODS);
  const authorization=await authorize(request,env,{mutating:request.method==='POST',methods:METHODS});
  if(authorization.response) return authorization.response;
  const limited=await enforceRateLimit(request,env,authorization.actor,'legacy-compatibility',METHODS);
  if(limited) return limited;
  if(!hasD1(env)) return secureJson({error:'Cloudflare D1 unavailable'},503,request,env,METHODS);
  const actor=authorization.actor; const org=orgId(env,actor);
  if(!roleHasCapability(actor.role,'integrations:manage')) return secureJson({error:'Legacy compatibility audit hanya untuk Super Admin',code:'LEGACY_COMPATIBILITY_PERMISSION_REQUIRED'},403,request,env,METHODS);

  if(request.method==='POST'){
    const body=await request.json().catch(()=>null);
    const action=String(body?.action||'REFRESH_AUDIT').toUpperCase();
    if(action!=='REFRESH_AUDIT') return secureJson({error:'Action tidak didukung'},422,request,env,METHODS);
    const evaluated=await refreshAudit(env.DB,org,actor);
    return secureJson({ok:true,evaluated},200,request,env,METHODS);
  }

  const rows=await d1All(env.DB,'SELECT * FROM legacy_compatibility_records WHERE org_id=? ORDER BY CASE compatibility_status WHEN \'RECOVERY_REQUIRED\' THEN 0 WHEN \'RETAIN_LEGACY\' THEN 1 WHEN \'CANONICAL_ELIGIBLE\' THEN 2 ELSE 3 END,last_detected_at DESC LIMIT 500',[org]);
  const summary=await d1All(env.DB,'SELECT compatibility_status AS status,resource_type AS resource_type,COUNT(*) AS count FROM legacy_compatibility_records WHERE org_id=? GROUP BY compatibility_status,resource_type ORDER BY compatibility_status,resource_type',[org]);
  return secureJson({ok:true,summary:summary.map(r=>({status:r.status,resourceType:r.resource_type,count:Number(r.count||0)})),records:rows.map(safeRecord)},200,request,env,METHODS);
}
