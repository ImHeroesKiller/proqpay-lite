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
  await page.getByRole('button',{name:/Masuk ke ProQPay/i}).click();
  await page.waitForLoadState('networkidle').catch(()=>{});
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

test.describe('P1 unified component system',()=>{
  test('priority workspaces share the same component primitives',async({page})=>{
    await page.setViewportSize({width:1440,height:1000});
    await login(page);

    const expectations=[
      ['Billing & AR',['.ui-metric-grid','.ui-tabs','.ui-section-card']],
      ['Portal Configuration',['.ui-workspace-header','.ui-tabs']],
      ['Audit Logs',['.ui-workspace-header','.ui-metric-grid','.ui-filter-bar','.ui-section-card']],
      ['Advance Salary',['.ui-workspace-header','.ui-metric-grid','.ui-filter-bar']],
    ];

    let audited=0;
    for(const [label,selectors] of expectations){
      if(!(await openModule(page,label))) continue;
      for(const selector of selectors){
        await expect(page.locator(selector).first(),`${label} missing ${selector}`).toBeVisible();
      }
      const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
      expect(overflow,`${label} horizontal overflow`).toBeLessThanOrEqual(2);
      audited+=1;
    }
    expect(audited).toBeGreaterThanOrEqual(3);
  });

  test('shared components retain mobile shell integrity',async({page})=>{
    await page.setViewportSize({width:390,height:844});
    await login(page);

    for(const label of ['Billing & AR','Audit Logs','Advance Salary']){
      await page.getByRole('button',{name:'Buka navigasi'}).first().click();
      const sidebar=page.locator('aside.app-sidebar');
      const item=sidebar.getByRole('button',{name:label,exact:true});
      if(!(await item.count())){
        await page.keyboard.press('Escape');
        continue;
      }
      await item.click();
      await page.waitForLoadState('networkidle').catch(()=>{});
      await expect(page.getByRole('button',{name:'Buka navigasi'}).first()).toBeVisible();
      const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
      expect(overflow,`${label} mobile overflow`).toBeLessThanOrEqual(2);
    }
  });
});
