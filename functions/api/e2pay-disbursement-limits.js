import { authorize, enforceRateLimit, handlePreflight, publicError, secureJson } from './_security.js';
import { d1All, d1Batch, d1First, d1Run, hasD1 } from './_d1.js';
import { readProviderFundingState } from './e2pay-disbursement-limit-core.js';
import { providerAccountCredentialState } from './payment-provider-account-credentials.js';
import { credentialHealthState, legacyCredentialRecoveryState } from './e2pay-credential-lifecycle.js';
import { archivedUatFundingAccountIds } from './_uat-operational-funding.js';

const METHODS='GET, POST, OPTIONS';
const ROLES=['SUPER_ADMIN','PAYROLL_PROCESSOR','PAYROLL_CONTROLLER'];

function clean(value,max=500){ return String(value ?? '').trim().slice(0,max); }
function orgId(env,actor){ return String(actor?.orgId || env.DEFAULT_ORG_ID || 'ORG-OTSINDO'); }
function requestId(request){ return clean(request.headers.get('X-Request-Id')||request.headers.get('X-Correlation-Id')||crypto.randomUUID(),120); }
function audit(org,actor,action,entityId,detail,correlationId){
  return {
    statement:`INSERT INTO audit_logs(id,org_id,username,role,action,detail,entity,entity_id,correlation_id)
      VALUES(?,?,?,?,?,?,?,?,?)`,
    bindings:['AUD-'+crypto.randomUUID(),org,actor.email,actor.role,action,detail,'e2pay_disbursement_limit',entityId,correlationId],
  };
}

async function expireLimits(database,organizationId){
  await d1Run(database,`UPDATE e2pay_disbursement_limit_requests
    SET status='EXPIRED',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
    WHERE org_id=? AND status='ACTIVE' AND expires_at IS NOT NULL AND julianday(expires_at)<=julianday('now')`,
    [organizationId]);
}

async function accountFor(database,organizationId,id){
  return d1First(database,`SELECT ppa.*,c.code AS client_code,c.name AS client_name,p.code AS project_code,p.name AS project_name
    FROM payment_provider_accounts ppa
    LEFT JOIN clients c ON c.id=ppa.client_id
    LEFT JOIN projects p ON p.id=ppa.project_id
    WHERE ppa.id=? AND ppa.org_id=? AND ppa.provider='E2PAY' AND ppa.account_scope IN ('SUB_ACCOUNT','MASTER') LIMIT 1`,
    [id,organizationId]);
}

function assertFundingForLimit(state,amount){
  if(!state.parent.ready){
    return {status:409,code:'E2PAY_PARENT_BALANCE_'+state.parent.state,error:'Balance ProQPay parent belum fresh/siap untuk menentukan limit.'};
  }
  if(!state.subClient.ready){
    return {
      status:409,
      code:'E2PAY_SUBCLIENT_BALANCE_'+state.subClient.state,
      error:state.subClient.state==='INSUFFICIENT'
        ? 'Balance sub-client tidak mencukupi untuk limit yang diminta.'
        : 'Balance sub-client belum fresh/siap untuk menentukan limit.',
    };
  }
  if(Number(amount)>Number(state.approvalCapacity||0)){
    return {status:409,code:'E2PAY_LIMIT_EXCEEDS_FUNDING_CAPACITY',error:'Limit melebihi funding capacity yang tersedia.'};
  }
  return null;
}

export async function onRequest({request,env}){
  if(request.method==='OPTIONS') return handlePreflight(request,env,METHODS);
  if(!['GET','POST'].includes(request.method)) return secureJson({error:'Method not allowed'},405,request,env,METHODS);

  const authorization=await authorize(request,env,{roles:ROLES,mutating:request.method==='POST',methods:METHODS});
  if(authorization.response) return authorization.response;
  const limited=await enforceRateLimit(request,env,authorization.actor,'e2pay-disbursement-limits',METHODS);
  if(limited) return limited;
  if(!hasD1(env)) return secureJson({error:'Cloudflare D1 binding unavailable',code:'D1_REQUIRED'},503,request,env,METHODS);

  const actor=authorization.actor;
  const organizationId=orgId(env,actor);
  const correlationId=requestId(request);

  try{
    await expireLimits(env.DB,organizationId);

    if(request.method==='GET'){
      const url=new URL(request.url);
      const accountId=clean(url.searchParams.get('providerAccountRegistryId'),120);
      const requiredAmount=Math.max(0,Number(url.searchParams.get('requiredAmount')||0)||0);
      const operationalOnly=url.searchParams.get('operationalOnly')==='1';
      const archivedIds=operationalOnly?await archivedUatFundingAccountIds(env.DB,organizationId):new Set();

      const accounts=await d1All(env.DB,`SELECT ppa.*,c.code AS client_code,c.name AS client_name,p.code AS project_code,p.name AS project_name,
          pps.state AS provisioning_session_state,pps.credential_state AS provisioning_credential_state,
          pps.credential_version AS provisioning_credential_version,pps.credential_last_validated_at AS provisioning_credential_last_validated_at,
          pps.credential_failure_count AS provisioning_credential_failure_count,pps.credential_last_error_code AS provisioning_credential_last_error_code,
          pps.credential_last_error_at AS provisioning_credential_last_error_at
        FROM payment_provider_accounts ppa
        LEFT JOIN clients c ON c.id=ppa.client_id
        LEFT JOIN projects p ON p.id=ppa.project_id
        LEFT JOIN provider_provisioning_sessions pps ON pps.provider_account_registry_id=ppa.id
        WHERE ppa.org_id=? AND ppa.provider='E2PAY' AND ppa.account_scope IN ('SUB_ACCOUNT','MASTER')
          AND ppa.status='ACTIVE' AND (?='' OR ppa.id=?)
        ORDER BY c.name,p.name,ppa.created_at`,[organizationId,accountId,accountId]);

      const funding=[];
      for(const account of accounts){
        if(archivedIds.has(account.id))continue; // UAT-only archive, no live financial work
        const state=await readProviderFundingState(env.DB,organizationId,account.id,requiredAmount);
        const merchantCredential=account.account_scope==='MASTER' ? {ready:false,version:null,updatedAt:null,mode:'MASTER_GATEWAY_SETTINGS'} : providerAccountCredentialState(account);
        const provisioned=account.account_scope==='MASTER' ? account.status==='ACTIVE' : account.status==='ACTIVE'&&Boolean(account.provider_sub_account_id)&&String(account.provisioning_state||'PROVISIONED')==='PROVISIONED';
        funding.push({
          providerAccountRegistryId:account.id,
          clientId:account.client_id,
          clientCode:account.client_code,
          clientName:account.client_name,
          projectId:account.project_id||null,
          projectCode:account.project_code||null,
          projectName:account.project_name||null,
          environment:account.environment,
          providerSubAccountIdMasked:account.provider_sub_account_id?'••••'+String(account.provider_sub_account_id).slice(-4):null,
          provisioningState:String(account.provisioning_state||'NOT_STARTED'),
          merchantCredential,
          legacyCompatibility:legacyCredentialRecoveryState({credential_state:account.provisioning_credential_state},merchantCredential.ready),
          credentialHealth:credentialHealthState({
            credential_state:account.provisioning_credential_state,
            credential_version:account.provisioning_credential_version,
            credential_last_validated_at:account.provisioning_credential_last_validated_at,
            credential_failure_count:account.provisioning_credential_failure_count,
            credential_last_error_code:account.provisioning_credential_last_error_code,
            credential_last_error_at:account.provisioning_credential_last_error_at,
          }),
          accountReadiness:{
            ready:account.account_scope==='MASTER'?state.parent.ready:provisioned&&merchantCredential.ready,
            reason:account.account_scope==='MASTER'?(state.parent.ready?'MASTER_BALANCE_FRESH':'MASTER_BALANCE_NOT_READY'):!provisioned?'PROVISIONING_INCOMPLETE':!merchantCredential.ready&&String(account.provisioning_credential_state||'')==='LEGACY_MANUAL'?'LEGACY_CREDENTIAL_RECOVERY_REQUIRED':!merchantCredential.ready?'MERCHANT_CREDENTIAL_REQUIRED':'READY',
          },
          ...state,
        });
      }

      const requests=await d1All(env.DB,`SELECT dlr.*,c.code AS client_code,c.name AS client_name,p.code AS project_code,p.name AS project_name,
          (COALESCE((SELECT SUM(CASE WHEN u.status='CONSUMED' THEN u.consumed_amount WHEN u.status='RESERVED' THEN u.reserved_amount ELSE 0 END)
            FROM e2pay_disbursement_limit_usage u WHERE u.limit_request_id=dlr.id AND u.status IN ('RESERVED','CONSUMED')),0)
          +COALESCE((SELECT SUM(CASE WHEN u.status='CONSUMED' THEN u.consumed_amount WHEN u.status='RESERVED' THEN u.reserved_amount ELSE 0 END)
            FROM e2pay_disbursement_request_limit_usage u WHERE u.limit_request_id=dlr.id AND u.status IN ('RESERVED','CONSUMED')),0)) AS committed_amount
        FROM e2pay_disbursement_limit_requests dlr
        JOIN clients c ON c.id=dlr.client_id
        LEFT JOIN projects p ON p.id=dlr.project_id
        WHERE dlr.org_id=? AND (?='' OR dlr.provider_account_registry_id=?)
        ORDER BY CASE dlr.status WHEN 'PENDING_APPROVAL' THEN 0 WHEN 'ACTIVE' THEN 1 ELSE 2 END,dlr.updated_at DESC
        LIMIT 500`,[organizationId,accountId,accountId]);

      return secureJson({
        ok:true,
        funding,
        archivedUatAccountCount:archivedIds.size,
        requests:requests.filter(row=>!archivedIds.has(row.provider_account_registry_id)).map((row)=>({
          id:row.id,
          providerAccountRegistryId:row.provider_account_registry_id,
          clientId:row.client_id,
          clientCode:row.client_code,
          clientName:row.client_name,
          projectId:row.project_id||null,
          projectCode:row.project_code||null,
          projectName:row.project_name||null,
          environment:row.environment,
          requestedAmount:Number(row.requested_amount||0),
          approvedAmount:row.approved_amount===null?null:Number(row.approved_amount),
          committedAmount:Number(row.committed_amount||0),
          remainingAmount:Math.max(0,Number(row.approved_amount||0)-Number(row.committed_amount||0)),
          status:row.status,
          reason:row.reason||null,
          requestedByEmail:row.requested_by_email,
          requestedAt:row.requested_at,
          approvedByEmail:row.approved_by_email||null,
          approvedAt:row.approved_at||null,
          rejectedReason:row.rejected_reason||null,
          expiresAt:row.expires_at||null,
        })),
        authority:{
          canRequest:actor.role==='PAYROLL_PROCESSOR',
          canApprove:actor.role==='PAYROLL_CONTROLLER',
          canMonitor:ROLES.includes(actor.role),
        },
        correlationId,
      },200,request,env,METHODS);
    }

    const body=await request.json().catch(()=>({}));
    const action=clean(body.action,80).toUpperCase();

    if(action==='REQUEST_LIMIT'){
      if(actor.role!=='PAYROLL_PROCESSOR'){
        return secureJson({error:'Hanya Payroll Processor yang dapat mengajukan limit sub-client.',code:'E2PAY_LIMIT_PROCESSOR_REQUIRED'},403,request,env,METHODS);
      }
      const providerAccountRegistryId=clean(body.providerAccountRegistryId,120);
      const amount=Number(body.amount);
      const scopedClientId=clean(body.clientId,120);
      const scopedProjectId=clean(body.projectId,120)||null;
      const reason=clean(body.reason,500);
      const expiresAt=clean(body.expiresAt,80)||null;
      if(!providerAccountRegistryId||!Number.isSafeInteger(amount)||amount<=0) return secureJson({error:'providerAccountRegistryId dan amount wajib valid'},422,request,env,METHODS);
      if(expiresAt && (!Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt)<=Date.now())) return secureJson({error:'Masa berlaku limit harus berupa tanggal mendatang yang valid',code:'E2PAY_LIMIT_EXPIRY_INVALID'},422,request,env,METHODS);
      if(reason.length<5) return secureJson({error:'Alasan limit minimal 5 karakter'},422,request,env,METHODS);

      const account=await accountFor(env.DB,organizationId,providerAccountRegistryId);
      if(!account) return secureJson({error:'Akun E2Pay tidak ditemukan'},404,request,env,METHODS);
      const master=account.account_scope==='MASTER';
      if(master && !scopedClientId) return secureJson({error:'clientId wajib untuk alokasi Master',code:'MASTER_LIMIT_CLIENT_REQUIRED'},422,request,env,METHODS);
      const clientId=master?scopedClientId:account.client_id;
      const projectId=master?scopedProjectId:account.project_id||null;
      if(master){
        const client=await d1First(env.DB,'SELECT id FROM clients WHERE id=? AND org_id=?',[clientId,organizationId]);
        if(!client) return secureJson({error:'Client tidak ditemukan',code:'MASTER_LIMIT_CLIENT_INVALID'},404,request,env,METHODS);
        if(projectId){
          const project=await d1First(env.DB,'SELECT id FROM projects WHERE id=? AND org_id=? AND client_id=?',[projectId,organizationId,clientId]);
          if(!project) return secureJson({error:'Project tidak sesuai Client',code:'MASTER_LIMIT_PROJECT_INVALID'},422,request,env,METHODS);
        }
      }
      const duplicate=await d1First(env.DB,`SELECT id,status FROM e2pay_disbursement_limit_requests
        WHERE org_id=? AND provider_account_registry_id=? AND client_id=? AND (project_id IS ? OR project_id=?) AND status IN ('PENDING_APPROVAL','ACTIVE') LIMIT 1`,
        [organizationId,providerAccountRegistryId,clientId,projectId,projectId]);
      if(duplicate) return secureJson({
        error:duplicate.status==='ACTIVE'?'Sub-client masih memiliki limit aktif.':'Sudah ada request limit yang menunggu Controller.',
        code:duplicate.status==='ACTIVE'?'E2PAY_ACTIVE_LIMIT_EXISTS':'E2PAY_LIMIT_REQUEST_PENDING',
        limitRequestId:duplicate.id,
      },409,request,env,METHODS);

      const funding=await readProviderFundingState(env.DB,organizationId,providerAccountRegistryId,amount,null,Date.now(),null,clientId,projectId);
      const fundingError=assertFundingForLimit(funding,amount);
      if(fundingError) return secureJson({...fundingError,funding},fundingError.status,request,env,METHODS);

      const id='DLR-'+crypto.randomUUID();
      await d1Batch(env.DB,[
        {statement:`INSERT INTO e2pay_disbursement_limit_requests
          (id,org_id,provider_account_registry_id,client_id,project_id,environment,requested_amount,status,reason,
           requested_by_user_id,requested_by_email,expires_at)
          VALUES(?,?,?,?,?,?,?,'PENDING_APPROVAL',?,?,?,?)`,
          bindings:[id,organizationId,account.id,clientId,projectId,account.environment,amount,reason,actor.id||null,actor.email,expiresAt]},
        audit(organizationId,actor,'E2PAY_DISBURSEMENT_LIMIT_REQUESTED',id,
          `client=${clientId} · project=${projectId||'CLIENT'} · amount=${amount}`,correlationId),
      ]);
      const row=await d1First(env.DB,'SELECT * FROM e2pay_disbursement_limit_requests WHERE id=?',[id]);
      return secureJson({ok:true,request:row,funding,correlationId},201,request,env,METHODS);
    }

    if(action==='APPROVE_LIMIT'){
      if(actor.role!=='PAYROLL_CONTROLLER'){
        return secureJson({error:'Hanya Payroll Controller yang dapat menyetujui limit.',code:'E2PAY_LIMIT_CONTROLLER_REQUIRED'},403,request,env,METHODS);
      }
      const id=clean(body.id,120);
      const pending=await d1First(env.DB,`SELECT * FROM e2pay_disbursement_limit_requests
        WHERE id=? AND org_id=? AND status='PENDING_APPROVAL' LIMIT 1`,[id,organizationId]);
      if(!pending) return secureJson({error:'Request limit tidak ditemukan atau tidak lagi pending'},409,request,env,METHODS);
      if(String(pending.requested_by_user_id||'')===String(actor.id||'')){
        return secureJson({error:'Maker tidak boleh approve request limit yang dibuat sendiri',code:'E2PAY_LIMIT_MAKER_CHECKER_VIOLATION'},409,request,env,METHODS);
      }
      const active=await d1First(env.DB,`SELECT id FROM e2pay_disbursement_limit_requests
        WHERE org_id=? AND provider_account_registry_id=? AND client_id=?
          AND (project_id IS ? OR project_id=?) AND status='ACTIVE' LIMIT 1`,
        [organizationId,pending.provider_account_registry_id,pending.client_id,pending.project_id||null,pending.project_id||null]);
      if(active) return secureJson({error:'Sub-client masih memiliki limit aktif',code:'E2PAY_ACTIVE_LIMIT_EXISTS',limitRequestId:active.id},409,request,env,METHODS);

      const account=await accountFor(env.DB,organizationId,pending.provider_account_registry_id);
      if(!account || account.status!=='ACTIVE') return secureJson({error:'Provider account tidak ACTIVE',code:'MASTER_ACCOUNT_NOT_ACTIVE'},409,request,env,METHODS);
      const funding=await readProviderFundingState(env.DB,organizationId,pending.provider_account_registry_id,Number(pending.requested_amount),null,Date.now(),null,pending.client_id,pending.project_id||null);
      const fundingError=assertFundingForLimit(funding,Number(pending.requested_amount));
      if(fundingError) return secureJson({...fundingError,funding},fundingError.status,request,env,METHODS);

      if(account.account_scope==='MASTER'){
        // Single atomic, conditional D1 UPDATE guards cross-client capacity.
        // Allocation is held at APPROVAL, before any PI/DR reservation.
        const guarded=await d1Run(env.DB,`UPDATE e2pay_disbursement_limit_requests
          SET status='ACTIVE',approved_amount=requested_amount,approved_by_user_id=?,approved_by_email=?,
              approved_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
          WHERE id=? AND org_id=? AND status='PENDING_APPROVAL'
            AND EXISTS (
              SELECT 1 FROM payment_gateway_provider_snapshots s
              WHERE s.org_id=? AND s.provider='E2PAY' AND s.environment=?
                AND s.balance IS NOT NULL AND s.balance>=0
                AND (julianday('now')-julianday(s.refreshed_at))*86400000 BETWEEN 0 AND 300000
                AND s.balance >= (
                  SELECT COALESCE(SUM(CASE WHEN status='ACTIVE' THEN
                    MAX(0,COALESCE(approved_amount,0)-
                      COALESCE((SELECT SUM(CASE WHEN u.status='CONSUMED' THEN u.consumed_amount WHEN u.status='RESERVED' THEN 0 ELSE 0 END)
                        FROM e2pay_disbursement_limit_usage u WHERE u.limit_request_id=l.id AND u.status IN ('RESERVED','CONSUMED')),0)-
                      COALESCE((SELECT SUM(CASE WHEN d.status='CONSUMED' THEN d.consumed_amount WHEN d.status='RESERVED' THEN 0 ELSE 0 END)
                        FROM e2pay_disbursement_request_limit_usage d WHERE d.limit_request_id=l.id AND d.status IN ('RESERVED','CONSUMED')),0))
                    ELSE
                      COALESCE((SELECT SUM(u.reserved_amount) FROM e2pay_disbursement_limit_usage u WHERE u.limit_request_id=l.id AND u.status='RESERVED'),0)
                      +COALESCE((SELECT SUM(d.reserved_amount) FROM e2pay_disbursement_request_limit_usage d WHERE d.limit_request_id=l.id AND d.status='RESERVED'),0)
                    END),0)
                  FROM e2pay_disbursement_limit_requests l
                  WHERE l.org_id=? AND l.provider_account_registry_id=?
                ) + COALESCE((SELECT SUM(u.consumed_amount) FROM e2pay_disbursement_limit_usage u
                  WHERE u.org_id=s.org_id AND u.provider_account_registry_id=? AND u.status='CONSUMED'
                    AND julianday(u.consumed_at)>=julianday(s.refreshed_at)),0)
                + COALESCE((SELECT SUM(d.consumed_amount) FROM e2pay_disbursement_request_limit_usage d
                  WHERE d.org_id=s.org_id AND d.provider_account_registry_id=? AND d.status='CONSUMED'
                    AND julianday(d.consumed_at)>=julianday(s.refreshed_at)),0)
                + (SELECT requested_amount FROM e2pay_disbursement_limit_requests WHERE id=?)
            )`,
          [actor.id||null,actor.email,id,organizationId,organizationId,pending.environment,organizationId,pending.provider_account_registry_id,pending.provider_account_registry_id,pending.provider_account_registry_id,id]);
        if(Number(guarded?.meta?.changes||0)!==1)
          return secureJson({error:'Limit belum dapat disetujui. Saldo Master harus diperbarui dalam 5 menit terakhir dan mencukupi setelah dikurangi alokasi limit klien lain. Refresh Saldo Master, lalu kurangi nominal pengajuan atau tinjau alokasi aktif.',code:'MASTER_GLOBAL_CAPACITY_RECHECK_FAILED'},409,request,env,METHODS);
        await d1Batch(env.DB,[audit(organizationId,actor,'E2PAY_MASTER_LIMIT_APPROVED',id,
          `amount=${Number(pending.requested_amount)} · client=${pending.client_id}`,correlationId)]);
        return secureJson({ok:true,request:await d1First(env.DB,'SELECT * FROM e2pay_disbursement_limit_requests WHERE id=?',[id]),funding,correlationId},200,request,env,METHODS);
      }
      await d1Batch(env.DB,[
        {statement:`UPDATE e2pay_disbursement_limit_requests SET status='ACTIVE',approved_amount=requested_amount,
          approved_by_user_id=?,approved_by_email=?,approved_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
          updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
          WHERE id=? AND org_id=? AND status='PENDING_APPROVAL'`,
          bindings:[actor.id||null,actor.email,id,organizationId]},
        audit(organizationId,actor,'E2PAY_DISBURSEMENT_LIMIT_APPROVED',id,
          `amount=${Number(pending.requested_amount)} · account=${pending.provider_account_registry_id}`,correlationId),
      ]);
      const row=await d1First(env.DB,'SELECT * FROM e2pay_disbursement_limit_requests WHERE id=?',[id]);
      return secureJson({ok:true,request:row,funding,correlationId},200,request,env,METHODS);
    }

    if(action==='REJECT_LIMIT'){
      if(actor.role!=='PAYROLL_CONTROLLER'){
        return secureJson({error:'Hanya Payroll Controller yang dapat menolak limit.',code:'E2PAY_LIMIT_CONTROLLER_REQUIRED'},403,request,env,METHODS);
      }
      const id=clean(body.id,120);
      const reason=clean(body.reason,500);
      if(reason.length<10) return secureJson({error:'Alasan penolakan minimal 10 karakter'},422,request,env,METHODS);
      const pending=await d1First(env.DB,`SELECT * FROM e2pay_disbursement_limit_requests
        WHERE id=? AND org_id=? AND status='PENDING_APPROVAL' LIMIT 1`,[id,organizationId]);
      if(!pending) return secureJson({error:'Request limit tidak ditemukan atau tidak lagi pending'},409,request,env,METHODS);
      await d1Batch(env.DB,[
        {statement:`UPDATE e2pay_disbursement_limit_requests SET status='REJECTED',rejected_reason=?,
          approved_by_user_id=?,approved_by_email=?,approved_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
          updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND org_id=? AND status='PENDING_APPROVAL'`,
          bindings:[reason,actor.id||null,actor.email,id,organizationId]},
        audit(organizationId,actor,'E2PAY_DISBURSEMENT_LIMIT_REJECTED',id,reason,correlationId),
      ]);
      return secureJson({ok:true,id,status:'REJECTED',correlationId},200,request,env,METHODS);
    }

    if(action==='REVOKE_LIMIT'){
      if(actor.role!=='PAYROLL_CONTROLLER'){
        return secureJson({error:'Hanya Payroll Controller yang dapat revoke limit aktif.',code:'E2PAY_LIMIT_CONTROLLER_REQUIRED'},403,request,env,METHODS);
      }
      const id=clean(body.id,120);
      const reason=clean(body.reason,500);
      if(reason.length<10) return secureJson({error:'Alasan revoke minimal 10 karakter'},422,request,env,METHODS);
      const reserved=await d1First(env.DB,`SELECT COUNT(*) AS count FROM e2pay_disbursement_limit_usage
        WHERE limit_request_id=? AND status='RESERVED'`,[id]);
      if(Number(reserved?.count||0)>0){
        return secureJson({error:'Limit memiliki payment reservation aktif dan belum dapat direvoke.',code:'E2PAY_LIMIT_HAS_ACTIVE_RESERVATION'},409,request,env,METHODS);
      }
      const result=await d1Run(env.DB,`UPDATE e2pay_disbursement_limit_requests SET status='REVOKED',rejected_reason=?,
        updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND org_id=? AND status='ACTIVE'`,
        [reason,id,organizationId]);
      if(Number(result?.meta?.changes||0)!==1) return secureJson({error:'Limit aktif tidak ditemukan'},409,request,env,METHODS);
      await d1Batch(env.DB,[audit(organizationId,actor,'E2PAY_DISBURSEMENT_LIMIT_REVOKED',id,reason,correlationId)]);
      return secureJson({ok:true,id,status:'REVOKED',correlationId},200,request,env,METHODS);
    }

    return secureJson({error:'Action limit tidak dikenal'},422,request,env,METHODS);
  }catch(error){
    const detail=publicError(error,correlationId);
    return secureJson(detail,500,request,env,METHODS);
  }
}
