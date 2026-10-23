import {e2payAuthorize,e2payInquiry,E2PAY_UAT_DUMMY_DESTINATION} from './payment-gateway-e2pay.js';

// Independent of the disbursement ledger: never imports or calls a transfer operation.
export async function diagnoseUatInquiry(env,amount,fetchImpl=fetch){
  if(String(env.E2PAY_ENV||'UAT').toUpperCase()!=='UAT'){
    const error=new Error('Tes inquiry diagnostik hanya tersedia untuk UAT');
    error.code='E2PAY_DIAGNOSTIC_UAT_ONLY';throw error;
  }
  if(!Number.isSafeInteger(amount)||amount<=0||amount>1000000000){
    const error=new Error('Nominal diagnostik harus bilangan bulat 1–1000000000');
    error.code='E2PAY_DIAGNOSTIC_AMOUNT_INVALID';throw error;
  }
  const auth=await e2payAuthorize(env,fetchImpl);
  const results=[];
  for(const value of [...new Set([15000,amount])]){
    let diagnostic=null;
    const probeEnv=Object.create(env);
    Object.defineProperty(probeEnv,'__e2payAudit',{value:async audit=>{
      if(audit.endpoint==='/b2b/merchant/me/sdp/inquiry')diagnostic={httpStatus:audit.httpStatus,...audit.responseDiagnostics};
      if(typeof env.__e2payAudit==='function')await env.__e2payAudit(audit);
    }});
    try{
      await e2payInquiry(probeEnv,auth.accessToken,{...E2PAY_UAT_DUMMY_DESTINATION,amount:value},fetchImpl);
      results.push({amount:value,ok:true,diagnostic});
    }catch(error){
      results.push({amount:value,ok:false,code:error.code||'E2PAY_DIAGNOSTIC_FAILED',diagnostic});
    }
  }
  return {environment:'UAT',financialPostStarted:false,results};
}
