export const MAX_PAYMENT_PROOF_BYTES = 5 * 1024 * 1024;
export const PAYMENT_PROOF_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
]);

export function safeProofFilename(value) {
  const normalized = String(value || 'proof')
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);
  return normalized || 'proof';
}

export function validatePaymentProofFile(file) {
  const errors = [];
  if (!file || typeof file.arrayBuffer !== 'function') errors.push('File bukti wajib dipilih');
  if (file && !PAYMENT_PROOF_TYPES.has(String(file.type || '').toLowerCase())) {
    errors.push('Format bukti harus PDF, JPG, JPEG, atau PNG');
  }
  if (file && (!Number.isFinite(file.size) || file.size <= 0)) errors.push('File bukti kosong');
  if (file && file.size > MAX_PAYMENT_PROOF_BYTES) errors.push('Ukuran file maksimal 5 MB');
  return { ok: errors.length === 0, errors };
}

export function paymentProofObjectKey(organizationId, paymentInstructionId, filename, now = Date.now(), id = crypto.randomUUID()) {
  return `${safeProofFilename(organizationId)}/${safeProofFilename(paymentInstructionId)}/${now}-${safeProofFilename(id)}-${safeProofFilename(filename)}`;
}
