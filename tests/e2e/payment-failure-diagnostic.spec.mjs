import { test, expect } from '@playwright/test';

const email=process.env.PROQPAY_UAT_EMAIL||'';
const password=process.env.PROQPAY_UAT_PASSWORD||'';
const hasCredentials=Boolean(email&&password);

async function login(page){
  await page.goto('/',{waitUntil:'domcontentloaded'});
  if(await page.locator('aside.app-sidebar').isVisible().catch(()=>false)) return;
  test.skip(!hasCredentials,'UAT credentials are required');
  const status=await page.evaluate(async({email,password})=>{
    const response=await fetch('/api/login',{
      method:'POST',
      credentials:'same-origin',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({email,password}),
    }).catch(()=>null);
    return response?.status||0;
  },{email,password});
  if(status===200) await page.reload({waitUntil:'domcontentloaded'});
  else{
    await page.getByPlaceholder('nama@perusahaan.com').fill(email);
    await page.getByPlaceholder('Masukkan password').fill(password);
    await page.locator('form.login-form button.login-submit').click();
  }
  await expect(page.locator('aside.app-sidebar')).toBeVisible({timeout:15000});
}

test('readonly diagnose latest payment gateway failures',async({page})=>{
  test.skip(!hasCredentials,'UAT credentials are required');
  await login(page);

  const diagnostics=await page.evaluate(async()=>{
    const listResponse=await fetch('/api/operating-model?resource=payment-instructions&offset=0&limit=500',{
      credentials:'same-origin',
      headers:{Accept:'application/json'},
      cache:'no-store',
    });
    const listBody=await listResponse.json().catch(()=>({}));
    const rows=Array.isArray(listBody?.paymentInstructions)?listBody.paymentInstructions:[];

    const recent=rows
      .filter((row)=>['PAYMENT_APPROVAL_PENDING','APPROVED_FOR_PAYMENT','DISBURSEMENT_PROCESSING','RECONCILIATION','PAID'].includes(String(row.status||'')))
      .sort((a,b)=>String(b.updated_at||b.created_at||'').localeCompare(String(a.updated_at||a.created_at||'')))
      .slice(0,12);

    const details=[];
    for(const row of recent){
      const response=await fetch('/api/payment-gateway?paymentInstructionId='+encodeURIComponent(row.id),{
        credentials:'same-origin',
        headers:{Accept:'application/json'},
        cache:'no-store',
      });
      const body=await response.json().catch(()=>({}));
      details.push({
        pi:{
          id:row.id,
          documentNo:row.document_no,
          status:row.status,
          expectedTotal:Number(row.expected_total||0),
          recipients:Number(row.recipient_count||0),
          updatedAt:row.updated_at||row.created_at||null,
          client:row.client_name||row.client_id||null,
        },
        gatewayHttpStatus:response.status,
        gateway:body?.gateway ? {
          configured:Boolean(body.gateway.configured),
          provider:body.gateway.provider||null,
          environment:body.gateway.environment||null,
          reason:body.gateway.reason||null,
        } : null,
        transaction:body?.transaction ? {
          id:body.transaction.id,
          provider:body.transaction.provider,
          status:body.transaction.status,
          providerStatus:body.transaction.provider_status||null,
          amount:Number(body.transaction.amount||0),
          errorCode:body.transaction.error_code||null,
          errorMessage:body.transaction.error_message||null,
          createdAt:body.transaction.created_at||null,
          updatedAt:body.transaction.updated_at||null,
        } : null,
        operational:body?.operational||null,
        arGate:body?.arGate ? {
          state:body.arGate.state,
          blocked:Boolean(body.arGate.blocked),
          mode:body.arGate.mode,
          outstanding:Number(body.arGate.outstanding||0),
          overdue:Number(body.arGate.overdue||0),
          code:body.arGate.code||null,
        } : null,
        items:Array.isArray(body?.items)?body.items.map((item)=>({
          id:item.id,
          status:item.status,
          amount:Number(item.amount||0),
          feeAmount:Number(item.fee_amount||0),
          clientRef:item.client_ref||null,
          bankId:item.bank_id||null,
          accountLast4:item.account_last4||null,
          responseCode:item.response_code||null,
          responseMessage:item.response_message||null,
          errorCode:item.error_code||null,
          errorMessage:item.error_message||null,
          attemptCount:Number(item.attempt_count||0),
          lastCheckedAt:item.last_checked_at||null,
        })):[],
      });
    }
    const overviewResponse=await fetch('/api/e2pay-operations?resource=overview&refresh=1',{
      credentials:'same-origin',
      headers:{Accept:'application/json'},
      cache:'no-store',
    });
    const overviewBody=await overviewResponse.json().catch(()=>({}));

    const clientRefs=[...new Set(details.flatMap((entry)=>entry.items.map((item)=>item.clientRef).filter(Boolean)))];
    const providerHistory=[];
    for(const clientRef of clientRefs.slice(0,20)){
      const response=await fetch('/api/e2pay-operations?resource=transactions&limit=20&clientRef='+encodeURIComponent(clientRef),{
        credentials:'same-origin',
        headers:{Accept:'application/json'},
        cache:'no-store',
      });
      const body=await response.json().catch(()=>({}));
      providerHistory.push({
        clientRef,
        httpStatus:response.status,
        rowCount:Number(body?.rowCount||0),
        rows:Array.isArray(body?.data)?body.data.map((row)=>({
          clientRef:row.clientRef||null,
          amount:Number(row.amount||0),
          feeAmount:Number(row.feeAmount||0),
          transactionName:row.transactionName||null,
          transactionCode:row.transactionCode||null,
          responseCode:row.responseCode||null,
          responseMessage:row.responseMessage||null,
          journalId:row.journalId||null,
          transactionTimestamp:row.transactionTimestamp||null,
        })):[],
      });
    }

    return {
      listStatus:listResponse.status,
      count:rows.length,
      account:{
        httpStatus:overviewResponse.status,
        available:Boolean(overviewBody?.account?.available),
        environment:overviewBody?.account?.environment||null,
        merchantStatus:overviewBody?.account?.merchantStatus||null,
        balance:Number(overviewBody?.account?.balance||0),
        accountIdMasked:overviewBody?.account?.accountIdMasked||null,
        refreshedAt:overviewBody?.account?.refreshedAt||null,
      },
      details,
      providerHistory,
    };
  });

  console.log('PAYMENT_FAILURE_DIAGNOSTIC='+JSON.stringify(diagnostics));
  expect(diagnostics.listStatus).toBe(200);
});
