import { authorize, enforceRateLimit, handlePreflight, publicError, secureJson } from './_security.js';
import { d1All, d1First, hasD1 } from './_d1.js';
import { liquidityState } from './payment-provider-routing.js';

const METHODS='GET, OPTIONS';
const ROLES=['SUPER_ADMIN','PAYROLL_PROCESSOR','PAYROLL_CONTROLLER'];
const CANARY_SUBMISSION='SUB-E2PAY-UAT-CANARY-001';
const BATCH_SUBMISSION='SUB-E2PAY-UAT-FRESH-001';

function orgId(env,actor){ return String(actor?.orgId || env.DEFAULT_ORG_ID || 'ORG-OTSINDO'); }

function phaseFor({account,liquidity,pi,transaction,items}){
  if(!account) return 'WAITING_SUBACCOUNT';
  if(!liquidity?.ready) return 'WAITING_BALANCE';
  if(!pi) return 'READY_FOR_PI';
  if(pi.status==='PAYMENT_INSTRUCTION_READY') return 'READY_FOR_PI_SUBMIT';
  if(pi.status==='PAYMENT_APPROVAL_PENDING') return 'WAITING_CONTROLLER_APPROVAL';
  if(pi.status==='APPROVED_FOR_PAYMENT' && !transaction) return 'READY_FOR_CANARY_EXECUTION';
  if(['CREATED','PENDING','PROCESSING'].includes(String(transaction?.status||''))) {
    const unresolved=items.some((item)=>['PENDING','PROCESSING','UNKNOWN'].includes(String(item.status||'')));
    return unresolved ? 'RECONCILE_REQUIRED' : 'CANARY_PROCESSING';
  }
  if(transaction?.status==='FAILED') return 'FAILED_REVIEW';
  if(transaction?.status==='SUCCEEDED' && ['RECONCILIATION','COMPLETED'].includes(String(pi.status||''))){
    return pi.status==='COMPLETED' ? 'PASSED' : 'RECONCILE_REQUIRED';
  }
  if(transaction?.status==='SUCCEEDED') return 'RECONCILE_REQUIRED';
  return 'REVIEW_REQUIRED';
}

async function readLane(database,organizationId,submissionId){
  const submission=await d1First(database,`SELECT s.id,s.client_id,s.project_id,s.period,s.payment_period,s.state,
      c.name AS client_name,
      COALESCE((SELECT SUM(net_amount) FROM payroll_run_lines WHERE submission_id=s.id AND included=1),0) AS expected_total,
      COALESCE((SELECT COUNT(*) FROM payroll_run_lines WHERE submission_id=s.id AND included=1),0) AS recipient_count
    FROM payroll_submissions s JOIN clients c ON c.id=s.client_id
    WHERE s.id=? AND s.org_id=? LIMIT 1`,[submissionId,organizationId]);
  if(!submission) return null;

  const account=await d1First(database,`SELECT * FROM payment_provider_accounts
    WHERE org_id=? AND client_id=? AND provider='E2PAY' AND environment='UAT'
      AND account_scope='SUB_ACCOUNT' AND status='ACTIVE' LIMIT 1`,[organizationId,submission.client_id]);
  const liquidity=liquidityState(account,Number(submission.expected_total||0));

  const pi=await d1First(database,`SELECT id,document_no,status,expected_total,recipient_count,content_hash,
      provider_account_registry_id,provider_environment,provider_sub_account_id,created_at,updated_at
    FROM payment_instructions
    WHERE org_id=? AND submission_id=? AND status<>'REJECTED'
    ORDER BY updated_at DESC,created_at DESC LIMIT 1`,[organizationId,submissionId]);

  const transaction=pi ? await d1First(database,`SELECT id,status,provider_status,amount,error_code,error_message,
      provider_account_registry_id,provider_sub_account_last4,created_at,updated_at,paid_at
    FROM payment_gateway_transactions WHERE payment_instruction_id=?
    ORDER BY created_at DESC LIMIT 1`,[pi.id]) : null;

  const items=transaction ? await d1All(database,`SELECT status,attempt_count,response_code,error_code,last_checked_at
    FROM payment_gateway_items WHERE payment_gateway_transaction_id=? ORDER BY created_at,id`,[transaction.id]) : [];

  const phase=phaseFor({account,liquidity,pi,transaction,items});
  return {
    submission:{
      id:submission.id,
      clientId:submission.client_id,
      clientName:submission.client_name,
      period:submission.period,
      paymentPeriod:submission.payment_period||submission.period,
      state:submission.state,
      expectedTotal:Number(submission.expected_total||0),
      recipientCount:Number(submission.recipient_count||0),
    },
    subAccount:account ? {
      id:account.id,
      masked:'••••'+String(account.provider_sub_account_id||'').slice(-4),
      status:account.status,
      availableBalance:account.available_balance===null?null:Number(account.available_balance),
      lastBalanceSyncAt:account.last_balance_sync_at,
    } : null,
    liquidity,
    paymentInstruction:pi ? {
      id:pi.id,
      documentNo:pi.document_no,
      status:pi.status,
      expectedTotal:Number(pi.expected_total||0),
      recipientCount:Number(pi.recipient_count||0),
      contentHash:pi.content_hash,
      providerAccountRegistryId:pi.provider_account_registry_id,
      providerEnvironment:pi.provider_environment,
      providerSubAccountMasked:pi.provider_sub_account_id?'••••'+String(pi.provider_sub_account_id).slice(-4):null,
      createdAt:pi.created_at,
      updatedAt:pi.updated_at,
    } : null,
    transaction:transaction ? {
      id:transaction.id,
      status:transaction.status,
      providerStatus:transaction.provider_status,
      amount:Number(transaction.amount||0),
      errorCode:transaction.error_code,
      errorMessage:transaction.error_message,
      providerAccountRegistryId:transaction.provider_account_registry_id,
      providerSubAccountMasked:transaction.provider_sub_account_last4?'••••'+transaction.provider_sub_account_last4:null,
      createdAt:transaction.created_at,
      updatedAt:transaction.updated_at,
      paidAt:transaction.paid_at,
    } : null,
    itemSummary:{
      total:items.length,
      succeeded:items.filter((x)=>x.status==='SUCCEEDED').length,
      unresolved:items.filter((x)=>['PENDING','PROCESSING','UNKNOWN'].includes(String(x.status||''))).length,
      failed:items.filter((x)=>x.status==='FAILED').length,
      retryReady:items.filter((x)=>['RETRY_READY','RETRY_INQUIRY_READY'].includes(String(x.status||''))).length,
    },
    phase,
  };
}

export async function onRequest({request,env}){
  if(request.method==='OPTIONS') return handlePreflight(request,env,METHODS);
  if(request.method!=='GET') return secureJson({error:'Method not allowed'},405,request,env,METHODS);
  const authorization=await authorize(request,env,{roles:ROLES,methods:METHODS});
  if(authorization.response) return authorization.response;
  const limited=await enforceRateLimit(request,env,authorization.actor,'e2pay-uat-validation',METHODS);
  if(limited) return limited;
  if(!hasD1(env)) return secureJson({error:'Cloudflare D1 binding unavailable',code:'D1_REQUIRED'},503,request,env,METHODS);
  try{
    const organizationId=orgId(env,authorization.actor);
    const [canary,batch]=await Promise.all([
      readLane(env.DB,organizationId,CANARY_SUBMISSION),
      readLane(env.DB,organizationId,BATCH_SUBMISSION),
    ]);
    return secureJson({
      ok:true,
      provider:'E2PAY',
      environment:'UAT',
      authority:{
        financialExecutionRole:'PAYROLL_CONTROLLER',
        rawDisbursementDisabled:true,
        paymentControlOnly:true,
      },
      canary,
      batch,
      protocol:[
        'READINESS',
        'SINGLE_BENEFICIARY_CANARY',
        'IDEMPOTENCY_REPLAY',
        'FAILURE_AND_UNKNOWN_RECOVERY',
        'RECONCILIATION',
        'FIVE_BENEFICIARY_BATCH',
      ],
    },200,request,env,METHODS);
  }catch(error){
    return secureJson(publicError(error,crypto.randomUUID()),500,request,env,METHODS);
  }
}
