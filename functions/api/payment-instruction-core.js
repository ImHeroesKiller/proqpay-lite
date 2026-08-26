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
  const normalized = lines.map((line, index) => {
    const beneficiary = clean(line.beneficiaryName ?? line.beneficiary_name ?? '-', 140);
    const bankCode = clean(line.bankCode ?? line.bank_code ?? line.bankName ?? line.bank_name ?? '-', 30);
    const last4 = clean(line.accountLast4 ?? line.account_last4 ?? line.masked_account ?? '----', 40).replace(/\D/g, '').slice(-4).padStart(4, '*');
    return { number:index + 1, beneficiary, bankCode, last4, amount:Number(line.amount || 0) };
  });
  const chunks = [];
  for (let offset = 0; offset < normalized.length; offset += 24) chunks.push(normalized.slice(offset, offset + 24));
  if (!chunks.length) chunks.push([]);
  const money = (value) => `Rp ${Number(value || 0).toLocaleString('id-ID')}`;
  const status = clean(instruction.status || '-', 50).replaceAll('_',' ');
  const clientConfirmation = instruction.status === 'PAYMENT_APPROVAL_PENDING';
  const objects = [];
  const add = (body) => { objects.push(body); return objects.length; };
  const catalogId = add('');
  const pagesId = add('');
  const fontId = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const boldFontId = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');
  const pageIds = [];
  const text = (x,y,value,size=9,bold=false,color='0.12 0.16 0.24') => `${color} rg BT /${bold?'F2':'F1'} ${size} Tf ${x} ${y} Td (${pdfEscape(value)}) Tj ET`;
  const rect = (x,y,w,h,color) => `${color} rg ${x} ${y} ${w} ${h} re f`;
  const line = (x1,y1,x2,y2,color='0.88 0.90 0.93',width=.6) => `${color} RG ${width} w ${x1} ${y1} m ${x2} ${y2} l S`;
  chunks.forEach((rows,pageIndex) => {
    const commands = [];
    commands.push(rect(0,758,595,84,'0.035 0.12 0.28'));
    commands.push(text(36,797,'Pro',24,true,'1 1 1'),text(73,797,'Q',24,true,'1 0.35 0.13'),text(91,797,'Pay',24,true,'1 1 1'));
    commands.push(text(36,778,'PAYMENT INSTRUCTION',8,true,'0.76 0.82 0.91'));
    commands.push(text(485,804,`PAGE ${pageIndex+1} / ${chunks.length}`,7,true,'0.76 0.82 0.91'));
    commands.push(text(430,781,clean(instruction.document_no || instruction.id),9,true,'1 1 1'));
    commands.push(text(36,724,clientConfirmation?'CLIENT CONFIRMATION COPY':'OFFICIAL PAYMENT INSTRUCTION',8,true,'1 0.35 0.13'));
    commands.push(text(36,700,clean(instruction.client_name || instruction.client_id),18,true));
    commands.push(text(36,682,`Project: ${clean(instruction.project_name || '-')}`,9,false,'0.38 0.43 0.52'));
    commands.push(rect(36,619,523,48,'0.96 0.97 0.985'));
    const metrics = [
      [50,'PAYROLL PERIOD',instruction.payroll_period || '-'],[174,'PAYMENT PERIOD',instruction.payment_period || '-'],
      [300,'RECIPIENTS',String(normalized.length)],[407,'CONTROL TOTAL',money(instruction.expected_total)],
    ];
    metrics.forEach(([x,label,value]) => { commands.push(text(x,649,label,7,true,'0.45 0.50 0.59')); commands.push(text(x,630,String(value),10,true)); });
    commands.push(text(36,594,'BENEFICIARY DETAILS',8,true,'0.45 0.50 0.59'));
    commands.push(rect(36,563,523,24,'0.035 0.12 0.28'));
    commands.push(text(48,572,'NO',7,true,'1 1 1'),text(78,572,'BENEFICIARY',7,true,'1 1 1'),text(320,572,'BANK',7,true,'1 1 1'),text(390,572,'ACCOUNT',7,true,'1 1 1'),text(478,572,'AMOUNT',7,true,'1 1 1'));
    let y = 544;
    rows.forEach((row,rowIndex) => {
      if (rowIndex % 2) commands.push(rect(36,y-7,523,20,'0.975 0.98 0.99'));
      commands.push(text(48,y,String(row.number),8),text(78,y,row.beneficiary.slice(0,40),8),text(320,y,row.bankCode.slice(0,12),8),text(390,y,`**** ${row.last4}`,8),text(478,y,money(row.amount),8,true));
      commands.push(line(36,y-9,559,y-9)); y -= 20;
    });
    if (pageIndex === chunks.length - 1) {
      const approvalY = Math.max(82,y-18);
      commands.push(text(36,approvalY,'DOCUMENT CONTROL',8,true,'0.45 0.50 0.59'));
      commands.push(line(36,approvalY-7,559,approvalY-7));
      commands.push(text(36,approvalY-23,`Status: ${status}`,8,true));
      commands.push(text(245,approvalY-23,`Approval trail: ${approvals.length} record(s)`,8));
      commands.push(text(36,approvalY-39,`Snapshot SHA-256: ${clean(instruction.content_hash || 'Not available',72)}`,6.5,false,'0.38 0.43 0.52'));
      if (clientConfirmation) commands.push(text(36,approvalY-55,'Please confirm beneficiary count and control total before internal PI approval.',7.5,true,'0.86 0.25 0.08'));
    }
    commands.push(line(36,44,559,44));
    commands.push(text(36,28,'Generated securely by ProQPay - Confidential payroll document',7,false,'0.45 0.50 0.59'));
    commands.push(text(430,28,clean(instruction.document_no || instruction.id),7,false,'0.45 0.50 0.59'));
    const content = commands.join('\n');
    const streamId = add(`<< /Length ${encoder.encode(content).length} >>\nstream\n${content}\nendstream`);
    pageIds.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${fontId} 0 R /F2 ${boldFontId} 0 R >> >> /Contents ${streamId} 0 R >>`));
  });
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
