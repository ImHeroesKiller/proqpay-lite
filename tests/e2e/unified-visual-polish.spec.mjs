import { test, expect } from '@playwright/test';

const email=process.env.PROQPAY_UAT_EMAIL||'';
const password=process.env.PROQPAY_UAT_PASSWORD||'';
const hasCredentials=Boolean(email&&password);

async function login(page){
  await page.goto('/',{waitUntil:'networkidle'});
  if(await page.locator('aside.app-sidebar').isVisible().catch(()=>false)) return;
  test.skip(!hasCredentials,'UAT credentials are required');
  await page.getByPlaceholder('nama@perusahaan.com').fill(email);
  await page.getByPlaceholder('Masukkan password').fill(password);
  await page.locator('form.login-form button.login-submit').click();
  await expect(page.locator('aside.app-sidebar')).toBeVisible();
}

async function openModule(page,label){
  const sidebar=page.locator('aside.app-sidebar');
  const button=sidebar.getByRole('button',{name:label,exact:true});
  const link=sidebar.getByRole('link',{name:label,exact:true});
  const item=(await button.count())?button.first():link.first();
  if(!(await item.count())) return false;
  await item.click();
  await page.waitForLoadState('networkidle').catch(()=>{});
  return true;
}

test.describe('P3 unified visual polish',()=>{
  test('priority workspaces keep one typography, card and density rhythm',async({page})=>{
    await page.setViewportSize({width:1440,height:1000});
    await login(page);
    let audited=0;
    for(const label of ['Billing & AR','Portal Configuration','Audit Logs','Advance Salary','Reports','Employees']){
      if(!(await openModule(page,label))) continue;
      const header=page.locator('.ui-workspace-header h1').first();
      if(await header.count()){
        const size=Number.parseFloat(await header.evaluate(el=>getComputedStyle(el).fontSize));
        expect(size, `${label} heading size`).toBeGreaterThanOrEqual(20);
        expect(size, `${label} heading size`).toBeLessThanOrEqual(24);
      }
      const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
      expect(overflow,`${label} desktop overflow`).toBeLessThanOrEqual(2);
      audited+=1;
    }
    expect(audited).toBeGreaterThanOrEqual(3);
  });

  test('mobile visual system preserves responsive rhythm and reduced motion',async({page})=>{
    await page.emulateMedia({reducedMotion:'reduce'});
    await page.setViewportSize({width:390,height:844});
    await login(page);
    for(const label of ['Billing & AR','Audit Logs','Advance Salary']){
      await page.getByRole('button',{name:'Buka navigasi'}).first().click();
      const sidebar=page.locator('aside.app-sidebar');
      const item=sidebar.getByRole('button',{name:label,exact:true}).first();
      if(!(await item.count())){
        await page.keyboard.press('Escape');
        continue;
      }
      await item.click();
      await page.waitForLoadState('networkidle').catch(()=>{});
      const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
      expect(overflow,`${label} mobile overflow`).toBeLessThanOrEqual(2);
      const section=page.locator('.ui-section-card').first();
      if(await section.count()){
        const radius=Number.parseFloat(await section.evaluate(el=>getComputedStyle(el).borderRadius));
        expect(radius).toBeGreaterThanOrEqual(8);
      }
    }
  });
});
