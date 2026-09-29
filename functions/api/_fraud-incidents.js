import { d1First, d1Run } from './_d1.js';

const OPEN_STATUSES = ['OPEN','ACKNOWLEDGED','INVESTIGATING','ESCALATED'];

function severityFor(ruleCode, explicit) {
  if (['CRITICAL','HIGH','MEDIUM','LOW'].includes(String(explicit || '').toUpperCase())) {
    return String(explicit).toUpperCase();
  }
  const code=String(ruleCode || '').toUpperCase();
  if (code.includes('BENEFICIARY') || code.includes('BANK_ACCOUNT')) return 'CRITICAL';
  if (code.includes('FRAUD_BLOCK') || code.includes('PAYMENT_LIMIT')) return 'HIGH';
  if (code.includes('LOGIN_LOCKOUT') || code.includes('MFA')) return 'MEDIUM';
  return 'LOW';
}

function dueMinutes(severity) {
  return ({CRITICAL:15,HIGH:60,MEDIUM:240,LOW:1440})[severity] || 1440;
}

export async function recordFraudIncident(database, input={}) {
  const orgId=String(input.orgId || '').trim();
  const source=String(input.source || 'SECURITY').trim().toUpperCase().slice(0,80);
  const ruleCode=String(input.ruleCode || 'SECURITY_EVENT').trim().toUpperCase().slice(0,120);
  if (!orgId) throw new Error('orgId is required');
  const entity=String(input.entity || 'security_event').trim().slice(0,80);
  const entityId=String(input.entityId || '').trim().slice(0,160) || null;
  const actorUserId=String(input.actorUserId || '').trim().slice(0,160) || null;
  const severity=severityFor(ruleCode,input.severity);
  const keyPart=entityId || actorUserId || 'GLOBAL';
  const incidentKey=String(input.incidentKey || `${source}:${ruleCode}:${keyPart}`).slice(0,320);
  const summary=String(input.summary || ruleCode).trim().slice(0,500);
  const metadata=JSON.stringify(input.metadata && typeof input.metadata === 'object' ? input.metadata : {});
  const existing=await d1First(database,`SELECT id,status,occurrence_count FROM fraud_incidents
    WHERE org_id=? AND incident_key=? AND status IN ('OPEN','ACKNOWLEDGED','INVESTIGATING','ESCALATED')
    ORDER BY created_at DESC LIMIT 1`,[orgId,incidentKey]);
  if(existing?.id){
    await d1Run(database,`UPDATE fraud_incidents SET
      occurrence_count=occurrence_count+1,
      last_seen_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
      metadata_json=?,
      updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE id=?`,[metadata,existing.id]);
    return {id:existing.id,created:false,status:existing.status,occurrenceCount:Number(existing.occurrence_count||1)+1};
  }
  const id=`FINC-${crypto.randomUUID()}`;
  await d1Run(database,`INSERT INTO fraud_incidents
    (id,org_id,incident_key,source,rule_code,severity,status,entity,entity_id,actor_user_id,
     actor_ip_hash,actor_device_hash,summary,metadata_json,due_at)
    VALUES(?,?,?,?,?,?,'OPEN',?,?,?,?,?,?,?,datetime('now',?))`,[
      id,orgId,incidentKey,source,ruleCode,severity,entity,entityId,actorUserId,
      input.actorIpHash || null,input.actorDeviceHash || null,summary,metadata,
      `+${dueMinutes(severity)} minutes`,
    ]);
  return {id,created:true,status:'OPEN',severity};
}

export function isFraudIncidentOpen(status){
  return OPEN_STATUSES.includes(String(status || '').toUpperCase());
}
