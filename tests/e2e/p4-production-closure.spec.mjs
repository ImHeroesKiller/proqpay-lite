import { test, expect } from '@playwright/test';

const email=process.env.PROQPAY_UAT_EMAIL||'';
const password=process.env.PROQPAY_UAT_PASSWORD||'';
const hasCredentials=Boolean(email&&password);

async function login(page){
  test.skip(!hasCredentials,'UAT credentials are required for P4 production closure');
  await page.goto('/',{waitUntil:'domcontentloaded'});
  if(await page.locator('aside.app-sidebar').isVisible().catch(()=>false)) return;

  const status=await page.evaluate(async({email,password})=>{
    const response=await fetch('/api/login',{
      method:'POST',
      credentials:'same-origin',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({email,password}),
    }).catch(()=>null);
    return response?.status||0;
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

async function clickWorkspace(page,label){
  const sidebar=page.locator('aside.app-sidebar');
  const exact=sidebar.getByRole('button',{name:label,exact:true});
  if(await exact.isVisible().catch(()=>false)){
    await exact.click();
    await page.waitForTimeout(150);
    return true;
  }
  return false;
}

test.describe('P4 production closure regression',()=>{
  test('canonical production shell, health and security headers are ready',async({page,request,baseURL})=>{
    const response=await page.goto('/',{waitUntil:'networkidle'});
    expect(response?.ok()).toBeTruthy();
    await expect(page.locator('body')).toContainText(/ProQPay/i);

    const health=await request.get(`${baseURL}/api/health`);
    expect(health.status()).toBe(200);
    const body=await health.json();
    expect(body.ready).toBe(true);
    expect(body.database).toBe('d1');
    expect(body.auth_mode).toBe('session');

    const headers=response?.headers()||{};
    expect(headers['content-security-policy']||'').toContain("script-src-attr 'none'");
    expect(headers['cross-origin-resource-policy']).toBe('same-origin');
    expect(headers['access-control-allow-origin']).toBe('https://proqpay.msg-os.com');
    expect(headers['x-content-type-options']).toBe('nosniff');
  });

  test('authenticated workspace navigation remains error-free and non-destructive',async({page})=>{
    const pageErrors=[];
    const consoleErrors=[];
    const failedRequests=[];

    page.on('pageerror',err=>pageErrors.push(err.message));
    page.on('console',msg=>{
      if(msg.type()==='error'){
        const text=msg.text();
        if(!/401.*\/api\/me|\/api\/me.*401/i.test(text)) consoleErrors.push(text);
      }
    });
    page.on('requestfailed',req=>{
      if(req.resourceType()==='document' || req.method()==='GET'){
        failedRequests.push(`${req.method()} ${req.url()} :: ${req.failure()?.errorText||'failed'}`);
      }
    });

    await login(page);

    const identity=await page.evaluate(async()=>{
      const response=await fetch('/api/me',{credentials:'same-origin'});
      return {status:response.status,body:await response.json().catch(()=>({}))};
    });
    expect(identity.status).toBe(200);
    expect(String(identity.body?.role||'')).not.toBe('');

    const labels=[
      'Dashboard',
      'Clients & Projects',
      'Data Intake',
      'Data Readiness',
      'Pay Runs',
      'Payment Instructions',
      'Payment Control',
      'Billing & AR',
      'Employees',
      'Reports',
      'Employee Services',
      'Integrations',
      'Audit Logs',
    ];

    let visited=0;
    for(const label of labels){
      const opened=await clickWorkspace(page,label);
      if(!opened) continue;
      visited+=1;
      await expect(page.locator('body')).not.toContainText(/Application error|Something went wrong|Internal Server Error/i);
    }

    expect(visited,'At least the core authorized workspaces must be reachable').toBeGreaterThanOrEqual(8);
    expect(pageErrors,`Unhandled page errors: ${pageErrors.join(' | ')}`).toEqual([]);
    expect(failedRequests,`Failed GET/navigation requests: ${failedRequests.join(' | ')}`).toEqual([]);
    expect(consoleErrors,`Console errors: ${consoleErrors.join(' | ')}`).toEqual([]);
  });

  test('anonymous financial and operational APIs continue to fail closed',async({request,baseURL})=>{
    for(const path of ['/api/me','/api/operating-model','/api/billing','/api/payment-gateway']){
      const response=await request.get(`${baseURL}${path}`);
      expect([401,403],`${path} must reject anonymous access`).toContain(response.status());
    }
  });
});
