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

test('Super Admin cannot perform final payment actions',async({page})=>{
  test.skip(!hasCredentials,'UAT credentials are required');
  await login(page);

  const identity=await page.evaluate(async()=>{
    const response=await fetch('/api/me',{credentials:'same-origin'});
    return {status:response.status,body:await response.json().catch(()=>({}))};
  });
  expect(identity.status).toBe(200);
  test.skip(identity.body?.role!=='SUPER_ADMIN','Configured UAT credential is not Super Admin');

  const result=await page.evaluate(async()=>{
    const jsonPost=async(url,body)=>{
      const response=await fetch(url,{
        method:'POST',
        credentials:'same-origin',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify(body),
      });
      return {status:response.status,body:await response.json().catch(()=>({}))};
    };

    const gateway=await jsonPost('/api/payment-gateway',{
      action:'EXECUTE',
      paymentInstructionId:'PI-AUTHORITY-PROBE',
    });
    const hosted=await jsonPost('/api/payment-gateway-hosted',{
      paymentInstructionId:'PI-AUTHORITY-PROBE',
      returnPath:'/?view=payments',
    });

    const form=new FormData();
    form.set('paymentInstructionId','PI-AUTHORITY-PROBE');
    form.set('bank','BCA');
    form.set('reference','AUTHORITY-PROBE');
    form.set('transactionDate','2026-09-28');
    form.set('amount','15000');
    form.set('file',new File([new Uint8Array([0x25,0x50,0x44,0x46])],'probe.pdf',{type:'application/pdf'}));
    const proofResponse=await fetch('/api/payment-proof',{method:'POST',credentials:'same-origin',body:form});
    const proof={status:proofResponse.status,body:await proofResponse.json().catch(()=>({}))};

    return {gateway,hosted,proof};
  });

  expect(result.gateway.status).toBe(403);
  expect(result.hosted.status).toBe(403);
  expect(result.proof.status).toBe(403);
});
