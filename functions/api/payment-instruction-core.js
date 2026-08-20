const BANKS = Object.freeze({
  BCA: { delimiter: ',', header: ['Account Number','Beneficiary Name','Amount','Remark'] },
  MANDIRI: { delimiter: ';', header: ['Beneficiary Account','Beneficiary Name','Amount','Description'] },
  BRI: { delimiter: ',', header: ['ACCOUNT_NO','ACCOUNT_NAME','AMOUNT','REMARK'] },
  BNI: { delimiter: ',', header: ['BeneficiaryAccount','BeneficiaryName','Amount','PaymentDetail'] },
  CUSTOM: { delimiter: ',', header: ['bank_code','account_number','beneficiary_name','amount','remark'] },
});

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bytesToBase64(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function hex(bytes) {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function clean(value, limit = 140) {
  return String(value ?? '').trim().replace(/[\r\n\t]+/g, ' ').slice(0, limit);
}

export function canonicalBankCode(value) {
  const normalized = clean(value, 60).toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (normalized.includes('BCA') || normalized.includes('CENTRALASIA')) return 'BCA';
  if (normalized.includes('MANDIRI')) return 'MANDIRI';
  if (normalized.includes('BRI') || normalized.includes('RAKYATINDONESIA')) return 'BRI';
  if (normalized.includes('BNI') || normalized.includes('NEGARAINDONESIA')) return 'BNI';
  return 'OTHER';
}

export function canonicalInstructionLines(lines) {
  return [...lines].map((line) => ({
    employeeId: clean(line.employeeId, 120),
    beneficiaryName: clean(line.beneficiaryName, 140),
    bankCode: canonicalBankCode(line.bankCode || line.bankName),
    bankName: clean(line.bankName, 100),
    accountNumber: clean(line.accountNumber, 40).replace(/\s+/g, ''),
    amount: Number(line.amount),
  })).sort((a, b) => a.employeeId.localeCompare(b.employeeId) || a.accountNumber.localeCompare(b.accountNumber));
}

export async function sha256Hex(value) {
  return hex(await crypto.subtle.digest('SHA-256', encoder.encode(String(value))));
}

export async function instructionContentHash(metadata, lines) {
  const canonical = {
    organizationId: clean(metadata.organizationId, 120), clientId: clean(metadata.clientId, 120),
    submissionId: clean(metadata.submissionId, 120), payrollPeriod: clean(metadata.payrollPeriod, 7),
    paymentPeriod: clean(metadata.paymentPeriod, 7), currency: 'IDR',
    lines: canonicalInstructionLines(lines),
  };
  return sha256Hex(JSON.stringify(canonical));
}

async function encryptionKey(secret) {
  if (!secret || String(secret).length < 32) throw new Error('PI_ENCRYPTION_KEY must contain at least 32 characters');
  const material = await crypto.subtle.digest('SHA-256', encoder.encode(String(secret)));
  return crypto.subtle.importKey('raw', material, 'AES-GCM', false, ['encrypt','decrypt']);
}

export async function encryptAccountNumber(accountNumber, secret) {
  const value = clean(accountNumber, 40).replace(/\s+/g, '');
  if (!/^\d{6,34}$/.test(value)) throw new Error('Invalid beneficiary account number');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name:'AES-GCM', iv }, await encryptionKey(secret), encoder.encode(value));
  return { ciphertext:bytesToBase64(new Uint8Array(cipher)), iv:bytesToBase64(iv), last4:value.slice(-4) };
}

export async function decryptAccountNumber(ciphertext, iv, secret) {
  const plain = await crypto.subtle.decrypt({ name:'AES-GCM', iv:base64ToBytes(iv) }, await encryptionKey(secret), base64ToBytes(ciphertext));
  return decoder.decode(plain);
}

function csvCell(value, delimiter) {
  const text = clean(value, 200);
  return /["\r\n,;]/.test(text) || text.includes(delimiter) ? `"${text.replaceAll('"','""')}"` : text;
}

export function generateBankFile(format, lines, metadata = {}) {
  const bank = BANKS[String(format || '').toUpperCase()] || BANKS.CUSTOM;
  const code = String(format || 'CUSTOM').toUpperCase();
  const remark = clean(metadata.remark || `PAYROLL ${metadata.paymentPeriod || ''}`, 100);
  const rows = lines.map((line) => code === 'CUSTOM'
    ? [line.bankCode, line.accountNumber, line.beneficiaryName, line.amount, remark]
    : [line.accountNumber, line.beneficiaryName, line.amount, remark]);
  const content = [bank.header, ...rows].map((row) => row.map((value) => csvCell(value, bank.delimiter)).join(bank.delimiter)).join('\r\n');
  return { content:`\uFEFF${content}\r\n`, mimeType:'text/csv; charset=utf-8', extension:'csv' };
}

function pdfEscape(value) {
  return clean(value, 240).replaceAll('\\','\\\\').replaceAll('(','\\(').replaceAll(')','\\)');
}

export function generateInstructionPdf(instruction, lines, approvals = []) {
  const pageLines = 42;
  const detail = lines.map((line, index) => `${String(index + 1).padStart(4)}  ${line.beneficiaryName.slice(0,28).padEnd(28)}  ${line.bankCode.padEnd(8)}  ****${line.accountLast4}  ${Number(line.amount).toLocaleString('id-ID')}`);
  const header = [
    'PROQPAY LITE - PAYMENT INSTRUCTION',
    `Document No : ${instruction.document_no || instruction.id}`,
    `Client      : ${instruction.client_name || instruction.client_id}`,
    `Project     : ${instruction.project_name || '-'}`,
    `Payroll     : ${instruction.payroll_period || '-'}    Payment: ${instruction.payment_period || '-'}`,
    `Recipients  : ${lines.length}    Total: IDR ${Number(instruction.expected_total).toLocaleString('id-ID')}`,
    `Status      : ${instruction.status}`,
    `Content Hash: ${instruction.content_hash}`,
    '', 'No.   Beneficiary                   Bank      Account       Amount',
  ];
  const approval = ['', 'APPROVAL TRAIL', ...approvals.map((item) => `${item.status} - ${item.approver_email || item.approver_user_id} - ${new Date(item.created_at).toISOString()}`)];
  const all = [...header, ...detail, ...approval];
  const pages = [];
  for (let offset = 0; offset < all.length; offset += pageLines) pages.push(all.slice(offset, offset + pageLines));
  const objects = [];
  const add = (body) => { objects.push(body); return objects.length; };
  const catalogId = add('');
  const pagesId = add('');
  const fontId = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const pageIds = [];
  for (const page of pages) {
    const commands = ['BT','/F1 9 Tf','42 800 Td','11 TL', ...page.flatMap((line) => [`(${pdfEscape(line)}) Tj`,'T*']), 'ET'].join('\n');
    const streamId = add(`<< /Length ${encoder.encode(commands).length} >>\nstream\n${commands}\nendstream`);
    pageIds.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${streamId} 0 R >>`));
  }
  objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;
  let output = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((body, index) => { offsets.push(encoder.encode(output).length); output += `${index + 1} 0 obj\n${body}\nendobj\n`; });
  const xref = encoder.encode(output).length;
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((item) => `${String(item).padStart(10,'0')} 00000 n `).join('\n')}\n`;
  output += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return encoder.encode(output);
}

export function controlTotals(lines) {
  return { recipientCount:lines.length, totalAmount:lines.reduce((sum, line) => sum + Number(line.amount || 0), 0) };
}
