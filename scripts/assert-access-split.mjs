/**
 * Warn if Cloudflare Access would mix ops and the employee portal.
 * Fail-open when the token cannot read Access apps (AUTH_MODE=session is the SoR).
 */
const ACCOUNT = String(process.env.CLOUDFLARE_ACCOUNT_ID || '').trim();
const TOKEN = String(process.env.CLOUDFLARE_API_TOKEN || '').trim();
const ESS_HOST = 'proqpay-ess.arywibowo.workers.dev';
const LITE_HOST = 'proqpay-lite.pages.dev';

function covers(app, host) {
  const blob = JSON.stringify(app || {});
  return blob.includes(host);
}

async function main() {
  if (!ACCOUNT || !TOKEN) {
    console.log('Access split check skipped (no Cloudflare credentials).');
    return;
  }
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/access/apps?per_page=1000`,
    { headers: { Authorization: `Bearer ${TOKEN}` } },
  );
  if (response.status === 401 || response.status === 403) {
    console.log(`Access API ${response.status}; skip (session auth is the production identity).`);
    return;
  }
  const body = await response.json().catch(() => ({}));
  if (!body?.success) {
    console.log('Access list unsuccessful; skip.');
    return;
  }
  const apps = Array.isArray(body.result) ? body.result : [];
  const essApps = apps.filter((app) => covers(app, ESS_HOST));
  const liteApps = apps.filter((app) => covers(app, LITE_HOST));
  const employeeBypass = liteApps.some((app) => /\/api\/employee/i.test(JSON.stringify(app)));

  if (essApps.length) {
    console.warn('WARNING: Cloudflare Access covers the ESS hostname. Portal must not share ops Access.');
    for (const app of essApps) console.warn(' -', app.name, app.domain || '');
  }
  if (liteApps.length && !employeeBypass) {
    console.warn('WARNING: Lite Access has no /api/employee path bypass. Add a Bypass app for');
    console.warn(`  ${LITE_HOST}/api/employee`);
  }
  console.log(
    `Access split check: ${apps.length} apps, ESS=${essApps.length}, Lite=${liteApps.length}, employeeBypass=${employeeBypass}`,
  );
}

await main();
