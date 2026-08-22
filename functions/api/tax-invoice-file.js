import { d1First, hasD1 } from './_d1.js';
import { authorize, enforceRateLimit, handlePreflight, publicError, secureJson } from './_security.js';
import { safeProofFilename, validatePaymentProofFile } from './payment-proof-validation.js';

const METHODS='GET, POST, OPTIONS';
const READ_ROLES=['SUPER_ADMIN','PAYROLL_PROCESSOR','PAYROLL_CONTROLLER','CLIENT_USER'];
const WRITE_ROLES=['SUPER_ADMIN','PAYROLL_CONTROLLER'];
const ID=/^[A-Za-z0-9._:-]{1,120}$/;
const NOW="strftime('%Y-%m-%dT%H:%M:%fZ','now')";
const orgId=(env)=>String(env.DEFAULT_ORG_ID||'ORG-OTSINDO');
const field=(form,name)=>String(form.get(name)||'').trim();

function canAccess(actor,clientId){
  return actor.role!=='CLIENT_USER'||new Set((actor.clientIds||[]).map(String)).has(String(clientId));
}

export async function onRequest({request,env}){
  if(request.method==='OPTIONS') return handlePreflight(request,env,METHODS);
  if(!['GET','POST'].includes(request.method)) return secureJson({error:'Method not allowed'},405,request,env,METHODS);
  const authorization=await authorize(request,env,{roles:request.method==='POST'?WRITE_ROLES:READ_ROLES,mutating:request.method==='POST',methods:METHODS});
  if(authorization.response) return authorization.response;
  const limited=await enforceRateLimit(request,env,authorization.actor,'tax-invoice-file',METHODS);
  if(limited) return limited;
  const respond=(data,status=200)=>secureJson(data,status,request,env,METHODS),requestId=crypto.randomUUID();
  if(!hasD1(env)) return respond({error:'Cloudflare D1 belum terhubung',requestId},503);
  const bucket=env.FILES||env.PAYMENT_PROOFS;
  if(!bucket?.put||!bucket?.get) return respond({error:'Penyimpanan dokumen belum terhubung',requestId},503);
  const database=env.DB,organizationId=orgId(env);
  try{
    if(request.method==='GET'){
      const invoiceId=new URL(request.url).searchParams.get('invoiceId')||'';
      if(!ID.test(invoiceId)) return respond({error:'ID invoice tidak valid'},400);
      const invoice=await d1First(database,'SELECT id,client_id FROM invoices WHERE id=? AND org_id=? LIMIT 1',[invoiceId,organizationId]);
      if(!invoice) return respond({error:'Invoice tidak ditemukan'},404);
      if(!canAccess(authorization.actor,invoice.client_id)) return respond({error:'Akun tidak memiliki akses ke invoice ini'},403);
      const audit=await d1First(database,`SELECT detail FROM audit_logs WHERE org_id=? AND entity='tax_invoice_file' AND entity_id=? AND action='TAX_INVOICE_FILE_UPLOADED' ORDER BY timestamp DESC LIMIT 1`,[organizationId,invoiceId]);
      if(!audit) return respond({error:'File faktur pajak belum tersedia'},404);
      const detail=JSON.parse(audit.detail||'{}'),object=await bucket.get(detail.objectKey);
      if(!object) return respond({error:'File faktur pajak tidak ditemukan di R2'},404);
      const headers=new Headers({'Cache-Control':'private, no-store','Content-Disposition':`attachment; filename="${safeProofFilename(detail.originalName||'faktur-pajak')}"`,'X-Content-Type-Options':'nosniff'});
      object.writeHttpMetadata(headers);
      return new Response(object.body,{headers});
    }
    const length=Number(request.headers.get('content-length')||0);
    if(length>6*1024*1024) return respond({error:'Ukuran file terlalu besar. Maksimal 5 MB.'},413);
    const form=await request.formData(),file=form.get('file'),invoiceId=field(form,'invoiceId');
    if(!ID.test(invoiceId)) return respond({error:'ID invoice tidak valid'},422);
    const validation=validatePaymentProofFile(file);
    if(!validation.ok) return respond({error:validation.errors.join('; ').replaceAll('bukti','faktur pajak')},422);
    const invoice=await d1First(database,'SELECT id,client_id,status FROM invoices WHERE id=? AND org_id=? LIMIT 1',[invoiceId,organizationId]);
    if(!invoice) return respond({error:'Invoice tidak ditemukan'},404);
    if(!['APPROVED','ISSUED','PARTIALLY_PAID','PAID'].includes(invoice.status)) return respond({error:'Invoice belum disetujui'},409);
    const objectKey=`${safeProofFilename(organizationId)}/tax-invoices/${safeProofFilename(invoiceId)}/${Date.now()}-${safeProofFilename(file.name)}`;
    await bucket.put(objectKey,await file.arrayBuffer(),{httpMetadata:{contentType:file.type},customMetadata:{originalName:safeProofFilename(file.name),invoiceId,uploadedBy:authorization.actor.email}});
    await database.prepare(`INSERT INTO audit_logs(id,org_id,username,role,action,detail,entity,entity_id,timestamp) VALUES(?,?,?,?,'TAX_INVOICE_FILE_UPLOADED',?,'tax_invoice_file',?,${NOW})`).bind(`AUD-${crypto.randomUUID()}`,organizationId,authorization.actor.email,authorization.actor.role,JSON.stringify({objectKey,originalName:safeProofFilename(file.name),size:file.size}),invoiceId).run();
    return respond({ok:true,invoiceId,filename:safeProofFilename(file.name)},201);
  }catch(error){return respond(publicError(error,requestId),500);}
}
