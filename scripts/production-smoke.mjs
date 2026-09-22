const base = String(process.argv[2] || 'https://proqpay-lite.pages.dev').replace(/\/+$/, '');

async function json(path, expectedStatus) {
  const response = await fetch(`${base}${path}`, {
    headers: { Accept: 'application/json' },
    redirect: 'manual',
  });
  let body = {};
  try { body = await response.json(); } catch {}
  if (response.status !== expectedStatus) {
    throw new Error(`${path} expected HTTP ${expectedStatus}, got ${response.status}: ${JSON.stringify(body)}`);
  }
  return body;
}

const health = await json('/api/health', 200);
if (health.ready !== true || health.database !== 'd1' || health.auth_mode !== 'session') {
  throw new Error(`Health contract failed: ${JSON.stringify(health)}`);
}
if (!Array.isArray(health.checks) || health.checks.some((check) => check.status === 'error')) {
  throw new Error(`Health checks contain an error: ${JSON.stringify(health.checks)}`);
}

for (const path of ['/api/me', '/api/operating-model?resource=submissions', '/api/billing']) {
  const body = await json(path, 401);
  if (!/authentication required/i.test(String(body.error || ''))) {
    throw new Error(`${path} did not fail closed for anonymous access`);
  }
}

const page = await fetch(`${base}/`, { redirect: 'manual' });
if (page.status !== 200) throw new Error(`Home page expected HTTP 200, got ${page.status}`);
const html = await page.text();
if (!/ProQPay/i.test(html)) throw new Error('Home page does not contain ProQPay identity');

console.log(JSON.stringify({
  ok: true,
  base,
  health: { status: health.status, database: health.database, authMode: health.auth_mode },
  anonymousProtectedEndpoints: '401',
  home: '200',
}));
