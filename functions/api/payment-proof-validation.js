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


export function validPaymentProofDate(value) {
  const match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value||''));
  if (!match) return false;
  const year=Number(match[1]), month=Number(match[2]), day=Number(match[3]);
  const date=new Date(Date.UTC(year,month-1,day));
  return date.getUTCFullYear()===year && date.getUTCMonth()===month-1 && date.getUTCDate()===day;
}

export function detectPaymentProofType(bytes) {
  const data=bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  if (data.length>=5 && data[0]===0x25 && data[1]===0x50 && data[2]===0x44 && data[3]===0x46 && data[4]===0x2d) return 'application/pdf';
  if (data.length>=3 && data[0]===0xff && data[1]===0xd8 && data[2]===0xff) return 'image/jpeg';
  if (data.length>=8 && data[0]===0x89 && data[1]===0x50 && data[2]===0x4e && data[3]===0x47
    && data[4]===0x0d && data[5]===0x0a && data[6]===0x1a && data[7]===0x0a) return 'image/png';
  return '';
}

export function validatePaymentProofContent(file, bytes) {
  const errors=[];
  const declared=String(file?.type||'').toLowerCase();
  const detected=detectPaymentProofType(bytes);
  if (!detected) errors.push('Isi file bukti tidak dikenali sebagai PDF, JPG, JPEG, atau PNG');
  else if (declared && declared!==detected) errors.push('Tipe file tidak sesuai dengan isi file');
  return { ok:errors.length===0, errors, detectedType:detected };
}
