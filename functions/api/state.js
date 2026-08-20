import { d1All, hasD1 } from './_d1.js';
import { authorize, enforceRateLimit, handlePreflight, publicError, secureJson } from './_security.js';

const METHODS='GET, POST, OPTIONS';
function time(value) { const date=value?new Date(value):null; return date&&!Number.isNaN(date.getTime())?date.getTime():null; }
function json(value) { try { return JSON.parse(value||'[]'); } catch { return []; } }

export async function onRequest({request,env}) {
  if (request.method==='OPTIONS') return handlePreflight(request,env,METHODS);
  if (!['GET','POST'].includes(request.method)) return secureJson({error:'Method not allowed'},405,request,env,METHODS);
  const authorization=await authorize(request,env,{roles:['SUPER_ADMIN','PAYROLL_PROCESSOR','PAYROLL_CONTROLLER'],mutating:request.method==='POST',methods:METHODS});
  if (authorization.response) return authorization.response;
  const limited=await enforceRateLimit(request,env,authorization.actor,'business-state',METHODS);
  if (limited) return limited;
  const respond=(data,status=200)=>secureJson(data,status,request,env,METHODS),requestId=crypto.randomUUID();
  if (!hasD1(env)) return respond({error:'Cloudflare D1 belum terhubung',requestId},503);
  if (request.method==='POST') return respond({
    error:'Sinkronisasi state legacy telah dinonaktifkan. Gunakan API payroll, Payment Instruction, dan billing yang transaksional.',
    code:'LEGACY_STATE_WRITE_DISABLED',
  },410);
  const organizationId=String(env.DEFAULT_ORG_ID||'ORG-OTSINDO');
  try {
    const [payrolls,approvals,invoices,arMonitor,auditLogs]=await Promise.all([
      d1All(env.DB,`SELECT s.id,s.period,s.state AS status,s.created_at,
        COALESCE((SELECT COUNT(*) FROM employees e JOIN employee_compensation ec ON ec.employee_id=e.id
          WHERE e.client_id=s.client_id AND (s.project_id IS NULL OR e.project_id=s.project_id) AND ec.payroll_source_period=s.period),0) AS employee_count,
        COALESCE((SELECT SUM(ec.imported_gross) FROM employees e JOIN employee_compensation ec ON ec.employee_id=e.id
          WHERE e.client_id=s.client_id AND (s.project_id IS NULL OR e.project_id=s.project_id) AND ec.payroll_source_period=s.period),0) AS total_gross,
        COALESCE((SELECT SUM(ec.imported_deduction) FROM employees e JOIN employee_compensation ec ON ec.employee_id=e.id
          WHERE e.client_id=s.client_id AND (s.project_id IS NULL OR e.project_id=s.project_id) AND ec.payroll_source_period=s.period),0) AS total_deduction,
        COALESCE((SELECT SUM(ec.imported_net) FROM employees e JOIN employee_compensation ec ON ec.employee_id=e.id
          WHERE e.client_id=s.client_id AND (s.project_id IS NULL OR e.project_id=s.project_id) AND ec.payroll_source_period=s.period),0) AS total_net
        FROM payroll_submissions s WHERE s.org_id=? ORDER BY s.period DESC,s.created_at DESC LIMIT 120`,[organizationId]),
      d1All(env.DB,`SELECT pa.id,pi.submission_id AS payroll_id,s.period,au.email AS approved_by,
        pa.status,pa.created_at AS approved_at FROM payment_approvals pa JOIN payment_instructions pi ON pi.id=pa.payment_instruction_id
        JOIN payroll_submissions s ON s.id=pi.submission_id LEFT JOIN app_users au ON au.id=pa.approver_user_id
        WHERE pi.org_id=? ORDER BY pa.created_at DESC LIMIT 500`,[organizationId]),
      d1All(env.DB,`SELECT i.*,COALESCE(c.name,i.company) AS resolved_company FROM invoices i
        LEFT JOIN clients c ON c.id=i.client_id WHERE i.org_id=? ORDER BY (i.issued_at IS NULL),i.issued_at DESC LIMIT 500`,[organizationId]),
      d1All(env.DB,'SELECT * FROM ar_monitor WHERE org_id=? ORDER BY due_date DESC LIMIT 500',[organizationId]),
      d1All(env.DB,'SELECT * FROM audit_logs WHERE org_id=? ORDER BY timestamp DESC LIMIT 500',[organizationId]),
    ]);
    return respond({ok:true,state:{
      payrolls:payrolls.map((p)=>({id:p.id,period:p.period,status:p.status,createdAt:time(p.created_at),summary:{employeeCount:Number(p.employee_count),totalGross:Number(p.total_gross),totalDeduction:Number(p.total_deduction),totalNet:Number(p.total_net)},details:[]})),
      approvals:approvals.map((a)=>({id:a.id,payrollId:a.payroll_id,period:a.period,approvedBy:a.approved_by,status:a.status,approvedAt:time(a.approved_at)})),
      payments:[],
      invoices:invoices.map((i)=>({id:i.id,company:i.resolved_company||i.client_id||'Client',period:i.period,amount:Number(i.amount),taxAmount:Number(i.tax_amount),totalAmount:Number(i.total_amount),status:i.status,issuedAt:time(i.issued_at),paidAt:time(i.paid_at),items:json(i.items)})),
      arMonitor:arMonitor.map((a)=>({id:a.id,company:a.company,invoiceId:a.invoice_id,amount:Number(a.amount),status:a.status,dueDate:time(a.due_date),daysOverdue:a.days_overdue,type:a.type,notes:a.notes})),
      auditLogs:auditLogs.map((a)=>({id:a.id,timestamp:time(a.timestamp),user:a.username,role:a.role,action:a.action,detail:a.detail,entity:a.entity,entityId:a.entity_id})),
    }});
  } catch(error) { return respond(publicError(error,requestId),500); }
}
