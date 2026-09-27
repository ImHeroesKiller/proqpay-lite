import { test, expect } from '@playwright/test';

test.describe('ProQPay production smoke', () => {
  test('login shell renders without browser runtime errors', async ({ page }) => {
    const consoleErrors = [];
    const pageErrors = [];

    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('pageerror', (error) => pageErrors.push(error.message));

    const response = await page.goto('/', { waitUntil: 'networkidle' });
    expect(response?.ok()).toBeTruthy();

    await expect(page.locator('body')).toContainText(/ProQPay/i);
    await expect(page.getByRole('button', { name: /Masuk ke ProQPay/i })).toBeVisible();

    expect(pageErrors, `Unhandled page errors: ${pageErrors.join(' | ')}`).toEqual([]);
    const unexpectedConsoleErrors = consoleErrors.filter(
      (message) => !/Failed to load resource: the server responded with a status of 401/i.test(message),
    );
    expect(
      unexpectedConsoleErrors,
      `Unexpected console errors: ${unexpectedConsoleErrors.join(' | ')}`,
    ).toEqual([]);
  });

  test('health endpoint is ready and sanitized', async ({ request, baseURL }) => {
    const response = await request.get(`${baseURL}/api/health`);
    expect(response.status()).toBe(200);

    const health = await response.json();
    expect(health.ready).toBe(true);
    expect(health.database).toBe('d1');
    expect(health.auth_mode).toBe('session');
  });

  test('protected APIs fail closed for anonymous browser session', async ({ request, baseURL }) => {
    for (const path of ['/api/me', '/api/operating-model', '/api/billing']) {
      const response = await request.get(`${baseURL}${path}`);
      expect(response.status(), `${path} should reject anonymous access`).toBe(401);
    }
  });
});
