export type ApprovalPreview = {
  planId: string;
  payrollId: string;
  period: string;
  currentStatus: string;
  nextStatus: 'APPROVED';
  employeeCount: number;
  totalNet: number;
  validationErrors: number;
  actorEmail: string;
  actorRole: string;
};

export function buildApprovalPreview(
  payroll: any,
  validationErrors: number,
  planId: string,
  actor: { email?: string; role?: string }
): ApprovalPreview {
  return {
    planId,
    payrollId: String(payroll.id),
    period: String(payroll.period),
    currentStatus: String(payroll.status),
    nextStatus: 'APPROVED',
    employeeCount: Number(payroll.summary?.employeeCount || 0),
    totalNet: Number(payroll.summary?.totalNet || 0),
    validationErrors: Number(validationErrors || 0),
    actorEmail: String(actor.email || 'unknown@local'),
    actorRole: String(actor.role || 'CLIENT_USER'),
  };
}

export function applyApproval(
  db: any,
  preview: ApprovalPreview,
  timestamp = Date.now()
): { db: any; alreadyApplied: boolean } {
  const payroll = (db.payrolls || []).find((item: any) => item.id === preview.payrollId);
  const existing = (db.approvals || []).find(
    (item: any) => item.payrollId === preview.payrollId && item.status === 'APPROVED'
  );
  if (payroll?.status === 'APPROVED' || existing) {
    return { db, alreadyApplied: true };
  }
  if (!payroll || payroll.status !== preview.currentStatus || preview.currentStatus !== 'CALCULATED') {
    throw new Error('Payroll berubah sejak preview dibuat. Buat preview approval baru.');
  }
  return {
    alreadyApplied: false,
    db: {
      ...db,
      payrolls: db.payrolls.map((item: any) =>
        item.id === preview.payrollId ? { ...item, status: 'APPROVED' } : item
      ),
      approvals: [
        ...(db.approvals || []),
        {
          id: `APR-${preview.planId}`,
          payrollId: preview.payrollId,
          period: preview.period,
          approvedBy: preview.actorEmail,
          status: 'APPROVED',
          approvedAt: timestamp,
        },
      ],
      auditLogs: [
        ...(db.auditLogs || []),
        {
          id: `LOG-APPROVAL-${preview.planId}`,
          timestamp,
          user: preview.actorEmail,
          role: preview.actorRole,
          action: 'PAYROLL_APPROVED',
          detail: `${preview.period} · plan ${preview.planId}`,
          entity: 'Payroll',
          entityId: preview.payrollId,
        },
      ],
    },
  };
}
