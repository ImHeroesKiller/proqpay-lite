import { d1First } from './_d1.js';

export async function evaluateClientArGate(database, organizationId, clientId) {
  const client=await d1First(database,`SELECT id,name,ar_payment_block_mode,ar_warning_days
    FROM clients WHERE id=? AND org_id=? LIMIT 1`,[clientId,organizationId]);
  if (!client) return {state:'CLEAR',blocked:false,warning:false,mode:'OFF',outstanding:0,overdue:0,overdueCount:0,outstandingCount:0};

  const mode=String(client.ar_payment_block_mode||'OVERDUE');
  const warningDays=Math.max(0,Math.min(90,Number(client.ar_warning_days||7)));
  const summary=await d1First(database,`SELECT
      COALESCE(SUM(CASE WHEN balance>0 AND status<>'PAID' THEN balance ELSE 0 END),0) AS outstanding,
      COALESCE(SUM(CASE WHEN balance>0 AND status<>'PAID' AND date(due_date)<date('now') THEN balance ELSE 0 END),0) AS overdue,
      COALESCE(SUM(CASE WHEN balance>0 AND status<>'PAID' AND date(due_date)>=date('now') AND date(due_date)<=date('now','+'||?||' day') THEN balance ELSE 0 END),0) AS due_soon,
      COALESCE(SUM(CASE WHEN balance>0 AND status<>'PAID' THEN 1 ELSE 0 END),0) AS outstanding_count,
      COALESCE(SUM(CASE WHEN balance>0 AND status<>'PAID' AND date(due_date)<date('now') THEN 1 ELSE 0 END),0) AS overdue_count,
      MIN(CASE WHEN balance>0 AND status<>'PAID' THEN due_date END) AS oldest_due_date
    FROM ar_monitor WHERE org_id=? AND client_id=?`,[warningDays,organizationId,clientId]);

  const outstanding=Number(summary?.outstanding||0);
  const overdue=Number(summary?.overdue||0);
  const dueSoon=Number(summary?.due_soon||0);
  const blocked=mode==='ANY_OUTSTANDING' ? outstanding>0 : mode==='OVERDUE' ? overdue>0 : false;
  const warning=!blocked && dueSoon>0;
  return {
    state:blocked?'BLOCKED':warning?'WARNING':'CLEAR',
    blocked,
    warning,
    mode,
    warningDays,
    clientId,
    clientName:client.name,
    outstanding,
    overdue,
    dueSoon,
    outstandingCount:Number(summary?.outstanding_count||0),
    overdueCount:Number(summary?.overdue_count||0),
    oldestDueDate:summary?.oldest_due_date||null,
    code:blocked?'AR_OUTSTANDING_PAYMENT_BLOCKED':warning?'AR_OUTSTANDING_WARNING':null,
  };
}

export function arGateMessage(gate) {
  if (!gate?.blocked) return '';
  if (gate.mode==='ANY_OUTSTANDING') {
    return `Payment diblokir karena klien masih memiliki outstanding AR sebesar ${Math.round(gate.outstanding).toLocaleString('id-ID')}.`;
  }
  return `Payment diblokir karena klien memiliki overdue AR sebesar ${Math.round(gate.overdue).toLocaleString('id-ID')}.`;
}
