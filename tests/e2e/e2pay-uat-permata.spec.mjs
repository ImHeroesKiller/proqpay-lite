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

async function openIntegrations(page){
  const sidebar=page.locator('aside.app-sidebar');
  let integrations=sidebar.getByRole('button',{name:'Integrations',exact:true});
  if(!(await integrations.isVisible().catch(()=>false))){
    const system=sidebar.getByRole('button',{name:'System',exact:true});
    if(await system.isVisible().catch(()=>false)) await system.click();
  }
  integrations=sidebar.getByRole('button',{name:'Integrations',exact:true});
  test.skip(!(await integrations.count()),'Current UAT role cannot view Integrations');
  await integrations.click();
  await expect(page.getByRole('heading',{name:'Integrations',exact:true})).toBeVisible();
}

test('E2Pay UAT dummy Permata inquiry follows provider instruction',async({page})=>{
  test.skip(!hasCredentials,'UAT credentials are required');
  await page.setViewportSize({width:1440,height:1000});
  await login(page);
  await openIntegrations(page);

  const overview=await page.evaluate(async()=>{
    const response=await fetch('/api/e2pay-operations?resource=overview',{credentials:'same-origin'});
    return {status:response.status,body:await response.json().catch(()=>({}))};
  });
  test.skip(overview.status!==200,'E2Pay overview is not available');
  test.skip(String(overview.body?.account?.environment||'').toUpperCase()!=='UAT','Live provider is not UAT');

  const advanced=page.getByText('Advanced administration',{exact:true});
  await advanced.click();
  const inquirySummary=page.getByText('Disbursement inquiry',{exact:true});
  await inquirySummary.click();

  await expect(page.getByText('E2Pay UAT dummy destination',{exact:true})).toBeVisible();
  const accountInput=page.getByLabel('Destination account');
  const bankInput=page.getByLabel('Bank ID');
  const amountInput=page.getByLabel('Amount');
  await expect(accountInput).toHaveValue('701075327');
  await expect(bankInput).toHaveValue('permata');
  await expect(amountInput).toHaveValue('15000');

  await page.getByRole('button',{name:'Run inquiry',exact:true}).click();
  await expect(page.getByText('INQUIRY berhasil.',{exact:true})).toBeVisible({timeout:20000});
});
