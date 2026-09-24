export const INACTIVE_EMPLOYEE_STATUSES = Object.freeze([
  'INACTIVE','NONACTIVE','NON-ACTIVE','NON AKTIF','NONAKTIF','TIDAK AKTIF',
  'RESIGN','RESIGNED','TERMINATED','KELUAR','BERHENTI','PHK','PENSIUN',
  'MENINGGAL','DECEASED','OFF','CANCELLED',
]);

export function normalizeEmployeeStatus(value) {
  return String(value ?? '').trim().toUpperCase().replace(/\s+/g,' ');
}

export function isActiveEmployeeStatus(value) {
  const normalized=normalizeEmployeeStatus(value);
  return !normalized || !INACTIVE_EMPLOYEE_STATUSES.includes(normalized);
}

export function activeEmployeeSql(alias='e') {
  const values=INACTIVE_EMPLOYEE_STATUSES.map((value)=>`'${value.replaceAll("'","''")}'`).join(',');
  return `UPPER(TRIM(COALESCE(${alias}.status_aktif,'ACTIVE'))) NOT IN (${values})`;
}
