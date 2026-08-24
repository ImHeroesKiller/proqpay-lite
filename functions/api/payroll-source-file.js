import { d1First, hasD1 } from './_d1.js';
import { clientIdsFor, projectIdsFor, authorize, enforceRateLimit, handlePreflight, secureJson } from './_security.js';

const METHODS='GET, OPTIONS';
const ROLES=['SUPER_ADMIN','PAYROLL_PROCESSOR','PAYROLL_CONTROLLER','CLIENT_USER'];
function safeName(value){return String(value||'payroll-source.xlsx').replace(/[^a-zA-Z0-9._-]+/g,'_').slice(-120);}

export async function onRequest({request,env}){
  if(request.method==='OPTIONS')return handlePreflight(request,env,METHODS);
  if(request.method!=='GET')return secureJson({error:'GET only'},405,request,env,METHODS);
  const authorization=await authorize(request,env,{roles:ROLES,mutating:false,methods:METHODS});
  if(authorization.response)return authorization.response;
  const limited=await enforceRateLimit(request,env,authorization.actor,'payroll-source-file',METHODS);
  if(limited)return limited;
  if(!hasD1(env))return secureJson({error:'D1 required'},503,request,env,METHODS);
  const bucket=env.FILES;
  if(!bucket?.get)return secureJson({error:'R2 FILES required'},503,request,env,METHODS);
  const id=new URL(request.url).searchParams.get('id');
  if(!id)return secureJson({error:'Batch ID wajib diisi'},422,request,env,METHODS);
  const batch=await d1First(env.DB,`SELECT b.*,s.client_id,s.project_id FROM payroll_upload_batches b
    JOIN payroll_submissions s ON s.id=b.submission_id WHERE b.id=? AND b.org_id=? LIMIT 1`,[id,String(env.DEFAULT_ORG_ID||'ORG-OTSINDO')]);
  if(!batch)return secureJson({error:'Payroll source tidak ditemukan'},404,request,env,METHODS);
  if(authorization.actor.role==='CLIENT_USER'){
    const clients=clientIdsFor(authorization.actor,env)||[];
    const projects=projectIdsFor(authorization.actor)||[];
    if(!clients.includes(String(batch.client_id))||(projects.length&&!projects.includes(String(batch.project_id||'')))){
      return secureJson({error:'Scope denied'},403,request,env,METHODS);
    }
  }
  const object=await bucket.get(batch.r2_object_key);
  if(!object)return secureJson({error:'Source file tidak ditemukan di R2'},404,request,env,METHODS);
  const headers=new Headers({
    'Cache-Control':'private, no-store',
    'Content-Disposition':`attachment; filename="${safeName(batch.original_filename)}"`,
    'X-Content-Type-Options':'nosniff',
    'X-ProQPay-File-SHA256':String(batch.file_sha256||''),
    'X-ProQPay-Upload-Batch':String(batch.id),
  });
  object.writeHttpMetadata(headers);
  return new Response(object.body,{headers});
}
