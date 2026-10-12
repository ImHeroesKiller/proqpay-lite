import {d1All,hasD1} from './_d1.js';
import {authorize,enforceRateLimit,handlePreflight,secureJson} from './_security.js';
const METHODS='GET, OPTIONS';
const ROLES=['SUPER_ADMIN','PAYROLL_PROCESSOR','PAYROLL_CONTROLLER'];
export async function onRequest({request,env}){
 if(request.method==='OPTIONS')return handlePreflight(request,env,METHODS);
 if(request.method!=='GET')return secureJson({error:'UAT archive is immutable',code:'UAT_ARCHIVE_READ_ONLY'},405,request,env,METHODS);
 const auth=await authorize(request,env,{roles:ROLES,methods:METHODS});
 if(auth.response)return auth.response;
 const limited=await enforceRateLimit(request,env,auth.actor,'uat-administrative-archives',METHODS);
 if(limited)return limited;
 if(!hasD1(env))return secureJson({error:'D1 unavailable'},503,request,env,METHODS);
 const org=String(auth.actor.orgId||env.DEFAULT_ORG_ID||'ORG-OTSINDO');
 const rows=await d1All(env.DB,`SELECT source_document_id,client_id,amount_idr,archived_at
   FROM uat_administrative_closures WHERE org_id=?
   ORDER BY archived_at DESC,source_document_id DESC LIMIT 200`,[org]);
 return secureJson({ok:true,mode:'UAT_ADMINISTRATIVE_ARCHIVE_NOT_PROVIDER_SETTLED',
  records:rows.map(row=>({sourceDocumentId:row.source_document_id,clientId:row.client_id,
   amountIdr:Number(row.amount_idr),archivedAt:row.archived_at,assumedCompleteForUat:true,
   providerSettlementVerified:false,canExecute:false})),total:rows.length,
  warning:'UAT dianggap selesai hanya untuk kebersihan antrean. Bukan bukti pembayaran E2Pay.'},200,request,env,METHODS);
}
