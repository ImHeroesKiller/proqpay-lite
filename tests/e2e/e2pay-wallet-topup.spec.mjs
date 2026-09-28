import { test, expect } from '@playwright/test';

const email=process.env.PROQPAY_UAT_EMAIL||'';
const password=process.env.PROQPAY_UAT_PASSWORD||'';
const hasCredentials=Boolean(email&&password);

async function login(page){
  await page.goto('/',{waitUntil:'domcontentloaded'});
  if(await page.locator('aside.app-sidebar').isVisible().catch(()=>false)) return;
  test.skip(!hasCredentials,'UAT credentials are required');

  const status=await page.evaluate(async({email,password})=>{
    try{
      const response=await fetch('/api/login',{
        method:'POST',
        credentials:'same-origin',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({email,password}),
      });
      return response.status;
    }catch{
      return 0;
    }
  },{email,password});

  if(status===200){
    await page.reload({waitUntil:'domcontentloaded'});
  }else{
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
    integrations=sidebar.getByRole('button',{name:'Integrations',exact:true});
  }
  test.skip(!(await integrations.count()),'Current UAT role cannot view Integrations');
  await integrations.click();
  await expect(page.getByRole('heading',{name:'Integrations',exact:true})).toBeVisible();
}

test.describe('E2Pay wallet Top Up E2E',()=>{
  test('authenticated Integrations exposes VA funding flow and balance refresh',async({page})=>{
    test.skip(!hasCredentials,'UAT credentials are required');
    await page.setViewportSize({width:1440,height:1000});
    await login(page);
    await openIntegrations(page);

    const providerStatus=await page.evaluate(async()=>{
      const response=await fetch('/api/e2pay-operations?resource=overview',{credentials:'same-origin'});
      const body=await response.json().catch(()=>({}));
      return {status:response.status,body};
    });

    test.skip(providerStatus.status===409,'E2Pay is not the active runtime provider');
    expect(providerStatus.status).toBe(200);

    const topUp=page.getByRole('button',{name:/Top Up Wallet/i}).first();
    await expect(topUp).toBeVisible();
    await topUp.click();

    const card=page.getByRole('region',{name:'Top Up Wallet E2Pay'});
    await expect(card).toBeVisible();
    await expect(card.getByRole('heading',{name:'Top Up Wallet',exact:true})).toBeVisible();
    await expect(card.getByText('Bank tujuan',{exact:true})).toBeVisible();
    await expect(card.getByText('Virtual Account (VA)',{exact:true})).toBeVisible();
    await expect(card.getByRole('button',{name:'Refresh saldo',exact:true})).toBeVisible();

    const funding=providerStatus.body?.account?.funding||{};
    if(funding.ready){
      expect(String(funding.bankName||'').trim()).not.toBe('');
      expect(String(funding.vaNumber||'').trim()).not.toBe('');
      await expect(card.getByText(String(funding.bankName),{exact:true})).toBeVisible();
      await expect(card.getByText(String(funding.vaNumber),{exact:true})).toBeVisible();
      await expect(card.getByRole('button',{name:'Salin Info Top Up',exact:true})).toBeEnabled();
    }else{
      await expect(card.getByText('Bank tujuan VA belum dikonfigurasi',{exact:true})).toBeVisible();
      await expect(card.getByRole('button',{name:'Salin Info Top Up',exact:true})).toBeDisabled();
    }

    const refresh=card.getByRole('button',{name:'Refresh saldo',exact:true});
    await refresh.click();
    await expect(card.getByRole('button',{name:'Refresh saldo',exact:true})).toBeVisible({timeout:15000});

    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(2);
  });

  test('Top Up Wallet remains usable on mobile without horizontal overflow',async({page})=>{
    test.skip(!hasCredentials,'UAT credentials are required');
    await page.setViewportSize({width:390,height:844});
    await login(page);

    const navButton=page.getByRole('button',{name:'Buka navigasi'}).first();
    if(await navButton.isVisible().catch(()=>false)) await navButton.click();

    const sidebar=page.locator('aside.app-sidebar');
    const system=sidebar.getByRole('button',{name:'System',exact:true});
    if(await system.isVisible().catch(()=>false)) await system.click();
    const integrations=sidebar.getByRole('button',{name:'Integrations',exact:true});
    test.skip(!(await integrations.count()),'Current UAT role cannot view Integrations');
    await integrations.click();

    const topUp=page.getByRole('button',{name:/Top Up Wallet/i}).first();
    if(!(await topUp.isVisible().catch(()=>false))){
      const status=await page.evaluate(async()=>{
        const response=await fetch('/api/e2pay-operations?resource=overview',{credentials:'same-origin'});
        return response.status;
      });
      test.skip(status===409,'E2Pay is not the active runtime provider');
    }
    await expect(topUp).toBeVisible();
    await topUp.click();

    await expect(page.getByRole('region',{name:'Top Up Wallet E2Pay'})).toBeVisible();
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(2);
  });
});
