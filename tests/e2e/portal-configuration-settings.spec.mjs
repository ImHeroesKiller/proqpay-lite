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

test.describe('Portal Configuration placement',()=>{
  test('Portal Configuration is removed from sidebar and available inside Settings',async({page})=>{
    await page.setViewportSize({width:1440,height:1000});
    await login(page);

    const sidebar=page.locator('aside.app-sidebar');
    await expect(sidebar.getByRole('button',{name:'Portal Configuration',exact:true})).toHaveCount(0);

    const settings=sidebar.getByRole('button',{name:'Settings',exact:true});
    if(!(await settings.count())) test.skip(true,'Current UAT role cannot manage Settings');
    await settings.click();

    const dialog=page.getByRole('dialog',{name:'Pengaturan aplikasi'});
    await expect(dialog).toBeVisible();

    const portalTab=dialog.getByRole('button',{name:/Portal Configuration/i});
    if(!(await portalTab.count())) test.skip(true,'Current UAT role cannot manage Employee Services');
    await portalTab.click();

    await expect(dialog.getByText('Portal Configuration',{exact:true}).first()).toBeVisible();
    await expect(dialog.locator('.ui-workspace-header').first()).toBeVisible();
    await expect(dialog.locator('.ui-tabs').first()).toBeVisible();

    const overflow=await dialog.evaluate((el)=>el.scrollWidth-el.clientWidth);
    expect(overflow).toBeLessThanOrEqual(2);
  });

  test('Portal Configuration no longer appears in global module search',async({page})=>{
    await page.setViewportSize({width:1440,height:1000});
    await login(page);

    await page.getByRole('button',{name:'Cari modul'}).click();
    const input=page.getByPlaceholder('Cari modul atau pekerjaan…');
    await input.fill('Portal Configuration');
    await expect(page.locator('#header-search-options').getByText('Portal Configuration',{exact:true})).toHaveCount(0);
  });
});
