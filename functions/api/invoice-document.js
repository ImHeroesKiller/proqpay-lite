import { d1First, hasD1 } from './_d1.js';
import { authorize, enforceRateLimit, handlePreflight, secureJson } from './_security.js';
import { ensureInvoiceDocument, recordInvoiceDelivery } from './invoice-document-service.js';

const METHODS='GET, OPTIONS';
const ROLES=['SUPER_ADMIN','PAYROLL_PROCESSOR','PAYROLL_CONTROLLER','CLIENT_USER'];
function orgId(env){return String(env.DEFAULT_ORG_ID||'ORG-OTSINDO');}
function validId(value){return /^[A-Za-z0-9._:-]{1,120}$/.test(String(value||''));}

export async function onRequest({request,env}) {
  if(request.method==='OPTIONS') return handlePreflight(request,env,METHODS);
  if(request.method!=='GET') return secureJson({error:'Method not allowed'},405,request,env,METHODS);
  const authorization=await authorize(request,env,{roles:ROLES,methods:METHODS});
  if(authorization.response) return authorization.response;
  const limited=await enforceRateLimit(request,env,authorization.actor,'invoice-document',METHODS);
  if(limited) return limited;
  if(!hasD1(env)) return secureJson({error:'Layanan invoice belum tersedia',code:'INVOICE_DATA_UNAVAILABLE'},503,request,env,METHODS);
  const invoiceId=new URL(request.url).searchParams.get('invoiceId');
  if(!validId(invoiceId)) return secureJson({error:'Invoice ID tidak valid'},422,request,env,METHODS);
  const organizationId=orgId(env);
  const scope=await d1First(env.DB,'SELECT client_id FROM invoices WHERE id=? AND org_id=? LIMIT 1',[invoiceId,organizationId]);
  if(!scope) return secureJson({error:'Invoice tidak ditemukan'},404,request,env,METHODS);
  if(authorization.actor.role==='CLIENT_USER' && !(authorization.actor.clientIds||[]).map(String).includes(String(scope.client_id))) {
    return secureJson({error:'Invoice tidak tersedia pada scope klien ini'},403,request,env,METHODS);
  }
  const result=await ensureInvoiceDocument(env.DB,env,organizationId,invoiceId);
  if(result.status!==200) return secureJson({error:result.error,code:result.code},result.status,request,env,METHODS);
  await recordInvoiceDelivery(env.DB,{
    organizationId,invoiceId,channel:'DOWNLOAD',status:'SUCCESS',pdfSha256:result.sha256,actor:authorization.actor.email,
  });
  return new Response(result.pdf,{status:200,headers:{
    'Content-Type':'application/pdf',
    'Content-Disposition':`attachment; filename="${result.filename}"`,
    'Cache-Control':'private, no-store',
    'X-Content-Type-Options':'nosniff',
    'X-Invoice-SHA256':result.sha256,
  }});
}
