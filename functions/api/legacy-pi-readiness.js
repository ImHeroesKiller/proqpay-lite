import {d1All,d1First,hasD1} from './_d1.js';
import {authorize,enforceRateLimit,handlePreflight,secureJson} from './_security.js';
import {providerAccountCredentialState} from './payment-provider-account-credentials.js';
import {resolveProviderChannel} from './provider-channel-router.js';
import {readProviderFundingState} from './e2pay-disbursement-limit-core.js';

// P5.8.2 reads only. Never call a provider, bind credentials, modify a PI,
// create a DR, reserve limits, or infer historical payout from missing DB rows.
const METHODS='GET, OPTIONS';
const ROLES=['SUPER_ADMIN','PAYROLL_PROCESSOR','PAYROLL_CONTROLLER'];
const SOURCE_STATES=new Set(['PAYMENT_APPROVAL_PENDING','APPROVED_FOR_PAYMENT']);
const clean=(v,n=160)=>String(v??'').trim().replace(/[\r\n\t]/g,' ').slice(0,n);
const orgId=(env,actor)=>String(actor?.orgId||env.DEFAULT_ORG_ID||'ORG-OTSINDO');

async function inspectPi(db,org,pi,destinationMode){
  const issues=[];
  const status=clean(pi.status,60);
  if(!SOURCE_STATES.has(status))issues.push('PI_NOT_ELIGIBLE_STATUS');
  const [gateway,canonical,lines,approvals]=await Promise.all([
    d1First(db,'SELECT COUNT(*) AS n FROM payment_gateway_transactions WHERE org_id=? AND payment_instruction_id=?',[org,pi.id]),
    d1First(db,"SELECT COUNT(*) AS n FROM disbursement_requests WHERE org_id=? AND source_document_type='PAYMENT_INSTRUCTION' AND source_document_id=?",[org,pi.id]),
    d1First(db,`SELECT COUNT(*) AS n,COALESCE(SUM(amount),0) AS total,
      SUM(CASE WHEN account_ciphertext IS NULL OR account_ciphertext='' OR account_iv IS NULL OR account_iv='' OR account_last4 IS NULL OR account_last4='' OR line_hash IS NULL OR line_hash='' OR bank_code IS NULL OR bank_code='' THEN 1 ELSE 0 END) AS bad_snapshot
      FROM payment_instruction_lines WHERE payment_instruction_id=?`,[pi.id]),
    d1First(db,"SELECT COUNT(*) AS n FROM payment_approvals WHERE payment_instruction_id=? AND status='APPROVED' AND action_hash=?",[pi.id,pi.content_hash||'']),
  ]);
  if(Number(gateway?.n)>0)issues.push('LEGACY_GATEWAY_EXISTS_NO_REPLAY');
  if(Number(canonical?.n)>0)issues.push('CANONICAL_DR_ALREADY_EXISTS');
  const expected=Number(pi.expected_total||0);
  const snapshotValid=expected>0&&Number(lines?.n)===Number(pi.recipient_count||0)&&Number(lines?.total)===expected&&Number(lines?.bad_snapshot||0)===0;
  if(!snapshotValid)issues.push('PI_IMMUTABLE_SNAPSHOT_INVALID');
  if(!pi.content_hash||(status==='APPROVED_FOR_PAYMENT'&&!Number(approvals?.n)))issues.push('PI_APPROVAL_HASH_NOT_VERIFIED');
  const account=pi.provider_account_registry_id?await d1First(db,"SELECT * FROM payment_provider_accounts WHERE org_id=? AND id=? AND provider='E2PAY' AND account_scope='SUB_ACCOUNT' LIMIT 1",[org,pi.provider_account_registry_id]):null;
  const bound=Boolean(account&&account.status==='ACTIVE'&&account.provisioning_state==='PROVISIONED'&&account.provider_sub_account_id&&account.provider_sub_account_id===pi.provider_sub_account_id&&String(pi.provider||'').toUpperCase()==='E2PAY'&&account.environment===pi.provider_environment&&account.client_id===pi.client_id&&(!account.project_id||account.project_id===pi.project_id));
  if(!bound)issues.push('PI_PROVIDER_SNAPSHOT_NOT_BOUND');
  // Display scoped recovery target only when the same PI-bound account exists.
  const credential=Boolean(bound&&providerAccountCredentialState(account).ready);
  const session=account?await d1First(db,'SELECT credential_state,credential_version FROM provider_provisioning_sessions WHERE org_id=? AND provider_account_registry_id=? LIMIT 1',[org,account.id]):null;
  const credentialHealthy=credential&&session?.credential_state==='HEALTHY'&&Number(session?.credential_version||0)>0;
  if(session?.credential_state==='LEGACY_MANUAL')issues.push('LEGACY_CREDENTIAL_RECOVERY_REQUIRED');
  else if(!credential)issues.push('MERCHANT_CREDENTIAL_NOT_READY');
  else if(!credentialHealthy)issues.push('CREDENTIAL_HEALTH_RECHECK_REQUIRED');
  let beneficiaryReady=snapshotValid;
  if(destinationMode==='CLIENT_ACCOUNT'){
    const corporate=await d1First(db,`SELECT cba.id FROM client_bank_accounts cba
      JOIN client_bank_account_change_requests cr ON cr.id=cba.source_change_request_id
      WHERE cba.org_id=? AND cba.client_id=? AND cba.purpose='PAYROLL_SETTLEMENT'
      AND cba.status='VERIFIED' AND cba.is_primary=1 AND cba.verification_version>0
      AND cr.status='APPROVED' AND cr.client_id=cba.client_id AND cr.purpose=cba.purpose LIMIT 1`,[org,pi.client_id]);
    beneficiaryReady=Boolean(corporate&&snapshotValid);
    if(!corporate)issues.push('CORPORATE_BENEFICIARY_NOT_GOVERNED');
  }
  const canCreate=SOURCE_STATES.has(status)&&!Number(gateway?.n)&&!Number(canonical?.n)&&snapshotValid&&beneficiaryReady&&bound&&credentialHealthy&&!issues.includes('PI_APPROVAL_HASH_NOT_VERIFIED');
  let channel={ready:false,code:'CHANNEL_PENDING_PI_BINDING'};
  if(bound){
    const route=await resolveProviderChannel(db,{provider:'E2PAY',environment:account.environment,purpose:'PAYROLL',destinationMode,beneficiaryType:destinationMode==='CLIENT_ACCOUNT'?'CORPORATE':'EMPLOYEE'});
    channel={ready:route.ok,code:route.ok?'READY':route.code};
  }
  const funding=bound?await readProviderFundingState(db,org,account.id,expected,pi.id):null;
  const approvalReady=canCreate&&channel.ready&&Boolean(funding?.ready)&&status==='APPROVED_FOR_PAYMENT';
  return {
    id:pi.id,documentNo:pi.document_no||pi.id,clientId:pi.client_id,projectId:pi.project_id||null,
    payrollPeriod:pi.payroll_period||null,status,amount:expected,recipientCount:Number(pi.recipient_count||0),
    destinationMode,providerEnvironment:account?.environment||pi.provider_environment||null,
    providerAccountRegistryId:bound?account.id:null,providerSubAccountIdMasked:bound?'••••'+String(account.provider_sub_account_id).slice(-4):null,
    existingGatewayCount:Number(gateway?.n||0),existingDrCount:Number(canonical?.n||0),
    snapshotValid,beneficiaryReady,providerBound:bound,credentialReady:credentialHealthy,
    credentialRecoveryRequired:session?.credential_state==='LEGACY_MANUAL',
    channel,liquidity:{ready:Boolean(funding?.ready),state:funding?.state||'PROVIDER_NOT_BOUND',
      parentState:funding?.parent?.state||'NOT_MAPPED',subClientState:funding?.subClient?.state||'NOT_MAPPED',
      limitState:funding?.limit?.state||'NO_ACTIVE_LIMIT'},
    canCreateCanonicalDr:canCreate,readyForControllerApproval:approvalReady,
    executionAuthorized:false,providerHistoryVerified:false,
    blockingCodes:issues,
    nextAction:issues.includes('LEGACY_GATEWAY_EXISTS_NO_REPLAY')?'RECONCILE_LEGACY_NO_REPLAY'
      :issues.includes('CANONICAL_DR_ALREADY_EXISTS')?'OPEN_EXISTING_DR'
      :issues.includes('LEGACY_CREDENTIAL_RECOVERY_REQUIRED')?'RECOVER_EXISTING_CREDENTIAL'
      :!bound?'REVIEW_PI_PROVIDER_SNAPSHOT'
      :!canCreate?'REVIEW_PI_SNAPSHOT_AND_APPROVAL'
      :!channel.ready?'CONFIRM_PROVIDER_CHANNEL'
      :!funding?.ready?'SYNC_LIQUIDITY_AND_APPROVE_LIMIT'
      :status!=='APPROVED_FOR_PAYMENT'?'CONTROLLER_PI_APPROVAL_REQUIRED'
      :'PROCESSOR_CREATE_DR_WITH_EXPLICIT_CONFIRMATION',
  };
}

export async function onRequest({request,env}){
  if(request.method==='OPTIONS')return handlePreflight(request,env,METHODS);
  if(request.method!=='GET')return secureJson({error:'Readiness check is read-only',code:'P58_READINESS_READ_ONLY'},405,request,env,METHODS);
  const auth=await authorize(request,env,{roles:ROLES,methods:METHODS});
  if(auth.response)return auth.response;
  const limited=await enforceRateLimit(request,env,auth.actor,'legacy-pi-readiness',METHODS);
  if(limited)return limited;
  if(!hasD1(env))return secureJson({error:'D1 unavailable'},503,request,env,METHODS);
  const url=new URL(request.url);
  const id=clean(url.searchParams.get('id'));
  const clientId=clean(url.searchParams.get('clientId'));
  const destinationMode=clean(url.searchParams.get('destinationMode')||'DIRECT_EMPLOYEE',30).toUpperCase();
  if(!['DIRECT_EMPLOYEE','CLIENT_ACCOUNT'].includes(destinationMode))return secureJson({error:'Unsupported destination mode'},422,request,env,METHODS);
  const bindings=[orgId(env,auth.actor)];
  let where='pi.org_id=?';
  if(id){where+=' AND pi.id=?';bindings.push(id);}
  if(clientId){where+=' AND pi.client_id=?';bindings.push(clientId);}
  // Bounded read-only status overview. All payment mutations remain in existing
  // Controller-governed /api/disbursement-requests and E2Pay APIs.
  const rows=await d1All(env.DB,`SELECT pi.*,ps.project_id,ps.period AS payroll_period FROM payment_instructions pi
    JOIN payroll_submissions ps ON ps.id=pi.submission_id AND ps.org_id=pi.org_id
    WHERE ${where} ORDER BY pi.created_at DESC,pi.id DESC LIMIT 50`,bindings);
  const readiness=[];
  for(const pi of rows)readiness.push(await inspectPi(env.DB,bindings[0],pi,destinationMode));
  return secureJson({ok:true,mode:'READ_ONLY_PRECHECK',providerExecutionAttempted:false,
    destinationMode,records:readiness,totalReturned:readiness.length,
    disclaimer:'Snapshot readiness is not provider settlement confirmation, DR approval, or permission to transfer.'},200,request,env,METHODS);
}
