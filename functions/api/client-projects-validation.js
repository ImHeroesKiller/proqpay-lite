const CODE = /^[A-Z0-9][A-Z0-9_-]{1,29}$/;
const ID = /^[A-Za-z0-9._:-]{1,120}$/;
const TIERS = new Set(['TIER_1_PAYMENT_PROCESSING','TIER_2_MANAGED_PAYROLL','TIER_3_INTEGRATED_AUTOMATION']);

function cleanText(value, max) {
  const text = String(value || '').trim();
  return text && text.length <= max ? text : null;
}

function optionalText(value, max) {
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
  if (!['CREATE_CLIENT', 'CREATE_PROJECT', 'UPDATE_CLIENT', 'UPDATE_PROJECT'].includes(action)) errors.push('action tidak dikenal');
  if (code && !CODE.test(code)) errors.push('code wajib 2-30 karakter A-Z, angka, _ atau -');
  if (!name) errors.push('name wajib diisi maksimal 160 karakter');
  if (['CREATE_PROJECT', 'UPDATE_PROJECT'].includes(action) && !ID.test(String(input.clientId || ''))) errors.push('clientId tidak valid');
  if (action.startsWith('UPDATE_') && !ID.test(String(input.id || ''))) errors.push('id tidak valid');
  if (input.status && !['ACTIVE','ON_HOLD','COMPLETED','INACTIVE'].includes(String(input.status))) errors.push('status tidak valid');
  if (input.startDate && !/^\d{4}-\d{2}-\d{2}$/.test(String(input.startDate))) errors.push('startDate tidak valid');
  if (input.endDate && !/^\d{4}-\d{2}-\d{2}$/.test(String(input.endDate))) errors.push('endDate tidak valid');
  if (input.tier && !TIERS.has(String(input.tier))) errors.push('tier tidak valid');
  if (input.tierEffectiveFrom && !/^\d{4}-\d{2}-\d{2}$/.test(String(input.tierEffectiveFrom))) errors.push('tierEffectiveFrom tidak valid');
  if (input.tierEffectiveUntil && !/^\d{4}-\d{2}-\d{2}$/.test(String(input.tierEffectiveUntil))) errors.push('tierEffectiveUntil tidak valid');
  if (input.tierEffectiveFrom && input.tierEffectiveUntil && input.tierEffectiveUntil < input.tierEffectiveFrom) errors.push('periode tier tidak valid');
  let website = optionalText(input.website, 300);
  if (website) {
    try { const url = new URL(website); if (url.protocol !== 'https:') errors.push('website wajib menggunakan HTTPS'); }
    catch { errors.push('website tidak valid'); website = null; }
  }
  const contactEmail = optionalText(input.contactEmail, 254);
  if (contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) errors.push('email PIC tidak valid');
  const billingEmail = optionalText(input.billingEmail, 254);
  if (billingEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(billingEmail)) errors.push('email billing tidak valid');
  const paymentTermsDays = input.paymentTermsDays === undefined ? 30 : Number(input.paymentTermsDays);
  const billingRate = input.billingRate === undefined ? 0 : Number(input.billingRate);
  const billingAdminFee = input.billingAdminFee === undefined ? 0 : Number(input.billingAdminFee);
  const billingTaxRate = input.billingTaxRate === undefined ? 0 : Number(input.billingTaxRate);
  if (!Number.isSafeInteger(paymentTermsDays) || paymentTermsDays < 0 || paymentTermsDays > 365) errors.push('termin pembayaran tidak valid');
  if (![billingRate,billingAdminFee,billingTaxRate].every(Number.isFinite) || billingRate < 0 || billingAdminFee < 0 || billingTaxRate < 0 || billingTaxRate > 100) errors.push('nilai billing tidak valid');
  if (input.taxStatus && !['PKP','NON_PKP'].includes(String(input.taxStatus))) errors.push('status pajak tidak valid');
  if (input.billingMethod && !['PER_EMPLOYEE','FIXED','PERCENTAGE_OF_PAYROLL'].includes(String(input.billingMethod))) errors.push('metode billing tidak valid');
  return { ok: errors.length === 0, errors, value: {
    ...input, code, name, website,
    industry: optionalText(input.industry, 120), contactName: optionalText(input.contactName, 120),
    contactEmail, contactPhone: optionalText(input.contactPhone, 40), billingEmail,
    npwp: optionalText(input.npwp, 40), nitku: optionalText(input.nitku, 40), billingAddress: optionalText(input.billingAddress, 1000),
    paymentTermsDays, taxStatus: input.taxStatus || 'NON_PKP', purchaseOrder: optionalText(input.purchaseOrder, 120),
    billingMethod: input.billingMethod || 'PER_EMPLOYEE', billingRate, billingAdminFee, billingTaxRate,
    description: optionalText(input.description, 1000), serviceType: optionalText(input.serviceType, 120),
  } };
}
