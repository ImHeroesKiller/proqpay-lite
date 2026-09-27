import { test, expect } from '@playwright/test';

const email = process.env.PROQPAY_UAT_EMAIL || '';
const password = process.env.PROQPAY_UAT_PASSWORD || '';
const hasCredentials = Boolean(email && password);

async function login(page) {
  await page.goto('/', { waitUntil: 'networkidle' });
  if (!hasCredentials) return false;
  await page.getByPlaceholder('nama@perusahaan.com').fill(email);
  await page.getByPlaceholder('Masukkan password').fill(password);
  await page.getByRole('button', { name: /Masuk ke ProQPay/i }).click();
  await page.waitForLoadState('networkidle');
  await expect(page.locator('aside.app-sidebar')).toBeVisible();
  return true;
}

async function assertShellIntegrity(page) {
  await expect(page.locator('aside.app-sidebar')).toHaveAttribute('aria-label', 'Navigasi utama');
  await expect(page.locator('header.app-header')).toBeVisible();
  await expect(page.locator('footer.app-footer')).toBeVisible();

  const sidebarBox = await page.locator('aside.app-sidebar').boundingBox();
  const headerBox = await page.locator('header.app-header').boundingBox();
  expect(sidebarBox?.width || 0).toBeGreaterThan(60);
  expect(headerBox?.height || 0).toBeGreaterThanOrEqual(58);
}

test.describe('Unified sidebar and application shell', () => {
  test('desktop navigation uses one active state and matching header taxonomy', async ({ page }) => {
    test.skip(!hasCredentials, 'UAT credentials are required');
    await page.setViewportSize({ width: 1440, height: 1000 });
    await login(page);
    await assertShellIntegrity(page);

    const sidebar = page.locator('aside.app-sidebar');
    const candidates = [
      ['Dashboard', 'Dashboard'],
      ['Clients & Projects', 'Clients & Projects'],
      ['Data Readiness', 'Data Readiness'],
      ['Pay Runs', 'Pay Runs'],
      ['Payment Instructions', 'Payment Instructions'],
      ['Billing & AR', 'Billing & AR'],
      ['Employees', 'Employees'],
      ['Reports', 'Reports'],
      ['Integrations', 'Integrations'],
      ['Audit Logs', 'Audit Logs'],
      ['Advance Salary', 'Advance Salary'],
    ];

    let exercised = 0;
    for (const [navLabel, headerLabel] of candidates) {
      const button = sidebar.getByRole('button', { name: navLabel, exact: true });
      if (!(await button.count())) continue;

      const group = button.locator('xpath=ancestor::nav[1]');
      if (await group.count()) {
        const toggle = group.locator('.sidebar-group-toggle');
        if (await toggle.count()) {
          const expanded = await toggle.getAttribute('aria-expanded');
          if (expanded === 'false') await toggle.click();
        }
      }

      await button.click();
      await expect(button).toHaveAttribute('aria-current', 'page');
      await expect(page.locator('.header-context strong')).toHaveText(headerLabel);

      const activeItems = sidebar.locator('[aria-current="page"]');
      expect(await activeItems.count()).toBe(1);
      exercised += 1;
    }

    expect(exercised).toBeGreaterThanOrEqual(5);
  });

  test('sidebar utilities share the same control geometry', async ({ page }) => {
    test.skip(!hasCredentials, 'UAT credentials are required');
    await page.setViewportSize({ width: 1440, height: 1000 });
    await login(page);

    const sidebar = page.locator('aside.app-sidebar');
    const navButton = sidebar.locator('.sidebar-nav-button').first();
    const utilityButton = sidebar.locator('.sidebar-utility-button').first();

    await expect(navButton).toBeVisible();
    await expect(utilityButton).toBeVisible();

    const navBox = await navButton.boundingBox();
    const utilityBox = await utilityButton.boundingBox();
    expect(Math.abs((navBox?.height || 0) - (utilityBox?.height || 0))).toBeLessThanOrEqual(4);
    expect(Math.abs((navBox?.width || 0) - (utilityBox?.width || 0))).toBeLessThanOrEqual(4);
  });

  test('mobile drawer behaves as one modal navigation surface', async ({ page }) => {
    test.skip(!hasCredentials, 'UAT credentials are required');
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page);

    const sidebar = page.locator('aside.app-sidebar');
    const menu = page.getByRole('button', { name: 'Buka navigasi' });
    await expect(menu).toBeVisible();

    await menu.click();
    await expect(sidebar).toHaveClass(/mobile-open/);
    await expect(page.getByRole('button', { name: 'Tutup navigasi' }).first()).toBeVisible();

    const visibleNav = sidebar.locator('.sidebar-nav-button:visible').first();
    await expect(visibleNav).toBeVisible();
    await visibleNav.click();
    await expect(sidebar).not.toHaveClass(/mobile-open/);

    await menu.click();
    await expect(sidebar).toHaveClass(/mobile-open/);
    await page.keyboard.press('Escape');
    await expect(sidebar).not.toHaveClass(/mobile-open/);
  });

  test('header search resolves to the same navigation labels as sidebar', async ({ page }) => {
    test.skip(!hasCredentials, 'UAT credentials are required');
    await page.setViewportSize({ width: 1440, height: 1000 });
    await login(page);

    const sidebar = page.locator('aside.app-sidebar');
    const probes = ['Billing & AR', 'Employees', 'Reports'];

    for (const label of probes) {
      const nav = sidebar.getByRole('button', { name: label, exact: true });
      if (!(await nav.count())) continue;

      await page.getByRole('button', { name: 'Cari modul' }).click();
      const input = page.getByPlaceholder('Cari modul atau pekerjaan…');
      await input.fill(label);

      const result = page.locator('#header-search-options').getByRole('option').first();
      await expect(result.getByRole('strong')).toHaveText(label).catch(async () => {
        await expect(result).toContainText(label);
      });

      await result.click();
      await expect(page.locator('.header-context strong')).toHaveText(label);
      await expect(nav).toHaveAttribute('aria-current', 'page');
    }
  });
});
