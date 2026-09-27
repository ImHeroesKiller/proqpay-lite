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

async function openClientsProjects(page){
  const sidebar=page.locator('aside.app-sidebar');
  const button=sidebar.getByRole('button',{name:'Clients & Projects',exact:true});
  if(!(await button.count())) test.skip(true,'Current UAT role cannot access Clients & Projects');
  await button.click();
  await page.waitForLoadState('networkidle').catch(()=>{});
}

test.describe('Clients & Projects robust layout',()=>{
  test('desktop uses one full-width master workspace with consistent title and tabs',async({page})=>{
    await page.setViewportSize({width:1440,height:1000});
    await login(page);
    await openClientsProjects(page);

    await expect(page.getByRole('heading',{name:'Klien & Project',exact:true})).toBeVisible();
    await expect(page.locator('.ui-metric-grid').first()).toBeVisible();
    await expect(page.locator('.directory-filter-bar')).toBeVisible();
    await expect(page.locator('.directory-master-card')).toBeVisible();
    await expect(page.getByRole('tab',{name:/Klien/}).first()).toBeVisible();
    await expect(page.getByRole('tab',{name:/Project/}).first()).toBeVisible();

    await page.getByRole('tab',{name:/Project/}).first().click();
    await expect(page.getByRole('tab',{name:/Project/}).first()).toHaveAttribute('aria-selected','true');

    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(2);
  });

  test('mobile remains single-column and action controls stay usable',async({page})=>{
    await page.setViewportSize({width:390,height:844});
    await login(page);

    await page.getByRole('button',{name:'Buka navigasi'}).first().click();
    const sidebar=page.locator('aside.app-sidebar');
    const button=sidebar.getByRole('button',{name:'Clients & Projects',exact:true});
    if(!(await button.count())){
      await page.keyboard.press('Escape');
      test.skip(true,'Current UAT role cannot access Clients & Projects');
    }
    await button.click();
    await page.waitForLoadState('networkidle').catch(()=>{});

    await expect(page.getByRole('heading',{name:'Klien & Project',exact:true})).toBeVisible();
    await expect(page.locator('.directory-master-card')).toBeVisible();
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(2);

    const tabs=page.locator('.directory-master-card .ui-tabs');
    await expect(tabs).toBeVisible();
  });
});
