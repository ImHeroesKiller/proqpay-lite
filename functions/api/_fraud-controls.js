import { d1All, d1First } from './_d1.js';
import { fraudValueHash } from './_security-context.js';

function activeSql() {
  return "status='ACTIVE' AND (expires_at IS NULL OR datetime(expires_at)>datetime('now'))";
}

async function blocked(database, organizationId, blockType, valueHash) {
  if (!valueHash) return null;
  return d1First(database, `SELECT id,block_type,reason,expires_at FROM fraud_blocklist
    WHERE org_id=? AND block_type=? AND value_hash=? AND ${activeSql()}
    ORDER BY created_at DESC LIMIT 1`, [organizationId, blockType, valueHash]);
}

export async function actorFraudDecision(database, organizationId, actor, env) {
  const candidates = [
    ['USER_ID', await fraudValueHash('USER_ID', actor?.id || '', env)],
    ['EMAIL', await fraudValueHash('EMAIL', actor?.email || '', env)],
    ['IP', actor?.requestIpHash || actor?.sessionIpHash || null],
    ['DEVICE', actor?.requestDeviceHash || actor?.sessionDeviceHash || null],
  ];
  for (const [type, hash] of candidates) {
    const row = await blocked(database, organizationId, type, hash);
    if (row) return {
      blocked:true,
      code:`FRAUD_BLOCK_${type}`,
      blockId:row.id,
      reason:row.reason,
      blockType:type,
    };
  }
  return { blocked:false, code:null };
}

export async function beneficiaryFraudDecision(database, organizationId, beneficiaries, env) {
  const rows = await d1All(database, `SELECT id,value_hash,reason,expires_at FROM fraud_blocklist
    WHERE org_id=? AND block_type='BANK_ACCOUNT' AND ${activeSql()}`, [organizationId]);
  if (!rows.length) return { blocked:false, matches:[] };
  const lookup = new Map(rows.map((row) => [String(row.value_hash), row]));
  const matches = [];
  for (const beneficiary of beneficiaries || []) {
    const hash = await fraudValueHash('BANK_ACCOUNT', beneficiary.accountNumber, env);
    const block = hash ? lookup.get(hash) : null;
    if (block) {
      matches.push({
        employeeId:beneficiary.employeeId || null,
        accountLast4:String(beneficiary.accountNumber || '').slice(-4),
        blockId:block.id,
        reason:block.reason,
      });
    }
  }
  return {
    blocked:matches.length > 0,
    code:matches.length ? 'FRAUD_BLOCK_BENEFICIARY_ACCOUNT' : null,
    matches,
  };
}

export async function paymentLimitDecision(database, organizationId, payment, { isNewExecution = true } = {}) {
  const configured = await d1First(database, `SELECT * FROM payment_security_limits WHERE org_id=? LIMIT 1`, [organizationId]);
  const limits = {
    maxSingleAmount:Number(configured?.max_single_amount || 10_000_000_000),
    maxDailyAmount:Number(configured?.max_daily_amount || 25_000_000_000),
    maxDailyExecutions:Number(configured?.max_daily_executions || 50),
    maxRecipients:Number(configured?.max_recipients || 5000),
    stepUpWindowSeconds:Number(configured?.step_up_window_seconds || 600),
  };
  const amount = Number(payment?.expected_total || 0);
  const recipients = Number(payment?.recipient_count || 0);
  const daily = await d1First(database, `SELECT
      COALESCE(SUM(amount),0) AS amount,
      COUNT(*) AS executions
    FROM payment_gateway_transactions
    WHERE org_id=?
      AND datetime(created_at)>=datetime('now','start of day')
      AND status IN ('CREATED','PENDING','PROCESSING','SUCCEEDED')`, [organizationId]);
  const dailyAmount = Number(daily?.amount || 0);
  const dailyExecutions = Number(daily?.executions || 0);
  const projectedAmount = dailyAmount + (isNewExecution ? amount : 0);
  const projectedExecutions = dailyExecutions + (isNewExecution ? 1 : 0);

  let code = null;
  if (!Number.isSafeInteger(amount) || amount <= 0) code = 'PAYMENT_RISK_AMOUNT_INVALID';
  else if (amount > limits.maxSingleAmount) code = 'PAYMENT_LIMIT_SINGLE_EXCEEDED';
  else if (recipients > limits.maxRecipients) code = 'PAYMENT_LIMIT_RECIPIENTS_EXCEEDED';
  else if (projectedAmount > limits.maxDailyAmount) code = 'PAYMENT_LIMIT_DAILY_AMOUNT_EXCEEDED';
  else if (projectedExecutions > limits.maxDailyExecutions) code = 'PAYMENT_LIMIT_DAILY_COUNT_EXCEEDED';

  return {
    blocked:Boolean(code),
    code,
    amount,
    recipients,
    dailyAmount,
    dailyExecutions,
    projectedAmount,
    projectedExecutions,
    limits,
  };
}
