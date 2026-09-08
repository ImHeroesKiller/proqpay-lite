const DATE = /^\d{4}-\d{2}-\d{2}$/;

export const SLA_TRIGGERS = Object.freeze([
  'PAYROLL_PAID',
  'INVOICE_ISSUED',
  'INVOICE_DOC_COMPLETE',
  'BAST_SIGNED',
]);

export const MANUAL_SLA_TRIGGERS = Object.freeze([
  'INVOICE_DOC_COMPLETE',
  'BAST_SIGNED',
]);

export const SLA_CALENDAR_MODES = Object.freeze([
  'WEEKDAYS_ONLY',
  'ID_OFFICIAL',
]);

export function normalizeRequiredTriggers(value) {
  const input = Array.isArray(value) ? value : [];
  const normalized = [...new Set(input.map((item) => String(item || '').trim().toUpperCase()).filter(Boolean))];
  if (!normalized.length || normalized.some((item) => !SLA_TRIGGERS.includes(item))) return null;
  return normalized;
}

export function validateSlaPolicyInput({ termsBusinessDays, requiredTriggers, calendarMode }) {
  const terms = Number(termsBusinessDays);
  const triggers = normalizeRequiredTriggers(requiredTriggers);
  const mode = String(calendarMode || 'WEEKDAYS_ONLY').toUpperCase();
  const errors = [];
  if (!Number.isSafeInteger(terms) || terms < 1 || terms > 365) errors.push('termsBusinessDays wajib 1-365');
  if (!triggers) errors.push('requiredTriggers tidak valid');
  if (!SLA_CALENDAR_MODES.includes(mode)) errors.push('calendarMode tidak valid');
  return { ok: errors.length === 0, errors, termsBusinessDays: terms, requiredTriggers: triggers, calendarMode: mode };
}

export function normalizeSlaDate(value) {
  if (!value) return null;
  const raw = String(value).slice(0, 10);
  if (!DATE.test(raw)) return null;
  const parsed = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10) === raw ? raw : null;
}

export function isValidSlaDate(value) {
  return normalizeSlaDate(value) !== null;
}

export function resolveSlaTrigger(requiredTriggers, facts = {}) {
  const required = normalizeRequiredTriggers(requiredTriggers);
  if (!required) return { ready: false, missing: ['INVALID_POLICY'], triggerDate: null, basis: {} };
  const basis = {};
  const missing = [];
  for (const trigger of required) {
    const date = normalizeSlaDate(facts[trigger]);
    if (!date) missing.push(trigger);
    else basis[trigger] = date;
  }
  if (missing.length) return { ready: false, missing, triggerDate: null, basis };
  const triggerDate = Object.values(basis).sort().at(-1) || null;
  return { ready: true, missing: [], triggerDate, basis };
}

export function addBusinessDaysUtc(start, days, nonBusinessDates = new Set()) {
  const raw = normalizeSlaDate(start instanceof Date ? start.toISOString().slice(0, 10) : start);
  if (!raw) throw new Error('Invalid business-day start date');
  const terms = Number(days);
  if (!Number.isSafeInteger(terms) || terms < 0 || terms > 365) throw new Error('Invalid business-day count');
  const date = new Date(`${raw}T00:00:00.000Z`);
  let remaining = terms;
  while (remaining > 0) {
    date.setUTCDate(date.getUTCDate() + 1);
    const weekday = date.getUTCDay();
    const key = date.toISOString().slice(0, 10);
    if (weekday !== 0 && weekday !== 6 && !nonBusinessDates.has(key)) remaining -= 1;
  }
  return date;
}

export function calendarYearsNeeded(start, termsBusinessDays) {
  const raw = normalizeSlaDate(start);
  if (!raw) return [];
  const terms = Number(termsBusinessDays);
  if (!Number.isSafeInteger(terms) || terms < 1 || terms > 365) return [];
  const startDate = new Date(`${raw}T00:00:00.000Z`);
  const conservativeEnd = new Date(startDate);
  conservativeEnd.setUTCDate(conservativeEnd.getUTCDate() + terms * 2 + 31);
  const years = [];
  for (let year = startDate.getUTCFullYear(); year <= conservativeEnd.getUTCFullYear(); year += 1) years.push(year);
  return years;
}