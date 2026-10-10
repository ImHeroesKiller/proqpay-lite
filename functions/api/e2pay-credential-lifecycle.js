import { d1Run } from './_d1.js';

export function credentialHealthState(session){
  const state=String(session?.credential_state||'UNINITIALIZED');
  return {
    state,
    healthy:state==='HEALTHY',
    degraded:state==='DEGRADED',
    recoveryRequired:state==='RECOVERY_REQUIRED',
    version:Number(session?.credential_version||0),
    failureCount:Number(session?.credential_failure_count||0),
    lastValidatedAt:session?.credential_last_validated_at||null,
    lastErrorCode:session?.credential_last_error_code||null,
    lastErrorAt:session?.credential_last_error_at||null,
  };
}

export async function markCredentialHealthy(database,session,actorEmail){
  if(!session?.id) return;
  await d1Run(database,`UPDATE provider_provisioning_sessions
    SET credential_state='HEALTHY',credential_version=CASE WHEN credential_version<1 THEN 1 ELSE credential_version END,
        credential_last_validated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),credential_failure_count=0,
        credential_last_error_code=NULL,credential_last_error_at=NULL,updated_by=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
    WHERE id=?`,[actorEmail,session.id]);
}

export async function markCredentialFailure(database,session,actorEmail,errorCode){
  if(!session?.id) return;
  const failures=Number(session.credential_failure_count||0)+1;
  const next=failures>=3?'RECOVERY_REQUIRED':'DEGRADED';
  await d1Run(database,`UPDATE provider_provisioning_sessions
    SET credential_state=?,credential_failure_count=credential_failure_count+1,
        credential_last_error_code=?,credential_last_error_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
        updated_by=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`,
    [next,String(errorCode||'E2PAY_CREDENTIAL_HEALTH_FAILED').slice(0,120),actorEmail,session.id]);
}

export function manualCredentialBindingAllowed(session){
  if(!session) return true; // legacy account created before P5.7 durable provisioning
  return String(session.credential_mode||'').toUpperCase()!=='SERVICE_MANAGED';
}
