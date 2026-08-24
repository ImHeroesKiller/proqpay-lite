import fs from 'node:fs';

const databaseId = String(process.argv[2] || '').trim();
if (!/^[0-9a-f-]{36}$/i.test(databaseId)) throw new Error('D1 database ID tidak valid');

const candidates = ['wrangler.jsonc', 'wrangler.json'];
const downloadedConfigPath = candidates.find((candidate) => fs.existsSync(candidate));
const downloadedTomlPath = fs.existsSync('wrangler.toml') ? 'wrangler.toml' : null;
if (!downloadedConfigPath && !downloadedTomlPath) {
  throw new Error('Wrangler Pages config hasil download tidak ditemukan');
}

function stripJsonComments(source) {
  let output = '';
  let quoted = false;
  let escaped = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (quoted) {
      output += char;
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') { quoted = true; output += char; continue; }
    if (char === '/' && next === '/') {
      while (index < source.length && source[index] !== '\n') index += 1;
      output += '\n';
      continue;
    }
    if (char === '/' && next === '*') {
      index += 2;
      while (index < source.length - 1 && !(source[index] === '*' && source[index + 1] === '/')) index += 1;
      index += 1;
      continue;
    }
    output += char;
  }
  return output.replace(/,\s*([}\]])/g, '$1');
}

let config;
if (downloadedConfigPath) {
  config = JSON.parse(stripJsonComments(fs.readFileSync(downloadedConfigPath, 'utf8')));
} else {
  const downloadedToml = fs.readFileSync(downloadedTomlPath, 'utf8');
  const projectName = downloadedToml.match(/^\s*name\s*=\s*["']([^"']+)["']/m)?.[1];
  if (!projectName) throw new Error('Nama Pages project tidak ditemukan pada wrangler.toml');
  if (projectName !== 'proqpay-lite') throw new Error(`Pages project tidak sesuai: ${projectName}`);

  // Wrangler v4 currently downloads Pages settings as TOML. The reviewed
  // repository template remains the cutover source of truth, while the
  // downloaded TOML is used to verify that we are targeting the right project.
  config = JSON.parse(stripJsonComments(fs.readFileSync('wrangler.example.jsonc', 'utf8')));
}
if (config.name && config.name !== 'proqpay-lite') throw new Error(`Pages project tidak sesuai: ${config.name}`);

config.$schema = './node_modules/wrangler/config-schema.json';
config.name = 'proqpay-lite';
config.compatibility_date = '2026-08-21';
config.pages_build_output_dir = './out';
config.d1_databases = [
  ...(config.d1_databases || []).filter((binding) => binding.binding !== 'DB'),
  {
    binding: 'DB',
    database_name: 'proqpay-lite-production',
    database_id: databaseId,
    migrations_dir: 'migrations',
  },
];
config.r2_buckets = [
  ...(config.r2_buckets || []).filter((binding) => binding.binding !== 'FILES'),
  { binding: 'FILES', bucket_name: 'proqpay-lite-files' },
];
config.kv_namespaces = (config.kv_namespaces || []).filter((binding) =>
  binding?.id && !/REPLACE_WITH|<KV_NAMESPACE_ID>/.test(String(binding.id))
);
if (!config.kv_namespaces.length) delete config.kv_namespaces;
config.ai = { binding: 'AI' };
// Cloudflare Pages rejects the Workers-only `observability` property. Remove
// it even when it came from the reviewed template or a downloaded config.
delete config.observability;
config.vars = {
  ...(config.vars || {}),
  DEFAULT_ORG_ID: 'ORG-OTSINDO',
  DATA_BACKEND: 'd1',
  AUTH_MODE: 'session',
  EMPLOYEE_SESSION_HOURS: String(config.vars?.EMPLOYEE_SESSION_HOURS || '12'),
  EMPLOYEE_PORTAL_ORIGINS: String(
    config.vars?.EMPLOYEE_PORTAL_ORIGINS || 'https://proqpay-ess.arywibowo.workers.dev',
  ),
  WORKERS_AI_MODEL: config.vars?.WORKERS_AI_MODEL || '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
  WORKERS_AI_FALLBACK_MODEL: config.vars?.WORKERS_AI_FALLBACK_MODEL || '@cf/meta/llama-3.1-8b-instruct-fast',
};

const serialized = JSON.stringify(config, null, 2) + '\n';
if (/REPLACE_WITH|<DATABASE_ID>|<KV_NAMESPACE_ID>/.test(serialized)) {
  throw new Error('Placeholder resource ID masih ditemukan');
}
fs.writeFileSync('wrangler.jsonc', serialized);
console.log('Wrangler Pages config prepared without exposing secrets.');
