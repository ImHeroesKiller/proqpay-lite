import { decryptAccountNumber, encryptAccountNumber, sha256Hex } from './payment-instruction-core.js';

export function employeeBankSecret(env = {}) {
  const secret = String(env.EMPLOYEE_BANK_ENCRYPTION_KEY || env.PI_ENCRYPTION_KEY || '');
  if (secret.length < 32) throw new Error('EMPLOYEE_BANK_ENCRYPTION_KEY atau PI_ENCRYPTION_KEY minimal 32 karakter diperlukan');
  return secret;
}

export async function prepareEmployeeBankAccount(accountNumber, env = {}) {
  const normalized = String(accountNumber || '').replace(/\D/g, '');
  if (!/^\d{6,34}$/.test(normalized)) throw new Error('Invalid employee bank account number');
  const secret = employeeBankSecret(env);
  const encrypted = await encryptAccountNumber(normalized, secret);
  const fingerprint = await sha256Hex(`EMPLOYEE_BANK|${secret}|${normalized}`);
  return {
    normalized,
    ciphertext:encrypted.ciphertext,
    iv:encrypted.iv,
    last4:encrypted.last4,
    fingerprint,
  };
}

export async function revealEmployeeBankAccount(row, env = {}) {
  if (row?.account_ciphertext && row?.account_iv) {
    return decryptAccountNumber(row.account_ciphertext, row.account_iv, employeeBankSecret(env));
  }
  const legacy = String(row?.account_no || row?.legacy_account_no || '').replace(/\D/g, '');
  return /^\d{6,34}$/.test(legacy) ? legacy : '';
}

export function employeeBankStorageValue(record) {
  // account_no remains a compatibility column during the one-release migration.
  // It stores only a non-sensitive last-4 marker; full account data lives in AES-GCM fields.
  return record?.last4 ? `ENC:${record.last4}` : 'ENC';
}
