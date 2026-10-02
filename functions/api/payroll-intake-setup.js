import { d1All, hasD1 } from './_d1.js';
import { authorize, clientIdsFor, projectIdsFor, enforceRateLimit, handlePreflight, secureJson } from './_security.js';

const METHODS='GET, OPTIONS';
const ROLES=['SUPER_ADMIN','PAYROLL_PROCESSOR','CLIENT_USER'];

export async function onRequest({request,env}){
  if(request.method==='OPTIONS') return handlePreflight(request,env,METHODS);
  if(request.method!=='GET') return secureJson({error:'GET only'},405,request,env,METHODS);
  const authorization=await authorize(request,env,{roles:ROLES,mutating:false,methods:METHODS});
  if(authorization.response) return authorization.response;
  const limited=await enforceRateLimit(request,env,authorization.actor,'payroll-intake-setup',METHODS); if(limited) return limited;
  if(!hasD1(env)) return secureJson({error:'Cloudflare D1 binding unavailable',code:'D1_REQUIRED'},503,request,env,METHODS);
  const orgId=String(env.DEFAULT_ORG_ID||'ORG-OTSINDO');
  const actor=authorization.actor;
  const clientScope=actor.role==='CLIENT_USER'?(clientIdsFor(actor,env)||[]):null;
  const projectScope=actor.role==='CLIENT_USER'?(projectIdsFor(actor)||[]):null;
  if(actor.role==='CLIENT_USER'&&!clientScope.length) return secureJson({ok:true,clients:[],projects:[],servicePlans:[]},200,request,env,METHODS);
  const clientClause=clientScope?`AND c.id IN (${clientScope.map(()=>'?').join(',')})`:'';
  const clientBindings=[orgId,...(clientScope||[])];
  const projectClause=projectScope?.length?`AND p.id IN (${projectScope.map(()=>'?').join(',')})`:'';
  const projectBindings=[orgId,...(clientScope||[]),...(projectScope||[])];
  const clientScopeSql=clientScope?`AND p.client_id IN (${clientScope.map(()=>'?').join(',')})`:'';
  const planScopeSql=clientScope?`AND sp.client_id IN (${clientScope.map(()=>'?').join(',')})`:'';
  const [clients,projects,servicePlans]=await Promise.all([
    d1All(env.DB,`SELECT c.id,c.code,c.name,c.status FROM clients c WHERE c.org_id=? ${clientClause} AND c.status='ACTIVE' ORDER BY c.name`,clientBindings),
    d1All(env.DB,`SELECT p.id,p.client_id,p.code,p.name,p.status FROM projects p WHERE p.org_id=? ${clientScopeSql} ${projectClause} AND p.status='ACTIVE' ORDER BY p.name`,projectBindings),
    d1All(env.DB,`SELECT sp.id,sp.client_id,sp.project_id,sp.tier,sp.effective_from,sp.effective_until FROM client_service_plans sp JOIN clients c ON c.id=sp.client_id WHERE c.org_id=? ${planScopeSql} AND sp.status='ACTIVE' ORDER BY sp.effective_from DESC`,[orgId,...(clientScope||[])]),
  ]);
  return secureJson({ok:true,clients,projects,servicePlans},200,request,env,METHODS);
}
