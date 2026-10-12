import { defineConfig } from '@playwright/test';

const baseURL = process.env.BASE_URL || 'https://proqpay-lite.pages.dev';
// Login traces can include the password field and session cookies in snapshots.
// Credential-mode CI must never persist browser video, screenshots or traces.
const credentialMode=process.env.UAT_CREDENTIALS_ENABLED==='true';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 45_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  outputDir: 'artifacts/test-results',
  reporter: [
    ['line'],
    ['html', { outputFolder: 'artifacts/playwright-report', open: 'never' }],
  ],
  use: {
    baseURL,
    browserName: 'chromium',
    ...(process.env.P2_LOCAL_CHROME==='1'?{launchOptions:{executablePath:'/usr/bin/google-chrome',args:['--no-sandbox']}}:{}),
    headless: true,
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
    trace: credentialMode?'off':'retain-on-failure',
    screenshot: credentialMode?'off':'only-on-failure',
    video: credentialMode?'off':'retain-on-failure',
  },
});
