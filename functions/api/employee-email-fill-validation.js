export const EMAIL_FILL_CONFIRMATION = 'ISI EMAIL DUMMY';

export function validateEmailFillRequest(body) {
  const errors = [];
  const planId = String(body?.planId || '').trim();
  const domain = String(body?.domain || '').trim().toLowerCase();
  const expectedCount = Number(body?.expectedCount);

  if (body?.confirmation !== EMAIL_FILL_CONFIRMATION) {
    errors.push(`Konfirmasi wajib: ${EMAIL_FILL_CONFIRMATION}`);
  }
  if (!/^PLAN-[A-Z0-9-]{4,64}$/.test(planId)) {
    errors.push('planId tidak valid');
  }
  if (!/^[a-z0-9](?:[a-z0-9.-]{1,120}[a-z0-9])?\.invalid$/.test(domain)) {
    errors.push('Domain placeholder wajib valid dan berakhiran .invalid');
  }
  if (!Number.isInteger(expectedCount) || expectedCount < 1 || expectedCount > 500) {
    errors.push('expectedCount harus antara 1 dan 500');
  }

  return {
    ok: errors.length === 0,
    errors,
    value: { planId, domain, expectedCount },
  };
}
