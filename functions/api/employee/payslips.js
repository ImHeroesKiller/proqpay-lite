import { authenticateEmployee, employeeHandlePreflight, employeeJson } from '../_employee-auth.js';
import { d1All, hasD1 } from '../_d1.js';
import { periodToLabel, rowsFromRunLine } from '../_employee-init.js';
import { publicError } from '../_security.js';

const METHODS = 'GET, OPTIONS';

export async function onRequest({ request, env }) {
  if (request.method === 'OPTIONS') return employeeHandlePreflight(request, env, METHODS);
  if (request.method !== 'GET') return employeeJson({ error:'Method not allowed' },405,request,env,METHODS);
  if (!hasD1(env)) return employeeJson({ error:'Cloudflare D1 binding unavailable',code:'D1_REQUIRED' },503,request,env,METHODS);
  const actor = await authenticateEmployee(request, env);
  if (!actor) return employeeJson({ error:'Sesi tidak valid atau kedaluwarsa.' },401,request,env,METHODS);
  try {
    const lines = await d1All(env.DB, `SELECT l.net_amount,l.gross_amount,l.deduction_amount,l.components,l.source_batch_id,
      s.id AS submission_id,s.period,s.run_type,s.payment_period,s.created_at,
      pi.id AS payment_instruction_id,pi.document_no,pi.status AS pi_status,pi.execution_date,
      r.status AS reconciliation_status
      FROM payroll_run_lines l JOIN payroll_submissions s ON s.id=l.submission_id
      JOIN payment_instructions pi ON pi.submission_id=s.id
      JOIN reconciliations r ON r.payment_instruction_id=pi.id
      WHERE l.employee_id=? AND l.included=1 AND pi.status='COMPLETED' AND r.status='MATCHED'
      ORDER BY s.period DESC,s.created_at DESC LIMIT 36`, [actor.id]);
    const payslips = lines.map((line) => ({
      id: line.submission_id,
      submissionId: line.submission_id,
      periodKey: line.period,
      period: periodToLabel(line.period),
      runType: line.run_type || 'REGULAR',
      status: 'paid',
      documentNo: line.document_no || '',
      paymentInstructionId: line.payment_instruction_id,
      paymentDate: line.execution_date || '',
      gross: Number(line.gross_amount || 0),
      deductions: Number(line.deduction_amount || 0),
      net: Number(line.net_amount || 0),
      sourceBatchId: line.source_batch_id || null,
      rows: (() => { const rows=rowsFromRunLine(line); return rows.length?rows:[['Gaji bersih',Number(line.net_amount||0)]]; })(),
    }));
    return employeeJson({ ok:true,payslips },200,request,env,METHODS);
  } catch(error) {
    return employeeJson({ error:'Gagal memuat slip gaji final',...publicError(error,crypto.randomUUID()) },500,request,env,METHODS);
  }
}
