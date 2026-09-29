import fs from 'node:fs';
import crypto from 'node:crypto';

const [rowsPath, checkpointsPath, evidencePath, sqlPath] = process.argv.slice(2);
if (!rowsPath || !checkpointsPath || !evidencePath || !sqlPath) {
  throw new Error('Usage: node security-audit-checkpoint.mjs <rows.json> <checkpoints.json> <evidence.json> <checkpoint.sql>');
}

function flattenWrangler(path) {
  const parsed = JSON.parse(fs.readFileSync(path, 'utf8'));
  const entries = Array.isArray(parsed) ? parsed : [parsed];
  return entries.flatMap((entry) => Array.isArray(entry?.results) ? entry.results : []);
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function isoDay(value) {
  const text = String(value || '');
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : '';
}

function sql(value) {
  if (value === null || value === undefined || value === '') return 'NULL';
  return `'${String(value).replaceAll("'", "''")}'`;
}

const rows = flattenWrangler(rowsPath);
const checkpoints = flattenWrangler(checkpointsPath);
const fields = [
  'id','timestamp','username','role','action','detail','entity','entity_id',
  'correlation_id','ip_hash','device_hash','security_context_json',
];

const grouped = new Map();
for (const row of rows) {
  const day = isoDay(row.timestamp);
  if (!day) continue;
  if (!grouped.has(day)) grouped.set(day, []);
  grouped.get(day).push(Object.fromEntries(fields.map((field) => [field, row[field] ?? null])));
}
for (const values of grouped.values()) {
  values.sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)) || String(a.id).localeCompare(String(b.id)));
}

const daySummary = (day) => {
  const values = grouped.get(day) || [];
  return {
    checkpointDate: day,
    rowCount: values.length,
    firstTimestamp: values[0]?.timestamp || null,
    lastTimestamp: values.at(-1)?.timestamp || null,
    contentSha256: sha256(JSON.stringify(values)),
  };
};

const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
const verified = [];
const mismatches = [];

for (const checkpoint of checkpoints) {
  const current = daySummary(String(checkpoint.checkpoint_date || ''));
  const expectedCount = Number(checkpoint.row_count || 0);
  const expectedHash = String(checkpoint.content_sha256 || '');
  const ok = current.rowCount === expectedCount && current.contentSha256 === expectedHash;
  verified.push({ checkpointDate: current.checkpointDate, rowCount: current.rowCount, hash: current.contentSha256, ok });
  if (!ok) {
    mismatches.push({
      checkpointDate: current.checkpointDate,
      expectedRowCount: expectedCount,
      actualRowCount: current.rowCount,
      expectedHash,
      actualHash: current.contentSha256,
    });
  }
}

const target = daySummary(yesterday);
const existingTarget = checkpoints.find((row) => String(row.checkpoint_date) === yesterday);
const evidence = {
  generatedAt: new Date().toISOString(),
  algorithm: 'SHA-256',
  canonicalFields: fields,
  verificationWindowDays: 8,
  target,
  verified,
  mismatchCount: mismatches.length,
  mismatches,
};
fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2) + '\n');

if (mismatches.length) {
  fs.writeFileSync(sqlPath, '-- checkpoint write blocked because existing evidence no longer matches\n');
  console.error(JSON.stringify(evidence, null, 2));
  process.exit(2);
}

if (existingTarget) {
  fs.writeFileSync(sqlPath,
    `UPDATE security_audit_checkpoints SET verified_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'), verification_status='VERIFIED', updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE checkpoint_date=${sql(yesterday)};\n`
  );
} else {
  fs.writeFileSync(sqlPath,
    `INSERT INTO security_audit_checkpoints(checkpoint_date,row_count,first_timestamp,last_timestamp,content_sha256,verified_at,verification_status) VALUES(${sql(target.checkpointDate)},${target.rowCount},${sql(target.firstTimestamp)},${sql(target.lastTimestamp)},${sql(target.contentSha256)},strftime('%Y-%m-%dT%H:%M:%fZ','now'),'SEALED');\n`
  );
}

console.log(JSON.stringify(evidence, null, 2));
