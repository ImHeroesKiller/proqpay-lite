import {d1All,d1First,hasD1} from './_d1.js';
import {authorize,enforceRateLimit,handlePreflight,secureJson} from './_security.js';

// Read-only projection of the ORIGINAL gateway tables. Nothing is migrated to
// disbursement_requests: a historical gateway payment is never a new execution.
const METHODS='GET, OPTIONS';
const ROLES=['SUPER_ADMIN','PAYROLL_PROCESSOR','PAYROLL_CONTROLLER'];
const clean=(v,n=120)=>String(v??'').trim().replace(/[\r\n\t]/g,' ').slice(0,n);
const orgId=(env,actor)=>String(actor?.orgId||env.DEFAULT_ORG_ID||'ORG-OTSINDO');
const safe=(row)=>({
  registerId:`LEGACY:${row.id}`,legacyGatewayId:row.id,sourceDocumentType:'PAYMENT_INSTRUCTION',
  sourceDocumentId:row.payment_instruction_id,documentNo:row.document_no||null,
  clientId:row.client_id,projectId:row.project_id||null,provider:row.provider,
  providerReference:row.provider_reference||null,providerTransactionId:row.provider_transaction_id||null,
  providerStatus:row.provider_status||null,providerSubAccountIdMasked:row.provider_sub_account_last4?`••••${String(row.provider_sub_account_last4).slice(-4)}`:null,
  amount:Number(row.amount||0),currency:row.currency||'IDR',
  status:String(row.status||'UNKNOWN'),
  recipientCount:Number(row.recipient_count||0),succeededItems:Number(row.succeeded_items||0),
  failedItems:Number(row.failed_items||0),unresolvedItems:Number(row.unresolved_items||0),
  createdAt:row.created_at,paidAt:row.paid_at||null,
  sourceStrategy:'LEGACY_GATEWAY_READ_ONLY',canExecute:false,canRetry:false,canModify:false,
});

export async function onRequest({request,env}){
  if(request.method==='OPTIONS')return handlePreflight(request,env,METHODS);
  if(request.method!=='GET')return secureJson({error:'Legacy history is read-only',code:'LEGACY_HISTORY_READ_ONLY'},405,request,env,METHODS);
  const auth=await authorize(request,env,{roles:ROLES,methods:METHODS});
  if(auth.response)return auth.response;
  const limited=await enforceRateLimit(request,env,auth.actor,'legacy-transaction-history',METHODS);
  if(limited)return limited;
  if(!hasD1(env))return secureJson({error:'D1 unavailable'},503,request,env,METHODS);
  const org=orgId(env,auth.actor),url=new URL(request.url);
  const id=clean(url.searchParams.get('id'));
  const from=`FROM payment_gateway_transactions pgt
    LEFT JOIN payment_instructions pi ON pi.id=pgt.payment_instruction_id AND pi.org_id=pgt.org_id
    LEFT JOIN payroll_submissions ps ON ps.id=pi.submission_id AND ps.org_id=pi.org_id`;
  const columns=`pgt.id,pgt.payment_instruction_id,pgt.client_id,pgt.provider,pgt.provider_transaction_id,pgt.provider_reference,
    pgt.provider_status,pgt.provider_sub_account_last4,pgt.amount,pgt.currency,pgt.status,pgt.created_at,pgt.paid_at,
    pi.document_no,ps.project_id,
    (SELECT COUNT(*) FROM payment_gateway_items gi WHERE gi.payment_gateway_transaction_id=pgt.id) AS recipient_count,
    (SELECT COUNT(*) FROM payment_gateway_items gi WHERE gi.payment_gateway_transaction_id=pgt.id AND gi.status='SUCCEEDED') AS succeeded_items,
    (SELECT COUNT(*) FROM payment_gateway_items gi WHERE gi.payment_gateway_transaction_id=pgt.id AND gi.status='FAILED') AS failed_items,
    (SELECT COUNT(*) FROM payment_gateway_items gi WHERE gi.payment_gateway_transaction_id=pgt.id AND gi.status IN ('PENDING','PROCESSING','UNKNOWN')) AS unresolved_items`;
  if(id){
    const row=await d1First(env.DB,`SELECT ${columns} ${from} WHERE pgt.id=? AND pgt.org_id=? LIMIT 1`,[id,org]);
    if(!row)return secureJson({error:'Legacy gateway record tidak ditemukan'},404,request,env,METHODS);
    const items=await d1All(env.DB,`SELECT gi.id,gi.client_ref,gi.beneficiary_name,gi.bank_id,gi.account_last4,gi.amount,gi.status,
      gi.provider_transaction_id,gi.journal_id,gi.response_code,gi.failure_stage,gi.last_checked_at
      FROM payment_gateway_items gi
      JOIN payment_gateway_transactions pgt ON pgt.id=gi.payment_gateway_transaction_id
      WHERE pgt.org_id=? AND pgt.id=? ORDER BY gi.created_at,gi.id`,[org,id]);
    return secureJson({ok:true,transaction:safe(row),items:items.map(item=>({
      id:item.id,clientRef:item.client_ref,beneficiaryName:item.beneficiary_name,
      bankCode:item.bank_id,accountLast4:item.account_last4,amount:Number(item.amount||0),status:item.status,
      providerTransactionId:item.provider_transaction_id||null,journalId:item.journal_id||null,
      responseCode:item.response_code||null,failureStage:item.failure_stage||null,lastCheckedAt:item.last_checked_at||null,
    }))},200,request,env,METHODS);
  }
  const page=Number(url.searchParams.get('page')||1),pageSize=Number(url.searchParams.get('pageSize')||40);
  if(!Number.isSafeInteger(page)||page<1||page>10000||!Number.isSafeInteger(pageSize)||pageSize<1||pageSize>100)
    return secureJson({error:'Pagination tidak valid',code:'LEGACY_HISTORY_PAGINATION_INVALID'},422,request,env,METHODS);
  const period=clean(url.searchParams.get('period'),10);
  if(period&&!/^\d{4}-(0[1-9]|1[0-2])$/.test(period))return secureJson({error:'Periode tidak valid'},422,request,env,METHODS);
  const clientId=clean(url.searchParams.get('clientId')),projectId=clean(url.searchParams.get('projectId'));
  const query=clean(url.searchParams.get('query'),100),status=clean(url.searchParams.get('status'),40).toUpperCase();
  let where='pgt.org_id=?';const bindings=[org];
  if(clientId){where+=' AND pgt.client_id=?';bindings.push(clientId);}
  if(projectId){where+=' AND ps.project_id=?';bindings.push(projectId);}
  if(period){where+=' AND (ps.period=? OR ps.payment_period=?)';bindings.push(period,period);}
  if(status){where+=' AND pgt.status=?';bindings.push(status);}
  if(query){where+=' AND (pgt.id LIKE ? OR pgt.payment_instruction_id LIKE ? OR pgt.provider_reference LIKE ? OR pi.document_no LIKE ?)';
    const pattern='%'+query.replace(/[%_]/g,'')+'%';bindings.push(pattern,pattern,pattern,pattern);}
  const count=await d1First(env.DB,`SELECT COUNT(*) AS total ${from} WHERE ${where}`,bindings);
  const total=Number(count?.total||0);
  const rows=await d1All(env.DB,`SELECT ${columns} ${from} WHERE ${where} ORDER BY pgt.created_at DESC,pgt.id DESC LIMIT ? OFFSET ?`,[...bindings,pageSize,(page-1)*pageSize]);
  return secureJson({ok:true,sourceStrategy:'LEGACY_GATEWAY_READ_ONLY',transactions:rows.map(safe),pagination:{page,pageSize,total,totalPages:Math.max(1,Math.ceil(total/pageSize)),hasNext:page*pageSize<total}},200,request,env,METHODS);
}
