import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canonicalBankCode, controlTotals, decryptAccountNumber, encryptAccountNumber,
  generateBankFile, generateInstructionPdf, instructionContentHash, sha256Hex,
} from '../functions/api/payment-instruction-core.js';

const secret = 'uat-payment-instruction-key-2026-abcdefghijklmnopqrstuvwxyz';

function recipients(count = 396) {
  const banks = ['BCA','Bank Mandiri','BRI','BNI'];
  return Array.from({length:count},(_,index) => ({
    employeeId:`EMP-${String(index + 1).padStart(4,'0')}`,
    beneficiaryName:`KARYAWAN ${String(index + 1).padStart(4,'0')}`,
    bankName:banks[index % banks.length],
    accountNumber:`12${String(1000000000 + index)}`,
    amount:4_000_000 + index,
  }));
}

test('canonical PI processes 396 recipients through immutable snapshot and bank exports', async () => {
  const source = recipients();
  const metadata = {organizationId:'ORG-OTSINDO',clientId:'CLI-QJOB',submissionId:'SUB-2026-08',payrollPeriod:'2026-08',paymentPeriod:'2026-08'};
  const contentHash = await instructionContentHash(metadata,source);
  assert.match(contentHash,/^[a-f0-9]{64}$/);
  const snapshot = await Promise.all(source.map(async (line) => {
    const encrypted = await encryptAccountNumber(line.accountNumber,secret);
    return {...line,bankCode:canonicalBankCode(line.bankName),accountCiphertext:encrypted.ciphertext,accountIv:encrypted.iv,accountLast4:encrypted.last4,lineHash:await sha256Hex(JSON.stringify(line))};
  }));
  assert.equal(new Set(snapshot.map((line) => line.accountCiphertext)).size,396);
  const decrypted = await Promise.all(snapshot.map(async (line) => ({...line,accountNumber:await decryptAccountNumber(line.accountCiphertext,line.accountIv,secret)})));
  assert.deepEqual(decrypted.map((line) => line.accountNumber),source.map((line) => line.accountNumber));
  const totals = controlTotals(decrypted);
  assert.equal(totals.recipientCount,396);
  assert.equal(totals.totalAmount,source.reduce((sum,line) => sum + line.amount,0));
  assert.equal(await instructionContentHash(metadata,decrypted),contentHash);
  for (const bank of ['BCA','MANDIRI','BRI','BNI','CUSTOM']) {
    const file = generateBankFile(bank,decrypted,{paymentPeriod:'2026-08'});
    assert.equal(file.content.trim().split(/\r?\n/).length,397);
    assert.match(file.mimeType,/text\/csv/);
  }
  const pdf = generateInstructionPdf({id:'PI-UAT',document_no:'PI/202608/UAT',client_name:'PT QJOB SAKA GEMILANG',project_name:'Payroll',payroll_period:'2026-08',payment_period:'2026-08',expected_total:totals.totalAmount,status:'APPROVED_FOR_PAYMENT',content_hash:contentHash},snapshot.map((line) => ({...line,account_last4:line.accountLast4,bank_code:line.bankCode,beneficiary_name:line.beneficiaryName,employee_id:line.employeeId})),[{id:'PA-1',status:'APPROVED',approver_email:'checker@proqpay.id',created_at:'2026-08-20T00:00:00.000Z'}]);
  assert.equal(new TextDecoder().decode(pdf.slice(0,8)),'%PDF-1.4');
  assert.ok(pdf.byteLength > 10_000);
});

test('content hash blocks changed beneficiary account or amount after preview', async () => {
  const source = recipients(3);
  const metadata = {organizationId:'ORG-OTSINDO',clientId:'CLI-QJOB',submissionId:'SUB-1',payrollPeriod:'2026-08',paymentPeriod:'2026-08'};
  const approvedHash = await instructionContentHash(metadata,source);
  assert.notEqual(await instructionContentHash(metadata,source.map((line,index) => index ? line : {...line,amount:line.amount + 1})),approvedHash);
  assert.notEqual(await instructionContentHash(metadata,source.map((line,index) => index ? line : {...line,accountNumber:'999999999999'})),approvedHash);
});

test('account encryption fails closed with weak keys and invalid account data', async () => {
  await assert.rejects(() => encryptAccountNumber('1234567890','weak'),/32 characters/);
  await assert.rejects(() => encryptAccountNumber('rekening-invalid',secret),/Invalid beneficiary/);
});
