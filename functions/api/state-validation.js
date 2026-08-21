const MAX_ITEMS = 500;
const MAX_JSON_BYTES = 2 * 1024 * 1024;
const ID = /^[A-Za-z0-9._:-]{1,120}$/;
const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;

function list(value) {
  return Array.isArray(value) ? value : [];
}

export function validateBusinessState(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: 'state object required' };
  }
  const state = {
    payrolls: list(input.payrolls),
    approvals: list(input.approvals),
    invoices: list(input.invoices),
    arMonitor: list(input.arMonitor),
    auditLogs: list(input.auditLogs).slice(-MAX_ITEMS),
  };
  for (const [name, rows] of Object.entries(state)) {
    if (rows.length > MAX_ITEMS) return { ok: false, error: `${name} maksimal ${MAX_ITEMS} item` };
    for (const row of rows) {
      if (!row || typeof row !== 'object' || !ID.test(String(row.id || ''))) {
        return { ok: false, error: `${name} memiliki id tidak valid` };
      }
      if ('period' in row && row.period && !PERIOD.test(String(row.period))) {
        return { ok: false, error: `${name} memiliki periode tidak valid` };
      }
    }
  }
  if (new TextEncoder().encode(JSON.stringify(state)).byteLength > MAX_JSON_BYTES) {
    return { ok: false, error: 'Business state terlalu besar' };
  }
  return { ok: true, state };
}

export { MAX_JSON_BYTES };
