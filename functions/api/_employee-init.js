import { d1All, d1First } from './_d1.js';
import {
  DEFAULT_EWA_POLICY, earnedDaysInPeriod, ewaEligibility, ewaPlafond,
  payrollStageIndex, policyToRules, tenureMonthsFromJoin,
} from './_ewa.js';

const ID_MONTHS = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];
const EN_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const EN_DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const CANONICAL = {
  basicsalary: 'Gaji pokok',
  gajipokok: 'Gaji pokok',
  penghasilanbruto: 'Penghasilan bruto',
  shift: 'Tunjangan shift',
  medical: 'Tunjangan kesehatan',
  overtime: 'Upah lembur',
  overtimepay: 'Upah lembur',
  lembur: 'Upah lembur',
  incentive: 'Insentif',
  insentif: 'Insentif',
  bonusorleave: 'Bonus / uang cuti',
  taxallowance: 'Tunjangan pajak',
  tunjanganpajak: 'Tunjangan pajak',
  mealallowance: 'Tunjangan makan',
  uangmakan: 'Tunjangan makan',
  salaryarrears: 'Tunggakan gaji',
  otherallowance: 'Tunjangan lain',
  phoneallowance: 'Tunjangan pulsa',
  allowancearrears: 'Tunggakan tunjangan',
  positionallowance: 'Tunjangan jabatan',
  tunjanganjabatan: 'Tunjangan jabatan',
  transportallowance: 'Tunjangan transport',
  attendanceallowance: 'Tunjangan kehadiran',
  bpjstk: 'Iuran BPJS Ketenagakerjaan (perusahaan)',
  jamsostek: 'Iuran BPJS Ketenagakerjaan (perusahaan)',
  bpjshealth: 'Iuran BPJS Kesehatan (perusahaan)',
  bpjskes: 'Iuran BPJS Kesehatan (perusahaan)',
  jhtdeduction: 'Iuran JHT karyawan',
  taxdeduction: 'PPh 21',
  pph21: 'PPh 21',
  pensiondeduction: 'Iuran JP karyawan',
  attendancededuction: 'Potongan kehadiran',
  bpjshealthdeduction: 'Iuran BPJS Kesehatan karyawan',
  cooperativededuction: 'Potongan koperasi',
  otherdeduction: 'Potongan lain',
  potonganlain: 'Potongan lain',
  grosspay: 'Penghasilan bruto',
  deductions: 'Potongan',
  netpay: 'Gaji bersih',
  ewarepayment: 'Potongan advance salary',
  ewafee: 'Biaya advance salary',
};

const EARNING_ORDER = [
  'gajipokok', 'basicsalary', 'tunjanganjabatan', 'positionallowance', 'tunjangantransport',
  'transportallowance', 'tunjanganmakan', 'mealallowance', 'uangmakan', 'tunjanganpulsa',
  'phoneallowance', 'tunjanganshift', 'shift', 'upahlembur', 'overtime', 'overtimepay', 'lembur',
  'insentif', 'incentive', 'tunjangankehadiran', 'attendanceallowance', 'tunjangankesehatan',
  'medical', 'bonusorleave', 'tunjanganpajak', 'taxallowance', 'tunggakangaji', 'salaryarrears',
  'tunggakantunjangan', 'allowancearrears', 'tunjanganlain', 'otherallowance', 'penghasilanbruto',
  'grosspay',
];
const DEDUCTION_ORDER = [
  'bpjshealthdeduction', 'jhtdeduction', 'pensiondeduction', 'taxdeduction', 'pph21',
  'attendancededuction', 'cooperativededuction', 'ewarepayment', 'ewafee', 'otherdeduction',
  'potonganlain', 'deductions',
];

export const STAGES = [
  {
    title: 'Data Readiness',
    desc: 'Menunggu data payroll dari perusahaan',
    meta: 'Waiting',
    note: 'Sistem menunggu data payroll periode berjalan dari perusahaan. Status akan diperbarui setelah data diterima.',
    eta: 'Est. before payday',
  },
  {
    title: 'Payroll Preparation',
    desc: 'Menghitung komponen gaji Anda',
    meta: 'In progress',
    note: 'Sistem menghitung komponen gaji, pajak, dan potongan. Perkiraan tampil di slip gaji.',
    eta: 'Est. before payday',
  },
  {
    title: 'Review & Approval',
    desc: 'Payroll sedang ditinjau dan disetujui',
    meta: 'In review',
    note: 'Processor dan Controller meninjau hasil perhitungan sebelum instruksi pembayaran dibuat.',
    eta: 'Est. before payday',
  },
  {
    title: 'Payment',
    desc: 'Menunggu proses pencairan dana',
    meta: 'Waiting',
    note: 'Instruksi pembayaran sedang diproses. Dana akan ditransfer ke rekening terdaftar Anda.',
    eta: 'Est. payday',
  },
  {
    title: 'Reconciliation & Close',
    desc: 'Gaji telah ditransfer ke rekening Anda',
    meta: 'Completed',
    note: 'Gaji Anda telah ditransfer. Slip gaji final tersedia di menu Payslip History.',
    eta: 'Done',
  },
];

function componentKey(name) {
  return String(name || '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '');
}

function isCompanyContribution(name) {
  const k = componentKey(name);
  return k === 'bpjstk' || k === 'bpjshealth' || k === 'bpjskes' || k === 'jamsostek';
}

function isDeductionKey(name) {
  const k = componentKey(name);
  if (/allowance|tunjangan|gaji|salary|overtime|lembur|bonus|incentive|insentif|shift|medical|arrears|tunggakan/.test(k) && !/deduct|potong/.test(k)) {
    return false;
  }
  if (k === 'taxallowance' || k === 'tunjanganpajak') return false;
  if (/deduct|potong|pph|jht|koperasi|cooperative|loan|denda|ewa/.test(k)) return true;
  if ((/pension|jp/.test(k)) && !/allowance|tunjangan/.test(k)) return true;
  return false;
}

function titleFromKey(raw) {
  const spaced = String(raw || '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/deduction/i, 'potongan')
    .replace(/allowance/i, 'tunjangan')
    .trim();
  if (!spaced) return 'Komponen gaji';
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function sortIndex(key, amount) {
  const k = componentKey(key);
  if (amount >= 0) {
    const i = EARNING_ORDER.indexOf(k);
    return i === -1 ? 100 + EARNING_ORDER.length : i;
  }
  const i = DEDUCTION_ORDER.indexOf(k);
  return 1000 + (i === -1 ? 100 + DEDUCTION_ORDER.length : i);
}

export function periodToLabel(period) {
  const m = String(period || '').match(/^(\d{4})-(\d{2})$/);
  if (!m) return String(period || '');
  const month = ID_MONTHS[Number(m[2]) - 1] || m[2];
  return `${month} ${m[1]}`;
}

export function formatPayday(isoDate) {
  if (!isoDate) return { payday: '', paydayShort: '' };
  const d = new Date(isoDate + (String(isoDate).length === 10 ? 'T00:00:00Z' : ''));
  if (Number.isNaN(d.getTime())) return { payday: String(isoDate), paydayShort: String(isoDate) };
  const payday = `${EN_DOW[d.getUTCDay()]}, ${d.getUTCDate()} ${EN_SHORT[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  const paydayShort = `${d.getUTCDate()} ${EN_SHORT[d.getUTCMonth()]}`;
  return { payday, paydayShort };
}

export function maskAccount(bank, acc) {
  const last4 = String(acc || '').replace(/\D/g, '').slice(-4) || '••••';
  return `${bank || 'Bank'} •••• ${last4}`;
}

export function rowsFromRunLine(line) {
  if (!line) return [];
  let parsed = {};
  try {
    parsed = JSON.parse(line.components || '{}');
  } catch {
    parsed = {};
  }
  const rows = [];
  function push(label, amount) {
    const n = Number(amount);
    if (!Number.isFinite(n) || n === 0) return;
    const name = String(label || 'Item');
    if (isCompanyContribution(name)) return;
    const signed = n < 0 || isDeductionKey(name) ? -Math.abs(n) : Math.abs(n);
    rows.push([name, signed]);
  }
  if (Array.isArray(parsed)) {
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue;
      push(item.label || item.name || item.code, item.amount ?? item.value ?? item.nominal);
    }
  } else if (parsed && typeof parsed === 'object') {
    for (const [key, val] of Object.entries(parsed)) {
      if (val && typeof val === 'object') {
        push(val.label || key, val.amount ?? val.value ?? val.nominal);
      } else {
        push(key, val);
      }
    }
  }
  if (!rows.length) {
    if (Number(line.gross_amount)) push('penghasilanBruto', line.gross_amount);
    if (Number(line.deduction_amount)) push('potonganLain', -Math.abs(Number(line.deduction_amount)));
  }
  return rows
    .sort((a, b) => {
      const oa = sortIndex(a[0], a[1]);
      const ob = sortIndex(b[0], b[1]);
      if (oa !== ob) return oa - ob;
      return String(a[0]).localeCompare(String(b[0]), 'id');
    })
    .map(([label, amount]) => [CANONICAL[componentKey(label)] || titleFromKey(label), amount]);
}

function slipStatus(stage) {
  return stage >= 5 ? 'paid' : 'processing';
}

async function loadPolicy(database, orgId, clientId) {
  const scoped = await d1First(
    database,
    'SELECT * FROM ewa_policies WHERE org_id=? AND client_id=? LIMIT 1',
    [orgId, clientId],
  );
  if (scoped) return scoped;
  const org = await d1First(
    database,
    'SELECT * FROM ewa_policies WHERE org_id=? AND client_id IS NULL LIMIT 1',
    [orgId],
  );
  return org || { ...DEFAULT_EWA_POLICY, org_id: orgId };
}

/** Canonical PortalPayload for ESS. Identity from session only — never query emp_id. */
export async function buildEmployeePortalPayload(database, actor) {
  const empId = actor.id;
  const employee = await d1First(
    database,
    `SELECT e.*, c.name AS client_name, c.code AS client_code, c.billing_address, c.contact_phone, c.contact_email, c.website,
            o.name AS org_name, o.code AS org_code
       FROM employees e
       LEFT JOIN clients c ON c.id = e.client_id
       LEFT JOIN organizations o ON o.id = e.org_id
      WHERE e.id=? LIMIT 1`,
    [empId],
  );
  if (!employee) return null;

  const assignment = await d1First(
    database,
    'SELECT position FROM employee_assignments WHERE employee_id=? AND is_current=1 LIMIT 1',
    [empId],
  );
  const bank = await d1First(
    database,
    'SELECT bank_name, account_no FROM employee_bank_accounts WHERE employee_id=? ORDER BY is_primary DESC LIMIT 1',
    [empId],
  );
  const contract = await d1First(
    database,
    'SELECT join_date, accepted_date FROM employee_contracts WHERE employee_id=? AND is_current=1 LIMIT 1',
    [empId],
  );

  const submissions = await d1All(
    database,
    `SELECT s.id, s.period, s.state, s.payment_period, s.created_at,
            pi.id AS pi_id, pi.document_no, pi.status AS pi_status, pi.execution_date,
            r.status AS rec_status
       FROM payroll_submissions s
       LEFT JOIN payment_instructions pi ON pi.submission_id = s.id
       LEFT JOIN reconciliations r ON r.payment_instruction_id = pi.id
      WHERE EXISTS (
        SELECT 1 FROM payroll_run_lines l
         WHERE l.submission_id=s.id AND l.employee_id=? AND l.included=1
      )
      ORDER BY s.period DESC, s.created_at DESC
      LIMIT 12`,
    [empId],
  );

  const latest = submissions[0] || null;
  const stage = latest ? payrollStageIndex(latest.state, latest.pi_status, latest.rec_status) : 1;
  const periodRaw = latest?.period || new Date().toISOString().slice(0, 7);
  const payday = formatPayday(latest?.execution_date || latest?.payment_period || null);

  const runLines = await d1All(
    database,
    `SELECT l.net_amount, l.gross_amount, l.deduction_amount, l.components, s.period, s.state,
            pi.document_no, pi.status AS pi_status, pi.execution_date, r.status AS rec_status
       FROM payroll_run_lines l
       JOIN payroll_submissions s ON s.id = l.submission_id
       LEFT JOIN payment_instructions pi ON pi.submission_id = s.id
       LEFT JOIN reconciliations r ON r.payment_instruction_id = pi.id
      WHERE l.employee_id=? AND l.included=1
      ORDER BY s.period DESC
      LIMIT 12`,
    [empId],
  );

  const payslips = [];
  const seen = new Set();
  for (const line of runLines) {
    const key = line.period;
    if (seen.has(key)) continue;
    seen.add(key);
    const st = payrollStageIndex(line.state, line.pi_status, line.rec_status);
    const rows = rowsFromRunLine(line);
    payslips.push({
      period: periodToLabel(key),
      status: slipStatus(st),
      rows: rows.length ? rows : [['Gaji bersih', Number(line.net_amount) || 0]],
    });
  }

  const phone = employee.mobile || employee.phone || '';
  const companyName = employee.client_name || employee.org_name || 'ProQPay';
  const contactParts = [];
  if (employee.contact_phone) contactParts.push(`Telp ${employee.contact_phone}`);
  if (employee.contact_email) contactParts.push(`Email ${employee.contact_email}`);
  if (employee.website) contactParts.push(employee.website);

  const tenureMonths = tenureMonthsFromJoin(contract?.join_date || contract?.accepted_date);
  const notifications = [];
  if (latest) {
    notifications.push({
      title: `${periodToLabel(latest.period)} payroll is ${latest.state || 'in progress'}`,
      s: 'Status payroll periode berjalan.',
      type: 'g',
      unread: stage < 5,
    });
  }

  const net = Number(runLines[0]?.net_amount || 0);
  const earned = earnedDaysInPeriod();
  const paid = stage >= 5;
  let ewa;
  try {
    const policy = await loadPolicy(database, actor.orgId, actor.clientId);
    const plafond = ewaPlafond({
      net, daysWorked: earned.daysWorked, daysInMonth: earned.daysInMonth, maxPercent: policy.max_percent,
    });
    const open = await d1First(
      database,
      `SELECT id, amount, fee, method, status, created_at FROM ewa_requests
        WHERE employee_id=? AND status IN ('SUBMITTED','APPROVED','DISBURSED','REPAYING')
        ORDER BY created_at DESC LIMIT 1`,
      [empId],
    );
    const history = await d1All(
      database,
      `SELECT id AS ref, created_at AS date, amount, status FROM ewa_requests
        WHERE employee_id=? ORDER BY created_at DESC LIMIT 8`,
      [empId],
    );
    const eligibility = ewaEligibility({
      policy, daysWorked: earned.daysWorked, tenureMonths, plafond, openRequest: open, paid, active: true,
    });
    ewa = {
      rules: policyToRules(policy),
      emp: { daysWorked: earned.daysWorked, tenureMonths, daysInMonth: earned.daysInMonth, net },
      plafond,
      eligible: eligibility.eligible,
      reason: eligibility.reason,
      app: open ? {
        ref: open.id,
        amount: Number(open.amount),
        fee: Number(open.fee),
        method: open.method,
        inst: 1,
        date: String(open.created_at || '').slice(0, 10),
        status: open.status,
      } : null,
      history: history.map((row) => ({
        ref: row.ref,
        date: String(row.date || '').slice(0, 10),
        amount: Number(row.amount),
        status: row.status,
      })),
    };
  } catch {
    ewa = {
      rules: policyToRules(DEFAULT_EWA_POLICY),
      emp: { daysWorked: earned.daysWorked, tenureMonths, daysInMonth: earned.daysInMonth, net },
      plafond: ewaPlafond({
        net, daysWorked: earned.daysWorked, daysInMonth: earned.daysInMonth, maxPercent: 0.3,
      }),
      eligible: false,
      reason: '',
      app: null,
      history: [],
    };
  }

  return {
    config: {
      employee: {
        name: employee.name,
        company: companyName,
        role: assignment?.position || '',
        email: employee.email || '',
        phone,
        empId: employee.employee_code || employee.id,
        bank: bank ? maskAccount(bank.bank_name, bank.account_no) : '',
      },
      company: {
        name: companyName,
        tagline: 'Payroll & HR Digital',
        address: employee.billing_address || '',
        contact: contactParts.join(' · '),
        legal: employee.org_name || 'ProQPay',
      },
      payroll: {
        period: periodToLabel(periodRaw),
        ref: latest?.document_no || latest?.id || periodRaw,
        stage,
        payday: payday.payday || '—',
        paydayShort: payday.paydayShort || '',
      },
      stages: STAGES,
      payslips,
      ads: [
        {
          tag: 'Advance Salary',
          title: 'Get Paid Sooner, Worry Less',
          desc: 'Cairkan gaji yang sudah Anda kerjakan. Pengajuan diproses sesuai kebijakan perusahaan.',
          cta: 'Request Advance',
          bg: 'linear-gradient(115deg, #0f1b3a 0%, #1b2a52 55%, #24355f 100%)',
        },
      ],
      notifications,
    },
    ewa,
    mustChangePassword: Boolean(actor.mustChangePassword),
  };
}
