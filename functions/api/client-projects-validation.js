const CODE = /^[A-Z0-9][A-Z0-9_-]{1,29}$/;
const ID = /^[A-Za-z0-9._:-]{1,120}$/;

function cleanText(value, max) {
  const text = String(value || '').trim();
  return text && text.length <= max ? text : null;
}

export function validateDirectoryAction(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, errors: ['JSON object required'] };
  }
  const action = String(input.action || '');
  const errors = [];
  const code = String(input.code || '').trim().toUpperCase();
  const name = cleanText(input.name, 160);
  if (!['CREATE_CLIENT', 'CREATE_PROJECT'].includes(action)) errors.push('action tidak dikenal');
  if (!CODE.test(code)) errors.push('code wajib 2-30 karakter A-Z, angka, _ atau -');
  if (!name) errors.push('name wajib diisi maksimal 160 karakter');
  if (action === 'CREATE_PROJECT' && !ID.test(String(input.clientId || ''))) errors.push('clientId tidak valid');
  if (input.startDate && !/^\d{4}-\d{2}-\d{2}$/.test(String(input.startDate))) errors.push('startDate tidak valid');
  if (input.endDate && !/^\d{4}-\d{2}-\d{2}$/.test(String(input.endDate))) errors.push('endDate tidak valid');
  return { ok: errors.length === 0, errors, value: { ...input, code, name } };
}
