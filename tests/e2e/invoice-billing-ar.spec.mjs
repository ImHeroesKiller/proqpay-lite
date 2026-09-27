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

  if (await page.getByRole('heading', { name: /Ganti password sementara/i }).isVisible().catch(() => false)) {
    throw new Error('UAT account still requires forced password change');
  }

  await expect(page.locator('body')).not.toContainText(/Masuk menggunakan akun ProQPay/i);
  return true;
}

// Authenticated regression trigger: repository UAT secrets are expected in CI.
test.describe('Invoice / Billing & AR production UAT', () => {
  test('public production shell and health remain healthy', async ({ page, request, baseURL }) => {
    const pageErrors = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    const response = await page.goto('/', { waitUntil: 'networkidle' });
    expect(response?.ok()).toBeTruthy();
    await expect(page.locator('body')).toContainText(/ProQPay/i);
    expect(pageErrors).toEqual([]);

    const health = await request.get(`${baseURL}/api/health`);
    expect(health.status()).toBe(200);
    const json = await health.json();
    expect(json.ready).toBe(true);
    expect(json.database).toBe('d1');
    expect(json.auth_mode).toBe('session');
  });

  test('authenticated Billing & AR surfaces are consistent and non-destructive', async ({ page }) => {
    test.skip(!hasCredentials, 'PROQPAY_UAT_EMAIL/PASSWORD are not configured');

    const consoleErrors = [];
    const failedRequests = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('requestfailed', (req) => failedRequests.push(`${req.method()} ${req.url()} :: ${req.failure()?.errorText || 'failed'}`));

    await login(page);

    await page.getByRole('button', { name: /Billing & AR|Close & Billing/i }).click();
    await expect(page.getByRole('banner').getByText('Billing & AR', { exact: true })).toBeVisible();
    await expect(page.getByText('Outstanding AR', { exact: true })).toBeVisible();

    const invoiceTab = page.getByRole('button', { name: /^Invoice$/i });
    if (await invoiceTab.count()) await invoiceTab.click();

    await expect(page.getByText('Daftar invoice', { exact: true })).toBeVisible();

    const invoiceRows = page.locator('table tbody tr');
    const invoiceCount = await invoiceRows.count();

    if (invoiceCount > 0) {
      const firstRow = invoiceRows.first();
      const view = firstRow.getByRole('button', { name: 'Lihat' });
      if (await view.count()) {
        await view.click();
        await expect(page.locator('body')).toContainText(/Invoice/i);
        await expect(page.locator('body')).toContainText(/PT Mandiri Semesta Gemilang/i);
        const dialog = page.getByRole('dialog');
        await dialog.getByRole('button').first().click();
        await expect(dialog).toBeHidden();
      }

      const pdf = firstRow.getByRole('link', { name: /PDF A4/i });
      if (await pdf.count()) {
        const href = await pdf.getAttribute('href');
        expect(href).toMatch(/^\/api\/invoice-document\?invoiceId=/);
        const pdfResponse = await page.request.get(href);
        expect(pdfResponse.ok()).toBeTruthy();
        expect(pdfResponse.headers()['content-type'] || '').toMatch(/pdf/i);
      }
    }

    const arTab = page.getByRole('button', { name: /AR Monitoring/i });
    if (await arTab.count()) await arTab.click();
    await expect(page.getByText('Monitoring piutang & payment gate', { exact: true })).toBeVisible();
    await expect(page.getByText('Outstanding', { exact: true })).toBeVisible();
    await expect(page.locator('body')).toContainText(/Payment gate/i);

    const visibleGate = page.locator('text=/BLOCKED|WARNING|CLEAR/');
    expect(await visibleGate.count()).toBeGreaterThan(0);

    const auditButton = page.getByRole('button', { name: /Audit Logs/i });
    if (await auditButton.count()) {
      await auditButton.click();
      await expect(page.locator('body')).toContainText(/Audit Logs/i);
    }

    const unexpectedFailedRequests = failedRequests.filter(
      (entry) => !/^HEAD .* :: net::ERR_ABORTED$/.test(entry),
    );
    expect(
      unexpectedFailedRequests,
      `Unexpected failed requests: ${unexpectedFailedRequests.join(' | ')}`,
    ).toEqual([]);
    expect(consoleErrors, `Console errors: ${consoleErrors.join(' | ')}`).toEqual([]);
  });
});
