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
  return true;
}

test.describe('Data Intake unified shell', () => {
  test('Data Intake remains inside the same sidebar/header/footer system', async ({ page }) => {
    test.skip(!hasCredentials, 'UAT credentials are required');
    await page.setViewportSize({ width: 1440, height: 1000 });
    await login(page);

    const sidebar = page.locator('aside.app-sidebar');
    const dataIntake = sidebar.getByRole('link', { name: 'Data Intake' });
    const hasDataIntakeNav = (await dataIntake.count()) > 0;
    if (hasDataIntakeNav) {
      await dataIntake.click();
      await page.waitForLoadState('networkidle');
    } else {
      await page.goto('/data-intake', { waitUntil: 'networkidle' });
    }

    await expect(page).toHaveURL(/\/data-intake\/?(?:\?|$)/);
    await expect(page.locator('aside.app-sidebar')).toBeVisible();
    await expect(page.locator('header.app-header')).toBeVisible();
    await expect(page.locator('footer.app-footer')).toBeVisible();
    await expect(page.locator('.header-context strong')).toHaveText('Data Intake');
    if (hasDataIntakeNav) {
      await expect(page.locator('aside.app-sidebar').getByRole('link', { name: 'Data Intake' }))
        .toHaveAttribute('aria-current', 'page');
    }

    if (hasDataIntakeNav) {
      const styles = await dataIntake.evaluate((node) => {
        const style = getComputedStyle(node);
        return {
          textDecoration: style.textDecorationLine,
          display: style.display,
        };
      });
      expect(styles.textDecoration).toBe('none');
      expect(styles.display).toBe('flex');
    }
  });

  test('mobile Data Intake uses the same drawer and header menu behavior', async ({ page }) => {
    test.skip(!hasCredentials, 'UAT credentials are required');
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page);

    await page.getByRole('button', { name: 'Buka navigasi' }).click();
    const sidebar = page.locator('aside.app-sidebar');
    await expect(sidebar).toHaveClass(/mobile-open/);
    await sidebar.getByRole('link', { name: 'Data Intake' }).click();
    await page.waitForLoadState('networkidle');

    await expect(page.locator('header.app-header')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Buka navigasi' }).first()).toBeVisible();
    await expect(page.locator('.header-context strong')).toHaveText('Data Intake');
  });
});
