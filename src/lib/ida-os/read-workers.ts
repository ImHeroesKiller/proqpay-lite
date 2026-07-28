import { validatePayrollIndonesia } from '../payroll-validate';
import type { ExecutionPlan, WorkerResult } from './contracts';
import { assertWorkerTableAccess } from './worker-registry';

const EMPTY_RESULT = {
  calculations: [],
  warnings: [],
  errors: [],
  businessRules: [],
  suggestedActions: [],
  requiresConfirmation: false,
};

export function executeReadOnlyPlan(plan: ExecutionPlan, db: any): WorkerResult {
  if (plan.risk !== 'READ') {
    throw new Error(`Read-only executor menolak plan ${plan.risk}.`);
  }
  const task = plan.tasks[0];
  if (!task) throw new Error('Execution plan tidak memiliki task.');

  if (task.worker === 'COMPLIANCE') {
    const tables = ['payrolls', 'payroll_lines', 'payroll_rules'];
    const access = assertWorkerTableAccess('COMPLIANCE', ['provinces', 'regulatory_knowledge']);
    if (!access.allowed) throw new Error(access.blockers.join(' '));
    const report = validatePayrollIndonesia(db, { period: task.context.payrollPeriod });
    return {
      ...EMPTY_RESULT,
      worker: 'COMPLIANCE',
      facts: [
        `${report.errorCount} error`,
        `${report.warningCount} warning`,
        `${report.infoCount} info`,
      ],
      warnings: report.issues
        .filter((issue) => issue.severity === 'warning')
        .slice(0, 20)
        .map((issue) => issue.message),
      errors: report.issues
        .filter((issue) => issue.severity === 'error')
        .slice(0, 20)
        .map((issue) => issue.message),
      evidence: [
        {
          source: 'BUSINESS_SERVICE',
          service: 'validatePayrollIndonesia',
          description: `Validasi deterministik periode ${task.context.payrollPeriod || '-'}.`,
        },
        {
          source: 'REGULATION',
          table: 'provinces',
          description: 'Referensi wilayah dan upah minimum.',
        },
      ],
      sourceTables: tables,
      businessRules: ['Payment instruction diblokir selama error validasi masih ada.'],
      suggestedActions: report.ok ? ['Lanjutkan workflow payroll.'] : ['Perbaiki error sebelum payment instruction.'],
    };
  }

  if (task.worker === 'PAYROLL') {
    const tables = ['payrolls', 'payroll_lines'];
    const access = assertWorkerTableAccess('PAYROLL', tables);
    if (!access.allowed) throw new Error(access.blockers.join(' '));
    const payroll = (db.payrolls || []).find(
      (item: any) => item.period === task.context.payrollPeriod
    );
    return {
      ...EMPTY_RESULT,
      worker: 'PAYROLL',
      facts: payroll
        ? [`Payroll ${payroll.period} berstatus ${payroll.status}.`]
        : [`Payroll ${task.context.payrollPeriod || '-'} belum tersedia.`],
      evidence: [{
        source: 'DATABASE',
        table: 'payrolls',
        recordIds: payroll?.id ? [payroll.id] : [],
        description: 'State payroll aktif dari database mirror canonical.',
      }],
      sourceTables: tables,
      suggestedActions: payroll ? [] : ['Hitung payroll setelah data master tervalidasi.'],
    };
  }

  if (task.worker === 'HR') {
    const tables = ['employees', 'employee_contracts', 'employee_assignments'];
    const access = assertWorkerTableAccess('HR', tables);
    if (!access.allowed) throw new Error(access.blockers.join(' '));
    return {
      ...EMPTY_RESULT,
      worker: 'HR',
      facts: [`${db.employees?.length || 0} karyawan ditemukan.`],
      evidence: [{
        source: 'DATABASE',
        table: 'employees',
        recordIds: (db.employees || []).slice(0, 100).map((item: any) => String(item.id)),
        description: 'Data karyawan dari database mirror canonical.',
      }],
      sourceTables: tables,
    };
  }

  if (task.worker === 'OPERATIONS') {
    const tables = ['clients', 'projects'];
    const access = assertWorkerTableAccess('OPERATIONS', tables);
    if (!access.allowed) throw new Error(access.blockers.join(' '));
    return {
      ...EMPTY_RESULT,
      worker: 'OPERATIONS',
      facts: [
        `${db.companies?.length || 0} klien ditemukan.`,
        `${db.projects?.length || 0} proyek ditemukan.`,
      ],
      evidence: [{
        source: 'DATABASE',
        table: 'clients',
        recordIds: (db.companies || []).map((item: any) => String(item.id)),
        description: 'Data klien dan proyek dari database mirror canonical.',
      }],
      sourceTables: tables,
    };
  }

  if (task.worker === 'FINANCE') {
    const tables = ['ar_monitor', 'invoices', 'payments'];
    const access = assertWorkerTableAccess('FINANCE', tables);
    if (!access.allowed) throw new Error(access.blockers.join(' '));
    const outstanding = (db.arMonitor || []).filter((item: any) => item.status === 'OUTSTANDING');
    return {
      ...EMPTY_RESULT,
      worker: 'FINANCE',
      facts: [`${outstanding.length} piutang outstanding ditemukan.`],
      evidence: [{
        source: 'DATABASE',
        table: 'ar_monitor',
        recordIds: outstanding.map((item: any) => String(item.id)),
        description: 'Posisi piutang dari database mirror canonical.',
      }],
      sourceTables: tables,
    };
  }

  return {
    ...EMPTY_RESULT,
    worker: task.worker,
    facts: ['Dokumen belum tersedia dalam context task.'],
    evidence: [{
      source: 'DOCUMENT',
      description: 'Tidak ada dokumen aktif yang diteruskan ke worker.',
    }],
    sourceTables: [],
  };
}
