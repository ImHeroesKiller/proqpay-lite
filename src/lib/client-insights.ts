import { validatePayrollIndonesia } from './payroll-validate';

export type ClientInsight = { icon: string; text: string };

export function buildClientInsights(db: any, selected: string): ClientInsight[] {
  const employees = (db.employees || []).filter((employee: any) => employee.company === selected);
  const company = (db.companies || []).find((item: any) => item.name === selected);
  const invoice = (db.invoices || []).find((item: any) => item.company === selected);
  const ar = (db.arMonitor || []).find(
    (item: any) => item.company === selected && item.status === 'OUTSTANDING'
  );
  const scopedDb = {
    ...db,
    employees,
    companies: company ? [company] : [],
  };
  const validation = validatePayrollIndonesia(scopedDb, { period: db.meta?.currentPeriod });
  const insights: ClientInsight[] = [];

  if (!company?.payrollSetup) insights.push({ icon: '⚙️', text: `Payroll belum di-setup untuk ${selected}.` });
  if (validation.errorCount > 0) {
    insights.push({
      icon: '⛔',
      text: `${validation.errorCount} error validasi masih memblokir proses payroll.`,
    });
  }
  if (validation.warningCount > 0) {
    insights.push({
      icon: '⚠️',
      text: `${validation.warningCount} warning data perlu ditinjau.`,
    });
  }
  if (invoice && invoice.status !== 'PAID') {
    insights.push({ icon: '📄', text: `Invoice ${invoice.id} berstatus ${invoice.status}.` });
  }
  if (ar) insights.push({ icon: '⏳', text: 'Terdapat AR outstanding yang perlu ditindaklanjuti.' });
  if (insights.length === 0) {
    insights.push({ icon: '✨', text: 'Validasi data tidak menemukan masalah yang memblokir.' });
  }
  return insights;
}
