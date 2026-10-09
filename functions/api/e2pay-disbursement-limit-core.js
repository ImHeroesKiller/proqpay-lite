import { d1First, d1Run } from './_d1.js';
import { liquidityState, PROVIDER_BALANCE_MAX_AGE_MS } from './payment-provider-routing.js';

export const PARENT_BALANCE_MAX_AGE_MS=5*60*1000;

function ageMs(value,nowMs=Date.now()){
  const valueMs=new Date(value||0).getTime();
  return Number.isFinite(valueMs)?nowMs-valueMs:Number.POSITIVE_INFINITY;
}

export async function readProviderFundingState(database,organizationId,providerAccountRegistryId,requiredAmount=0,paymentInstructionId=null,nowMs=Date.now()){
  const required=Math.max(0,Number(requiredAmount||0));
  const account=await d1First(database,`SELECT * FROM payment_provider_accounts
    WHERE id=? AND org_id=? AND provider='E2PAY' LIMIT 1`,[providerAccountRegistryId,organizationId]);
  if(!account){
    return {
      ready:false,state:'SUBCLIENT_NOT_MAPPED',requiredAmount:required,
      parent:{ready:false,state:'NOT_MAPPED',balance:null,refreshedAt:null},
      subClient:{ready:false,state:'NOT_MAPPED',availableBalance:null,checkedAt:null},
      limit:{ready:false,state:'NO_ACTIVE_LIMIT',approvedAmount:0,committedAmount:0,remainingAmount:0,currentCommittedAmount:0},
    };
  }

  const parent=await d1First(database,`SELECT * FROM payment_gateway_provider_snapshots
    WHERE org_id=? AND provider='E2PAY' AND environment=? LIMIT 1`,[organizationId,account.environment]);
  const parentAge=parent?ageMs(parent.refreshed_at,nowMs):Number.POSITIVE_INFINITY;
  const parentBalance=parent?Number(parent.balance||0):null;
  const parentState=!parent?'NOT_SYNCED'
    : parentAge<0||parentAge>PARENT_BALANCE_MAX_AGE_MS?'STALE'
      :'READY';

  const subLiquidity=liquidityState(account,required,nowMs,PROVIDER_BALANCE_MAX_AGE_MS);

  const activeLimit=await d1First(database,`SELECT * FROM e2pay_disbursement_limit_requests
    WHERE org_id=? AND provider_account_registry_id=? AND status='ACTIVE'
    ORDER BY approved_at DESC,created_at DESC LIMIT 1`,[organizationId,providerAccountRegistryId]);

  let committedAmount=0;
  let currentCommittedAmount=0;
  if(activeLimit){
    const usage=await d1First(database,`SELECT
      COALESCE(SUM(CASE WHEN status='CONSUMED' THEN consumed_amount WHEN status='RESERVED' THEN reserved_amount ELSE 0 END),0) AS committed_amount,
      COALESCE(SUM(CASE WHEN payment_instruction_id=? AND status IN ('RESERVED','CONSUMED')
        THEN CASE WHEN status='CONSUMED' THEN consumed_amount ELSE reserved_amount END ELSE 0 END),0) AS current_committed_amount
      FROM e2pay_disbursement_limit_usage WHERE limit_request_id=?`,
      [paymentInstructionId||'',activeLimit.id]);
    committedAmount=Number(usage?.committed_amount||0);
    currentCommittedAmount=Number(usage?.current_committed_amount||0);
  }

  const approvedAmount=Number(activeLimit?.approved_amount||0);
  const remainingAmount=Math.max(0,approvedAmount-committedAmount);
  const capacityForPayment=remainingAmount+currentCommittedAmount;
  const limitExpired=Boolean(activeLimit?.expires_at && new Date(activeLimit.expires_at).getTime()<=nowMs);
  const limitState=!activeLimit?'NO_ACTIVE_LIMIT'
    : limitExpired?'LIMIT_EXPIRED'
      : capacityForPayment<required?'LIMIT_INSUFFICIENT'
        :'AVAILABLE';

  const executionReady=subLiquidity.ready&&limitState==='AVAILABLE';
  const state=!subLiquidity.ready
    ? 'SUBCLIENT_'+subLiquidity.state
    : limitState;

  return {
    ready:executionReady,
    state,
    requiredAmount:required,
    effectiveDisbursementCapacity:Math.max(0,Math.min(
      Number(subLiquidity.availableBalance||0),
      capacityForPayment,
    )),
    parent:{
      ready:parentState==='READY',
      state:parentState,
      balance:parentBalance,
      refreshedAt:parent?.refreshed_at||null,
      ageMs:Number.isFinite(parentAge)?parentAge:null,
    },
    subClient:{
      ready:subLiquidity.ready,
      state:subLiquidity.state,
      availableBalance:subLiquidity.availableBalance,
      checkedAt:account.last_balance_sync_at||null,
      ageMs:subLiquidity.ageMs??null,
      accountId:account.id,
      accountLast4:String(account.provider_sub_account_id||'').slice(-4)||null,
    },
    limit:{
      ready:limitState==='AVAILABLE',
      state:limitState,
      id:activeLimit?.id||null,
      approvedAmount,
      committedAmount,
      currentCommittedAmount,
      remainingAmount,
      capacityForPayment,
      expiresAt:activeLimit?.expires_at||null,
      approvedAt:activeLimit?.approved_at||null,
    },
    approvalCapacity:Math.max(0,Math.min(
      parentState==='READY'?Number(parentBalance||0):0,
      subLiquidity.state==='FUNDED'?Number(subLiquidity.availableBalance||0):0,
    )),
  };
}

export async function reserveDisbursementLimit(database,{organizationId,providerAccountRegistryId,paymentInstructionId,amount}){
  const required=Math.max(0,Number(amount||0));
  if(!required) return {ok:false,code:'E2PAY_LIMIT_AMOUNT_INVALID'};

  const existing=await d1First(database,`SELECT * FROM e2pay_disbursement_limit_usage
    WHERE payment_instruction_id=? LIMIT 1`,[paymentInstructionId]);
  if(existing){
    if(['RESERVED','CONSUMED'].includes(String(existing.status||''))){
      return {ok:true,idempotent:true,usage:existing};
    }
    return {ok:false,code:'E2PAY_LIMIT_USAGE_RELEASED'};
  }

  const active=await d1First(database,`SELECT * FROM e2pay_disbursement_limit_requests
    WHERE org_id=? AND provider_account_registry_id=? AND status='ACTIVE'
      AND (expires_at IS NULL OR julianday(expires_at)>julianday('now'))
    ORDER BY approved_at DESC,created_at DESC LIMIT 1`,
    [organizationId,providerAccountRegistryId]);
  if(!active) return {ok:false,code:'E2PAY_DISBURSEMENT_LIMIT_REQUIRED'};

  const id='DLU-'+crypto.randomUUID();
  const result=await d1Run(database,`INSERT INTO e2pay_disbursement_limit_usage
    (id,org_id,limit_request_id,provider_account_registry_id,payment_instruction_id,reserved_amount,status)
    SELECT ?,?,?,?,?,?,'RESERVED'
    WHERE (
      SELECT COALESCE(approved_amount,0) - COALESCE((
        SELECT SUM(CASE WHEN u.status='CONSUMED' THEN u.consumed_amount WHEN u.status='RESERVED' THEN u.reserved_amount ELSE 0 END)
        FROM e2pay_disbursement_limit_usage u
        WHERE u.limit_request_id=e2pay_disbursement_limit_requests.id AND u.status IN ('RESERVED','CONSUMED')
      ),0)
      FROM e2pay_disbursement_limit_requests
      WHERE id=? AND status='ACTIVE'
        AND (expires_at IS NULL OR julianday(expires_at)>julianday('now'))
    ) >= ?`,
    [id,organizationId,active.id,providerAccountRegistryId,paymentInstructionId,required,active.id,required]);

  if(Number(result?.meta?.changes||0)!==1){
    return {ok:false,code:'E2PAY_DISBURSEMENT_LIMIT_INSUFFICIENT'};
  }
  const usage=await d1First(database,'SELECT * FROM e2pay_disbursement_limit_usage WHERE id=?',[id]);
  return {ok:true,idempotent:false,usage,limit:active};
}

export async function consumeDisbursementLimit(database,paymentInstructionId,amount){
  const value=Math.max(0,Number(amount||0));
  await d1Run(database,`UPDATE e2pay_disbursement_limit_usage
    SET status='CONSUMED',consumed_amount=CASE WHEN ? > 0 THEN ? ELSE reserved_amount END,
      consumed_at=COALESCE(consumed_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
    WHERE payment_instruction_id=? AND status='RESERVED'`,[value,value,paymentInstructionId]);
  await d1Run(database,`UPDATE e2pay_disbursement_limit_requests
    SET status='EXHAUSTED',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
    WHERE id=(SELECT limit_request_id FROM e2pay_disbursement_limit_usage WHERE payment_instruction_id=? LIMIT 1)
      AND status='ACTIVE'
      AND COALESCE(approved_amount,0) <= COALESCE((
        SELECT SUM(CASE WHEN u.status='CONSUMED' THEN u.consumed_amount WHEN u.status='RESERVED' THEN u.reserved_amount ELSE 0 END)
        FROM e2pay_disbursement_limit_usage u
        WHERE u.limit_request_id=e2pay_disbursement_limit_requests.id AND u.status IN ('RESERVED','CONSUMED')
      ),0)`,[paymentInstructionId]);
}

export async function releaseDisbursementLimit(database,paymentInstructionId,reason='PAYMENT_NOT_EXECUTED'){
  await d1Run(database,`UPDATE e2pay_disbursement_limit_usage
    SET status='RELEASED',released_at=COALESCE(released_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      release_reason=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
    WHERE payment_instruction_id=? AND status='RESERVED'`,
    [String(reason||'PAYMENT_NOT_EXECUTED').slice(0,200),paymentInstructionId]);
}
