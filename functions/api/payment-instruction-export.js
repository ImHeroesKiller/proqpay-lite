import { d1All, d1First, d1Run, hasD1 } from './_d1.js';
import { authorize, enforceRateLimit, handlePreflight, secureJson } from './_security.js';
import {
  decryptAccountNumber, generateBankFile, generateInstructionPdf, instructionContentHash,
} from './payment-instruction-core.js';

const METHODS = 'GET, OPTIONS';
const ROLES = ['SUPER_ADMIN','PAYROLL_CONTROLLER'];

function orgId(env) { return String(env.DEFAULT_ORG_ID || 'ORG-OTSINDO'); }
function safeFilename(value) { return String(value || 'payment-instruction').replace(/[^A-Za-z0-9._-]+/g,'-').slice(0,120); }

export async function onRequest(context) {
  const {request,env} = context;
  if (request.method === 'OPTIONS') return handlePreflight(request,env,METHODS);
  if (request.method !== 'GET') return secureJson({error:'Method not allowed'},405,request,env,METHODS);
  const authorization = await authorize(request,env,{roles:ROLES,methods:METHODS});
  if (authorization.response) return authorization.response;
  const limited = await enforceRateLimit(request,env,authorization.actor,'payment-instruction-export',METHODS);
  if (limited) return limited;
  const respond = (data,status=200) => secureJson(data,status,request,env,METHODS);
  if (!hasD1(env)) return respond({error:'Cloudflare D1 unavailable'},503);
  const params = new URL(request.url).searchParams;
  const id = params.get('id');
  const format = String(params.get('format') || 'PDF').toUpperCase();
  if (!id || !/^[A-Za-z0-9._:-]{1,120}$/.test(id)) return respond({error:'Payment instruction ID tidak valid'},422);
  if (!['PDF','BCA','MANDIRI','BRI','BNI','CUSTOM'].includes(format)) return respond({error:'Format export tidak didukung'},422);
  const instruction = await d1First(env.DB, `SELECT pi.*,s.period AS payroll_period,COALESCE(s.payment_period,s.period) AS payment_period,
      c.name AS client_name,p.name AS project_name
    FROM payment_instructions pi JOIN payroll_submissions s ON s.id=pi.submission_id
    JOIN clients c ON c.id=pi.client_id LEFT JOIN projects p ON p.id=s.project_id
    WHERE pi.id=? AND pi.org_id=? LIMIT 1`, [id, orgId(env)]);
  if (!instruction) return respond({error:'Payment instruction tidak ditemukan'},404);
  if (!['PAYMENT_APPROVAL_PENDING','APPROVED_FOR_PAYMENT','DISBURSEMENT_PROCESSING','PROOF_UPLOADED','COMPLETED'].includes(instruction.status)) {
    return respond({error:'Payment instruction belum dapat diekspor'},409);
  }
  const lines = await d1All(env.DB, 'SELECT * FROM payment_instruction_lines WHERE payment_instruction_id=? ORDER BY employee_id,id', [id]);
  const approvals = await d1All(env.DB, `SELECT pa.*,au.email AS approver_email FROM payment_approvals pa
    LEFT JOIN app_users au ON au.id=pa.approver_user_id WHERE pa.payment_instruction_id=? ORDER BY pa.created_at`, [id]);
  if (format === 'PDF') {
    const pdf = generateInstructionPdf(instruction,lines.map((line) => ({...line,accountLast4:line.account_last4 || String(line.masked_account).slice(-4)})),approvals);
    return new Response(pdf,{status:200,headers:{'Content-Type':'application/pdf','Content-Disposition':`attachment; filename="${safeFilename(instruction.document_no || id)}.pdf"`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
  }
  if (!['APPROVED_FOR_PAYMENT','DISBURSEMENT_PROCESSING','PROOF_UPLOADED','COMPLETED'].includes(instruction.status)) {
    return respond({error:'File bank hanya tersedia setelah Payment Instruction disetujui'},409);
  }
  if (!env.PI_ENCRYPTION_KEY || String(env.PI_ENCRYPTION_KEY).length < 32) return respond({error:'PI_ENCRYPTION_KEY belum dikonfigurasi'},503);
  if (!instruction.content_hash || lines.some((line) => !line.account_ciphertext || !line.account_iv)) {
    return respond({error:'Snapshot PI lama tidak memiliki data rekening terenkripsi; regenerasi PI diperlukan'},409);
  }
  const decrypted = await Promise.all(lines.map(async (line) => ({
    employeeId:line.employee_id,beneficiaryName:line.beneficiary_name,bankName:line.bank_name,bankCode:line.bank_code,
    accountNumber:await decryptAccountNumber(line.account_ciphertext,line.account_iv,env.PI_ENCRYPTION_KEY),amount:Number(line.amount),
  })));
  const actualHash = await instructionContentHash({organizationId:instruction.org_id,clientId:instruction.client_id,
    submissionId:instruction.submission_id,payrollPeriod:instruction.payroll_period,paymentPeriod:instruction.payment_period},decrypted);
  if (actualHash !== instruction.content_hash) return respond({error:'Integritas snapshot PI gagal diverifikasi; export diblokir'},409);
  const file = generateBankFile(format,decrypted,{paymentPeriod:instruction.payment_period,remark:`PAYROLL ${instruction.payment_period}`});
  await d1Run(env.DB, `INSERT INTO audit_logs(id,org_id,username,role,action,detail,entity,entity_id)
    VALUES(?,?,?,?,'PAYMENT_BANK_FILE_EXPORTED',?,'payment_instruction',?)`,
    [`AUD-${crypto.randomUUID()}`, instruction.org_id, authorization.actor.email, authorization.actor.role,
      `${format} · ${instruction.content_hash}`, id]);
  return new Response(file.content,{status:200,headers:{'Content-Type':file.mimeType,
    'Content-Disposition':`attachment; filename="${safeFilename(instruction.document_no || id)}-${format}.${file.extension}"`,
    'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
}
