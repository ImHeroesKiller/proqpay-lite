import { d1All, d1First, d1Run, hasD1 } from './_d1.js';
import { authorize, enforceRateLimit, handlePreflight, secureJson } from './_security.js';

const METHODS='GET, POST, OPTIONS';
const STATUSES=new Set(['OPEN','ACKNOWLEDGED','INVESTIGATING','ESCALATED','RESOLVED','FALSE_POSITIVE']);

async function audit(database,orgId,actor,action,id,detail){
  await d1Run(database,`INSERT INTO audit_logs
    (id,org_id,username,role,action,detail,entity,entity_id,ip_hash,device_hash)
    VALUES(?,?,?,?,?,?,'fraud_incident',?,?,?)`,[
      `AUD-${crypto.randomUUID()}`,orgId,actor.email,actor.role,action,
      String(detail || '').slice(0,1500),id,actor.requestIpHash||null,actor.requestDeviceHash||null,
    ]);
}

export async function onRequest({request,env}){
  if(request.method==='OPTIONS') return handlePreflight(request,env,METHODS);
  if(!['GET','POST'].includes(request.method)) return secureJson({error:'Method not allowed'},405,request,env,METHODS);
  const authorization=await authorize(request,env,{roles:['SUPER_ADMIN'],mutating:request.method==='POST',methods:METHODS});
  if(authorization.response) return authorization.response;
  const actor=authorization.actor;
  const limited=await enforceRateLimit(request,env,actor,'security-incidents-admin',METHODS);
  if(limited) return limited;
  if(!hasD1(env)) return secureJson({error:'Cloudflare D1 unavailable'},503,request,env,METHODS);
  const orgId=String(actor.orgId||env.DEFAULT_ORG_ID||'ORG-OTSINDO');

  if(request.method==='GET'){
    const url=new URL(request.url);
    const requestedStatus=String(url.searchParams.get('status')||'').trim().toUpperCase();
    const status=STATUSES.has(requestedStatus)?requestedStatus:null;
    const limit=Math.min(Math.max(Number(url.searchParams.get('limit')||100),1),500);
    const incidents=status
      ? await d1All(env.DB,`SELECT * FROM fraud_incidents WHERE org_id=? AND status=? ORDER BY
          CASE severity WHEN 'CRITICAL' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'MEDIUM' THEN 3 ELSE 4 END,
          due_at,updated_at DESC LIMIT ?`,[orgId,status,limit])
      : await d1All(env.DB,`SELECT * FROM fraud_incidents WHERE org_id=? ORDER BY
          CASE WHEN status IN ('OPEN','ACKNOWLEDGED','INVESTIGATING','ESCALATED') THEN 0 ELSE 1 END,
          CASE severity WHEN 'CRITICAL' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'MEDIUM' THEN 3 ELSE 4 END,
          due_at,updated_at DESC LIMIT ?`,[orgId,limit]);
    const summary=await d1First(env.DB,`SELECT
      SUM(CASE WHEN status IN ('OPEN','ACKNOWLEDGED','INVESTIGATING','ESCALATED') THEN 1 ELSE 0 END) AS open_count,
      SUM(CASE WHEN status IN ('OPEN','ACKNOWLEDGED','INVESTIGATING','ESCALATED')
        AND due_at IS NOT NULL AND datetime(due_at)<datetime('now') THEN 1 ELSE 0 END) AS overdue_count,
      SUM(CASE WHEN status IN ('OPEN','ACKNOWLEDGED','INVESTIGATING','ESCALATED')
        AND severity='CRITICAL' THEN 1 ELSE 0 END) AS critical_count
      FROM fraud_incidents WHERE org_id=?`,[orgId]);
    return secureJson({ok:true,incidents,summary:summary||{open_count:0,overdue_count:0,critical_count:0}},200,request,env,METHODS);
  }

  let body={};
  try{body=await request.json();}catch{return secureJson({error:'Invalid JSON'},400,request,env,METHODS);}
  const id=String(body.id||'').trim();
  const action=String(body.action||'').trim().toUpperCase();
  if(!id) return secureJson({error:'id wajib diisi'},422,request,env,METHODS);
  const current=await d1First(env.DB,'SELECT * FROM fraud_incidents WHERE id=? AND org_id=? LIMIT 1',[id,orgId]);
  if(!current) return secureJson({error:'Fraud incident tidak ditemukan'},404,request,env,METHODS);
  const who=String(actor.email||actor.id||'system');

  if(action==='ACKNOWLEDGE'){
    await d1Run(env.DB,`UPDATE fraud_incidents SET status='ACKNOWLEDGED',acknowledged_by=?,acknowledged_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND org_id=?`,[who,id,orgId]);
  }else if(action==='INVESTIGATE'){
    await d1Run(env.DB,`UPDATE fraud_incidents SET status='INVESTIGATING',assigned_to=COALESCE(?,assigned_to),updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND org_id=?`,[String(body.assignedTo||'').trim()||null,id,orgId]);
  }else if(action==='ESCALATE'){
    await d1Run(env.DB,`UPDATE fraud_incidents SET status='ESCALATED',escalated_by=?,escalated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),assigned_to=COALESCE(?,assigned_to),updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND org_id=?`,[who,String(body.assignedTo||'').trim()||null,id,orgId]);
  }else if(action==='RESOLVE' || action==='FALSE_POSITIVE'){
    const resolution=String(body.resolution||'').trim().slice(0,2000);
    if(!resolution) return secureJson({error:'resolution wajib diisi'},422,request,env,METHODS);
    await d1Run(env.DB,`UPDATE fraud_incidents SET status=?,resolved_by=?,resolved_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),resolution=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND org_id=?`,[action==='FALSE_POSITIVE'?'FALSE_POSITIVE':'RESOLVED',who,resolution,id,orgId]);
  }else{
    return secureJson({error:'Action incident tidak didukung'},422,request,env,METHODS);
  }
  await audit(env.DB,orgId,actor,`FRAUD_INCIDENT_${action}`,id,JSON.stringify({from:current.status,assignedTo:body.assignedTo||null}));
  const incident=await d1First(env.DB,'SELECT * FROM fraud_incidents WHERE id=? AND org_id=? LIMIT 1',[id,orgId]);
  return secureJson({ok:true,incident},200,request,env,METHODS);
}
