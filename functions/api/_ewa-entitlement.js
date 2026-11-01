import { d1First } from './_d1.js';

export async function loadEwaSalary(db, employeeId, orgId, clientId) {
  const line = await d1First(db, `SELECT l.net_amount,s.period,s.id FROM payroll_run_lines l
    JOIN payroll_submissions s ON s.id=l.submission_id
    WHERE l.employee_id=? AND l.included=1 AND s.org_id=? AND s.client_id=?
      AND EXISTS(SELECT 1 FROM payment_instructions pi JOIN reconciliations r ON r.payment_instruction_id=pi.id
        WHERE pi.submission_id=s.id AND pi.status='COMPLETED' AND r.status='MATCHED')
    ORDER BY s.period DESC,s.created_at DESC,s.id DESC LIMIT 1`, [employeeId,orgId,clientId]);
  const imported = await d1First(db, 'SELECT imported_net,payroll_source_period FROM employee_compensation WHERE employee_id=?', [employeeId]);
  if ((!line || String(imported?.payroll_source_period)>String(line.period)) && Number(imported?.imported_net)>0 && /^\d{4}-(0[1-9]|1[0-2])$/.test(String(imported?.payroll_source_period || ''))) {
    return {salary:Number(imported.imported_net),period:imported.payroll_source_period,source:'IMPORTED_PAYROLL'};
  }
  if (line && Number(line.net_amount)>0) return {salary:Number(line.net_amount),period:line.period,source:'FINAL_PAYROLL'};
  return {salary:0,period:null,source:'MISSING'};
}

export async function employeeEwaConfiguration(db, employeeId, orgId, clientId) {
  const settings = await d1First(db, 'SELECT * FROM ewa_employee_settings WHERE employee_id=? AND org_id=? AND client_id=?', [employeeId,orgId,clientId]);
  let basis = await loadEwaSalary(db,employeeId,orgId,clientId);
  if(settings?.salary_mode==='MANUAL') basis={salary:Number(settings.manual_salary || 0),period:settings.manual_period,source:'MANUAL_CONFIRMED'};
  const limit = !settings ? 0 : settings.limit_mode==='FIXED' ? Number(settings.fixed_limit) : Math.floor(basis.salary*Number(settings.limit_percent)/10000)*10000;
  return {settings,basis,limit:Math.max(0,limit),enabled:Boolean(settings?.enabled)};
}

export function configuredEwaPolicy(policy, configuration) {
  // Enrollment replaces calendar proration and join-date gates. Fees remain centrally configured.
  return {...policy,enabled:configuration.enabled?1:0,min_days_worked:0,min_tenure_days:0,min_tenure_months:0};
}
