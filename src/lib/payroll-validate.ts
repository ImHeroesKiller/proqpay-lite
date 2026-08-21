/**
 * ProQPay Lite — Validasi payroll Indonesia
 * Fokus regulasi & use-case operasional outsourcing/HRIS.
 *
 * Catatan: angka iuran/plafond disederhanakan untuk engine Lite;
 * update resmi bisa dilengkapi via IDA web search (domain whitelist).
 */

import { UMR_2025 } from './database';

export type Severity = 'error' | 'warning' | 'info';

export type ValidationIssue = {
  code: string;
  severity: Severity;
  employeeId?: string;
  employeeName?: string;
  message: string;
  regulation?: string;
};

export type ValidationReport = {
  ok: boolean;
  errorCount: number;
  warningCount: number;
  infoCount: number;
  issues: ValidationIssue[];
  summary: string;
};

export type PayrollServiceTier =
  | 'TIER_1_PAYMENT_PROCESSING'
  | 'TIER_2_MANAGED_PAYROLL'
  | 'TIER_3_INTEGRATED_AUTOMATION';

/** Plafond upah BPJS Kesehatan (perkiraan operasional; cek update resmi) */
const BPJS_KES_CEILING = 12_000_000;
/** Iuran pekerja BPJS Kesehatan */
const BPJS_KES_EMP = 0.01;
/** Iuran pemberi kerja BPJS Kesehatan */
const BPJS_KES_ER = 0.04;

/** JHT pekerja */
const JHT_EMP = 0.02;
/** JHT pemberi kerja */
const JHT_ER = 0.037;
/** JP pekerja (estimasi) */
const JP_EMP = 0.01;
/** JP pemberi kerja */
const JP_ER = 0.02;
/** JKK rata-rata risiko rendah */
const JKK_ER = 0.0024;
/** JKM */
const JKM_ER = 0.003;

function regionOf(emp: any): string {
  return emp.region || emp.province || emp.kotaUmk || emp.city_umk || '';
}

function umrFor(emp: any): number | null {
  const r = regionOf(emp);
  if (!r) return null;
  if (UMR_2025[r] != null) return UMR_2025[r];
  // fuzzy: match key contains / contained
  const key = Object.keys(UMR_2025).find(
    (k) => r.toLowerCase().includes(k.toLowerCase()) || k.toLowerCase().includes(r.toLowerCase())
  );
  return key ? UMR_2025[key] : null;
}

function grossOf(emp: any): number {
  const base = Number(emp.salaryGross ?? emp.basic_salary ?? 0) || 0;
  const t = Number(emp.allowanceTransport || 0) || 0;
  const m = Number(emp.allowanceMeal || 0) || 0;
  return base + t + m;
}

function hasBank(emp: any): boolean {
  return Boolean(emp.bankAccount || emp.bank_account || emp.accountNo || emp.rekening);
}

function hasNpwp(emp: any): boolean {
  const n = String(emp.npwp || emp.npwp_no || '').replace(/\D/g, '');
  return n.length >= 15;
}

function hasNik(emp: any): boolean {
  const n = String(emp.nik || emp.ktp || emp.ktp_no || '').replace(/\D/g, '');
  return n.length === 16;
}

/** Hitung iuran estimasi untuk sanity check */
export function estimateStatutory(emp: any) {
  const base = Number(emp.salaryGross ?? emp.basic_salary ?? 0) || 0;
  const kesBase = Math.min(base, BPJS_KES_CEILING);
  const bpjsKesEmp = emp.bpjsKesehatan === false ? 0 : Math.round(kesBase * BPJS_KES_EMP);
  const bpjsKesEr = emp.bpjsKesehatan === false ? 0 : Math.round(kesBase * BPJS_KES_ER);
  const jhtEmp = emp.bpjsKetenagakerjaan === false ? 0 : Math.round(base * JHT_EMP);
  const jhtEr = emp.bpjsKetenagakerjaan === false ? 0 : Math.round(base * JHT_ER);
  const jpEmp = emp.bpjsKetenagakerjaan === false ? 0 : Math.round(base * JP_EMP);
  const jpEr = emp.bpjsKetenagakerjaan === false ? 0 : Math.round(base * JP_ER);
  const jkk = emp.bpjsKetenagakerjaan === false ? 0 : Math.round(base * JKK_ER);
  const jkm = emp.bpjsKetenagakerjaan === false ? 0 : Math.round(base * JKM_ER);
  return {
    bpjsKesEmp,
    bpjsKesEr,
    jhtEmp,
    jhtEr,
    jpEmp,
    jpEr,
    jkk,
    jkm,
    employeeDeduction: bpjsKesEmp + jhtEmp + jpEmp,
    employerCost: bpjsKesEr + jhtEr + jpEr + jkk + jkm,
  };
}

/**
 * Validasi master + compliance sebelum / saat payroll.
 */
export function validatePayrollIndonesia(db: any, opts?: { period?: string; tier?: PayrollServiceTier; clientId?: string }): ValidationReport {
  const issues: ValidationIssue[] = [];
  const employees = (db.employees || []).filter((employee: any) => !opts?.clientId || employee.clientId === opts.clientId);
  const period = opts?.period || db.meta?.currentPeriod;
  const tier = opts?.tier || (db.servicePlans || []).find((plan: any) => plan.status === 'ACTIVE')?.tier;
  const paymentOnly = tier === 'TIER_1_PAYMENT_PROCESSING';

  if (!employees.length) {
    issues.push({
      code: 'NO_EMPLOYEES',
      severity: 'error',
      message: 'Tidak ada karyawan untuk diproses payroll.',
      regulation: 'Operasional',
    });
  }

  // Org-level
  if (!db.companies?.length) {
    issues.push({
      code: 'NO_CLIENT',
      severity: 'warning',
      message: 'Belum ada client/company — invoice outsourcing tidak bisa digenerate.',
      regulation: 'Use-case outsourcing',
    });
  }

  for (const emp of employees) {
    const name = emp.name || emp.id;
    const id = emp.id;
    const gross = grossOf(emp);
    const base = Number(emp.salaryGross ?? emp.basic_salary ?? 0) || 0;

    // 1) Identitas
    if (!paymentOnly && !hasNik(emp)) {
      issues.push({
        code: 'NIK_INVALID',
        severity: 'error',
        employeeId: id,
        employeeName: name,
        message: `${name}: NIK/KTP harus 16 digit (wajib e-KTP).`,
        regulation: 'Administrasi kependudukan / onboarding HR',
      });
    }

    // 2) Rekening untuk payment instruction
    if (!hasBank(emp)) {
      issues.push({
        code: 'BANK_MISSING',
        severity: 'error',
        employeeId: id,
        employeeName: name,
        message: `${name}: rekening bank kosong — tidak bisa masuk file transfer.`,
        regulation: 'Use-case payment instruction',
      });
    }

    // 3) Gaji pokok
    if (!paymentOnly && base <= 0) {
      issues.push({
        code: 'SALARY_ZERO',
        severity: 'error',
        employeeId: id,
        employeeName: name,
        message: `${name}: gaji pokok 0 / kosong.`,
        regulation: 'UU Ketenagakerjaan — pengupahan',
      });
    }

    // 4) UMR/UMK compliance
    const umr = umrFor(emp);
    if (!paymentOnly && umr && base > 0 && base < umr) {
      issues.push({
        code: 'BELOW_UMR',
        severity: 'error',
        employeeId: id,
        employeeName: name,
        message: `${name}: gaji pokok ${base.toLocaleString('id-ID')} di bawah UMR ${regionOf(emp) || 'wilayah'} (${umr.toLocaleString('id-ID')}).`,
        regulation: 'UU 13/2003 jo. peraturan pengupahan — upah minimum',
      });
    } else if (!paymentOnly && !umr && regionOf(emp)) {
      issues.push({
        code: 'UMR_UNKNOWN_REGION',
        severity: 'warning',
        employeeId: id,
        employeeName: name,
        message: `${name}: wilayah "${regionOf(emp)}" belum terpetakan ke tabel UMR 2025.`,
        regulation: 'Validasi UMR',
      });
    } else if (!paymentOnly && !regionOf(emp)) {
      issues.push({
        code: 'REGION_MISSING',
        severity: 'warning',
        employeeId: id,
        employeeName: name,
        message: `${name}: region/provinsi kosong — UMR tidak bisa dicek.`,
        regulation: 'Data master penempatan',
      });
    }

    // 5) NPWP vs PPh 21
    if (!paymentOnly && emp.pph21 !== false && !hasNpwp(emp)) {
      issues.push({
        code: 'NPWP_MISSING_PPH',
        severity: 'warning',
        employeeId: id,
        employeeName: name,
        message: `${name}: kena PPh 21 tetapi NPWP kosong — gunakan tarif lebih tinggi / data tidak lengkap.`,
        regulation: 'UU PPh / ketentuan potong pajak pegawai',
      });
    }

    // 6) BPJS flags vs status
    const status = String(emp.status || emp.status_aktif || '').toUpperCase();
    const aktif = !/BERHENTI|SELESAI|RESIGN|NONACTIVE|NON-AKTIF/.test(status);
    if (!paymentOnly && aktif && emp.bpjsKesehatan === false) {
      issues.push({
        code: 'BPJS_KES_OFF',
        severity: 'warning',
        employeeId: id,
        employeeName: name,
        message: `${name}: karyawan aktif tanpa BPJS Kesehatan.`,
        regulation: 'UU SJSN / BPJS Kesehatan — kepesertaan',
      });
    }
    if (!paymentOnly && aktif && emp.bpjsKetenagakerjaan === false) {
      issues.push({
        code: 'BPJS_TK_OFF',
        severity: 'warning',
        employeeId: id,
        employeeName: name,
        message: `${name}: karyawan aktif tanpa BPJS Ketenagakerjaan.`,
        regulation: 'UU 24/2011 — BPJS Ketenagakerjaan',
      });
    }

    // 7) Plafond awareness BPJS Kes
    if (!paymentOnly && base > BPJS_KES_CEILING && emp.bpjsKesehatan !== false) {
      issues.push({
        code: 'BPJS_KES_CEILING',
        severity: 'info',
        employeeId: id,
        employeeName: name,
        message: `${name}: gaji di atas plafond BPJS Kesehatan (Rp ${BPJS_KES_CEILING.toLocaleString('id-ID')}) — iuran dihitung dari plafond.`,
        regulation: 'Ketentuan iuran BPJS Kesehatan',
      });
    }

    // 8) Take-home sanity (potongan tidak > 50% gross kasar)
    const stat = estimateStatutory(emp);
    if (!paymentOnly && gross > 0 && stat.employeeDeduction / gross > 0.5) {
      issues.push({
        code: 'DEDUCTION_HIGH',
        severity: 'warning',
        employeeId: id,
        employeeName: name,
        message: `${name}: estimasi potongan statutory > 50% gross — cek data gaji/flag BPJS.`,
        regulation: 'Kontrol internal payroll',
      });
    }

    // 9) Email opsional tapi berguna untuk slip
    if (!paymentOnly && aktif && !emp.email) {
      issues.push({
        code: 'EMAIL_MISSING',
        severity: 'info',
        employeeId: id,
        employeeName: name,
        message: `${name}: email kosong — distribusi payslip digital terbatas.`,
        regulation: 'Use-case payslip',
      });
    }
  }

  // Period format
  if (period && !/^\d{4}-\d{2}$/.test(String(period))) {
    issues.push({
      code: 'PERIOD_FORMAT',
      severity: 'error',
      message: `Format periode "${period}" tidak valid (harus YYYY-MM).`,
      regulation: 'Standar periodisasi payroll',
    });
  }

  // Duplicate NRK/id
  const seen = new Map<string, string>();
  for (const emp of employees) {
    const id = String(emp.id || '');
    if (!id) continue;
    if (seen.has(id)) {
      issues.push({
        code: 'DUPLICATE_ID',
        severity: 'error',
        employeeId: id,
        employeeName: emp.name,
        message: `ID/NRK duplikat: ${id} (${seen.get(id)} & ${emp.name})`,
        regulation: 'Integritas master data',
      });
    } else seen.set(id, emp.name);
  }

  const errorCount = issues.filter((i) => i.severity === 'error').length;
  const warningCount = issues.filter((i) => i.severity === 'warning').length;
  const infoCount = issues.filter((i) => i.severity === 'info').length;

  const summary =
    errorCount === 0
      ? `Validasi OK dengan ${warningCount} warning, ${infoCount} info.`
      : `${errorCount} error, ${warningCount} warning, ${infoCount} info — perbaiki error sebelum payment.`;

  return {
    ok: errorCount === 0,
    errorCount,
    warningCount,
    infoCount,
    issues,
    summary,
  };
}

export function formatValidationMarkdown(report: ValidationReport): string {
  let msg = `**Validasi payroll (regulasi ID)**\n\n${report.summary}\n\n`;
  if (!report.issues.length) {
    msg += '✅ Tidak ada temuan.';
    return msg;
  }

  const groups: Record<Severity, ValidationIssue[]> = {
    error: [],
    warning: [],
    info: [],
  };
  report.issues.forEach((i) => groups[i.severity].push(i));

  (['error', 'warning', 'info'] as Severity[]).forEach((sev) => {
    const list = groups[sev];
    if (!list.length) return;
    const title = sev === 'error' ? 'Error' : sev === 'warning' ? 'Warning' : 'Info';
    msg += `**${title}**\n`;
    list.slice(0, 15).forEach((i) => {
      msg += `- \`${i.code}\` ${i.message}`;
      if (i.regulation) msg += ` _(${i.regulation})_`;
      msg += '\n';
    });
    if (list.length > 15) msg += `- …+${list.length - 15} lainnya\n`;
    msg += '\n';
  });

  return msg.trim();
}
