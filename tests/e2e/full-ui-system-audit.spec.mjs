import { test, expect } from '@playwright/test';

const email=process.env.PROQPAY_UAT_EMAIL||'';
const password=process.env.PROQPAY_UAT_PASSWORD||'';
const hasCredentials=Boolean(email&&password);

async function login(page){
  if(await page.locator('aside.app-sidebar').isVisible().catch(()=>false)) return true;
  if(!hasCredentials)return false;

  for(let attempt=1;attempt<=3;attempt+=1){
    await page.goto('/',{waitUntil:'domcontentloaded'}).catch(()=>{});

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
    },{email,password}).catch(()=>0);

    if(status===200){
      await page.reload({waitUntil:'domcontentloaded'}).catch(()=>{});
      if(await page.locator('aside.app-sidebar').isVisible().catch(()=>false)) return true;
    }

    const emailInput=page.getByPlaceholder('nama@perusahaan.com');
    const passwordInput=page.getByPlaceholder('Masukkan password');
    const submit=page.locator('form.login-form button.login-submit').first();
    if(await emailInput.isVisible().catch(()=>false) && await submit.isVisible().catch(()=>false)){
      await emailInput.fill(email);
      await passwordInput.fill(password);
      await submit.click();
      try {
        await page.locator('aside.app-sidebar').waitFor({state:'visible',timeout:7000});
        return true;
      } catch {}
    }
    if(attempt<3) await page.waitForTimeout(1500*attempt);
  }

  await expect(page.locator('aside.app-sidebar')).toBeVisible({timeout:15000});
  return true;
}

async function visibleModuleButtons(page){
  return page.locator('aside.app-sidebar .sidebar-nav-button:visible, aside.app-sidebar a.sidebar-nav-button:visible');
}

test.describe('Full application UI system audit',()=>{
  test('all visible desktop modules preserve one shell and avoid viewport overflow',async({page})=>{
    test.skip(!hasCredentials,'UAT credentials are required');
    await page.setViewportSize({width:1440,height:1000});
    await login(page);

    const labels=await (await visibleModuleButtons(page)).allTextContents();
    const audited=[];

    for(const raw of labels){
      const label=raw.trim().replace(/\s+/g,' ');
      if(!label)continue;
      const scope=page.locator('aside.app-sidebar');
      const button=scope.getByRole('button',{name:label,exact:true});
      const link=scope.getByRole('link',{name:label,exact:true});
      const current=(await button.count())?button.first():link.first();
      if(!(await current.count()))continue;
      await current.click();
      await page.waitForLoadState('networkidle').catch(()=>{});

      await expect(page.locator('aside.app-sidebar')).toBeVisible();
      await expect(page.locator('header.app-header')).toBeVisible();
      await expect(page.locator('footer.app-footer')).toBeVisible();

      const metrics=await page.evaluate(()=>({
        scrollWidth:document.documentElement.scrollWidth,
        clientWidth:document.documentElement.clientWidth,
        mainCount:document.querySelectorAll('main').length,
        visibleDialogs:[...document.querySelectorAll('[role="dialog"]')].filter(el=>{
          const s=getComputedStyle(el);return s.display!=='none'&&s.visibility!=='hidden';
        }).length,
      }));
      expect(metrics.scrollWidth-metrics.clientWidth, `${label} horizontal overflow`).toBeLessThanOrEqual(2);
      expect(metrics.mainCount,`${label} must have a main region`).toBeGreaterThanOrEqual(1);
      expect(metrics.visibleDialogs,`${label} unexpected dialog on entry`).toBe(0);
      audited.push(label);
    }
    expect(labels.map((value) => value.trim()).filter(Boolean).length).toBeGreaterThan(0);
    expect(audited.length).toBeGreaterThan(0);
  });

  test('shared shell geometry remains stable between modules',async({page})=>{
    test.skip(!hasCredentials,'UAT credentials are required');
    await page.setViewportSize({width:1440,height:1000});
    await login(page);

    const baseline=await page.evaluate(()=>({
      sidebar:document.querySelector('aside.app-sidebar')?.getBoundingClientRect().width||0,
      header:document.querySelector('header.app-header')?.getBoundingClientRect().height||0,
    }));

    const probes=['Dashboard','Employees','Reports','Billing & AR','Integrations','Audit Logs','Portal Configuration','Advance Salary'];
    for(const label of probes){
      const scope=page.locator('aside.app-sidebar');
      const button=scope.getByRole('button',{name:label,exact:true});
      const link=scope.getByRole('link',{name:label,exact:true});
      const item=(await button.count())?button.first():link.first();
      if(!(await item.count()))continue;
      await item.click();
      await page.waitForLoadState('networkidle').catch(()=>{});
      const size=await page.evaluate(()=>({
        sidebar:document.querySelector('aside.app-sidebar')?.getBoundingClientRect().width||0,
        header:document.querySelector('header.app-header')?.getBoundingClientRect().height||0,
      }));
      expect(Math.abs(size.sidebar-baseline.sidebar),`${label} sidebar width drift`).toBeLessThanOrEqual(1);
      expect(Math.abs(size.header-baseline.header),`${label} header height drift`).toBeLessThanOrEqual(1);
    }
  });

  test('mobile modules retain drawer/header and no horizontal overflow',async({page})=>{
    test.skip(!hasCredentials,'UAT credentials are required');
    await page.setViewportSize({width:390,height:844});
    await login(page);

    const probes=['Dashboard','Employees','Reports','Billing & AR','Integrations','Audit Logs'];
    for(const label of probes){
      await page.getByRole('button',{name:'Buka navigasi'}).first().click();
      const sidebar=page.locator('aside.app-sidebar');
      const button=sidebar.getByRole('button',{name:label,exact:true});
      const link=sidebar.getByRole('link',{name:label,exact:true});
      const item=(await button.count())?button.first():link.first();
      if(!(await item.count())){
        await page.keyboard.press('Escape');
        continue;
      }
      await item.click();
      await page.waitForLoadState('networkidle').catch(()=>{});
      await expect(page.getByRole('button',{name:'Buka navigasi'}).first()).toBeVisible();

      const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
      expect(overflow,`${label} mobile horizontal overflow`).toBeLessThanOrEqual(2);
    }
  });
});
