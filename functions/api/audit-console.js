import { authorize, enforceRateLimit, handlePreflight, publicError, secureJson } from './_security.js';
import { d1All, d1First, hasD1 } from './_d1.js';

const METHODS='GET, OPTIONS';
const ROLES=['SUPER_ADMIN'];
const orgId=(env,actor)=>String(env.DEFAULT_ORG_ID||actor?.orgId||'ORG-OTSINDO');

function normalizeDate(value){
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value||''))?String(value):'';
}
function clamp(value,min,max,fallback){
  const n=Number.parseInt(String(value||''),10);
  return Number.isFinite(n)?Math.min(max,Math.max(min,n)):fallback;
}

function cte(){
  return `
WITH unified AS (
  SELECT
    a.id AS id,
    a.timestamp AS timestamp,
    CASE
      WHEN a.action LIKE 'EWA_%' OR a.action LIKE 'EMPLOYEE_%' OR a.entity IN ('ewa_request','employee_credentials') THEN 'EMPLOYEE_SERVICES'
      WHEN a.action LIKE 'PAYMENT_%' OR a.action LIKE 'PI_%' OR a.entity LIKE '%payment%' THEN 'PAYMENTS'
      WHEN a.action LIKE 'BILLING_%' OR a.action LIKE 'INVOICE_%' OR a.action LIKE 'AR_%' OR a.entity LIKE '%invoice%' THEN 'BILLING_AR'
      WHEN a.action LIKE '%LOGIN%' OR a.action LIKE '%AUTH%' OR a.action LIKE '%PASSWORD%' OR a.action LIKE 'USER_%' THEN 'SECURITY'
      ELSE 'BUSINESS'
    END AS category,
    CASE
      WHEN a.action LIKE '%FAILED%' OR a.action LIKE '%REJECTED%' OR a.action LIKE '%ERROR%' THEN 'ERROR'
      WHEN a.action LIKE '%WARNING%' OR a.action LIKE '%BLOCKED%' THEN 'WARN'
      WHEN a.action LIKE '%APPROVED%' OR a.action LIKE '%PAID%' OR a.action LIKE '%REPAID%' OR a.action LIKE '%SUCCESS%' THEN 'SUCCESS'
      ELSE 'INFO'
    END AS level,
    'AUDIT' AS source,
    a.action AS event,
    COALESCE(a.username,'SYSTEM') AS actor,
    COALESCE(a.role,'') AS role,
    COALESCE(a.entity,'') AS entity,
    COALESCE(a.entity_id,'') AS entity_id,
    COALESCE(a.detail,'') AS detail,
    '' AS status,
    '' AS ip,
    a.org_id AS org_id
  FROM audit_logs a

  UNION ALL

  SELECT
    p.id,
    p.created_at,
    'EMPLOYEE_SERVICES',
    CASE WHEN p.success=1 THEN 'SUCCESS' ELSE 'ERROR' END,
    'EMPLOYEE_PORTAL',
    'PORTAL_LOGIN',
    COALESCE(e.name,p.employee_id_input,'EMPLOYEE'),
    'EMPLOYEE',
    'employee_login',
    COALESCE(p.employee_id,p.employee_id_input,''),
    CASE WHEN p.success=1 THEN 'Login portal berhasil' ELSE COALESCE(p.reason,'Login portal gagal') END,
    CASE WHEN p.success=1 THEN 'SUCCESS' ELSE 'FAILED' END,
    COALESCE(p.ip,''),
    p.org_id
  FROM portal_login_attempts p
  LEFT JOIN employees e ON e.id=p.employee_id

  UNION ALL

  SELECT
    x.id,
    x.created_at,
    'INTEGRATIONS',
    CASE WHEN x.status_code>=500 THEN 'ERROR' WHEN x.status_code>=400 THEN 'WARN' ELSE 'SUCCESS' END,
    'API',
    x.event_type || ' ' || x.method,
    x.app_name,
    'CONNECTED_APP',
    'api_endpoint',
    x.endpoint,
    x.method || ' ' || x.endpoint || ' · HTTP ' || x.status_code || ' · ' || x.duration_ms || 'ms',
    CAST(x.status_code AS TEXT),
    '',
    x.org_id
  FROM api_endpoint_events x
)
`;
}

export async function onRequest({request,env}){
  if(request.method==='OPTIONS')return handlePreflight(request,env,METHODS);
  if(request.method!=='GET')return secureJson({error:'Method not allowed'},405,request,env,METHODS);
  const auth=await authorize(request,env,{roles:ROLES,methods:METHODS});
  if(auth.response)return auth.response;
  const limited=await enforceRateLimit(request,env,auth.actor,'audit-console',METHODS);
  if(limited)return limited;
  if(!hasD1(env))return secureJson({error:'Cloudflare D1 binding unavailable',code:'D1_REQUIRED'},503,request,env,METHODS);

  const params=new URL(request.url).searchParams;
  const organizationId=orgId(env,auth.actor);
  const q=String(params.get('q')||'').trim().slice(0,120);
  const category=String(params.get('category')||'').trim().toUpperCase();
  const level=String(params.get('level')||'').trim().toUpperCase();
  const from=normalizeDate(params.get('from'));
  const to=normalizeDate(params.get('to'));
  const offset=clamp(params.get('offset'),0,1_000_000,0);
  const limit=clamp(params.get('limit'),1,100,50);

  const clauses=['org_id=?'];
  const bindings=[organizationId];
  if(category){clauses.push('category=?');bindings.push(category);}
  if(level){clauses.push('level=?');bindings.push(level);}
  if(from){clauses.push('timestamp>=?');bindings.push(from+'T00:00:00');}
  if(to){clauses.push('timestamp<=?');bindings.push(to+'T23:59:59.999');}
  if(q){
    const like='%'+q.toLowerCase()+'%';
    clauses.push("(lower(COALESCE(event,'')) LIKE ? OR lower(COALESCE(actor,'')) LIKE ? OR lower(COALESCE(detail,'')) LIKE ? OR lower(COALESCE(entity_id,'')) LIKE ? OR lower(COALESCE(source,'')) LIKE ?)");
    bindings.push(like,like,like,like,like);
  }
  const where=clauses.join(' AND ');

  try{
    const [rows,count,summary,apps]=await Promise.all([
      d1All(env.DB,cte()+`SELECT id,timestamp,category,level,source,event,actor,role,entity,entity_id,detail,status,ip FROM unified WHERE ${where} ORDER BY timestamp DESC,id DESC LIMIT ? OFFSET ?`,[...bindings,limit,offset]),
      d1First(env.DB,cte()+`SELECT COUNT(*) AS total FROM unified WHERE ${where}`,bindings),
      d1First(env.DB,cte()+`SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN level='ERROR' THEN 1 ELSE 0 END) AS errors,
        SUM(CASE WHEN level='WARN' THEN 1 ELSE 0 END) AS warnings,
        SUM(CASE WHEN timestamp>=datetime('now','-24 hours') THEN 1 ELSE 0 END) AS events_24h,
        SUM(CASE WHEN category='EMPLOYEE_SERVICES' AND level='ERROR' AND timestamp>=datetime('now','-24 hours') THEN 1 ELSE 0 END) AS employee_errors_24h,
        MAX(timestamp) AS last_activity_at
        FROM unified WHERE org_id=?`,[organizationId]),
      d1First(env.DB,`SELECT
        COUNT(*) AS connected_apps,
        COALESCE(SUM(CASE WHEN last_status_code>=400 THEN 1 ELSE 0 END),0) AS apps_with_error
        FROM api_connected_apps WHERE org_id=?`,[organizationId]),
    ]);
    const total=Number(count?.total||0);
    return secureJson({
      ok:true,
      events:rows,
      page:{offset,limit,total,hasMore:offset+rows.length<total,nextOffset:offset+rows.length},
      summary:{
        total:Number(summary?.total||0),
        errors:Number(summary?.errors||0),
        warnings:Number(summary?.warnings||0),
        events24h:Number(summary?.events_24h||0),
        employeeErrors24h:Number(summary?.employee_errors_24h||0),
        connectedApps:Number(apps?.connected_apps||0),
        appsWithError:Number(apps?.apps_with_error||0),
        lastActivityAt:summary?.last_activity_at||null,
      },
      filters:{q,category,level,from,to},
    },200,request,env,METHODS);
  }catch(error){
    return secureJson({error:'Audit console failed',...publicError(error,crypto.randomUUID())},500,request,env,METHODS);
  }
}
