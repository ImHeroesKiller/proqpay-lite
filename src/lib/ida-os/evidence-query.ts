import { validatePayrollIndonesia } from '../payroll-validate';

export type EvidenceQueryResult = {
  markdown: string;
  worker: 'HR' | 'PAYROLL' | 'OPERATIONS' | 'COMPLIANCE';
  sourceTables: string[];
  recordIds: string[];
};

type QueryOptions = { referenceDate?: string | number | Date };

function normalizedName(value: unknown) {
  return String(value || '')
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleUpperCase('id-ID');
}

function dateStamp(value: unknown) {
  if (!value) return null;
  const stamp = Date.parse(String(value));
  return Number.isFinite(stamp) ? stamp : null;
}

function contractEndOf(employee: any) {
  return employee.contractEnd ?? employee.contract_end ?? employee.endDate ?? null;
}

function contractStatusOf(employee: any) {
  return [employee.contractStatus, employee.contract_status, employee.status]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function formatDate(value: unknown) {
  const stamp = dateStamp(value);
  if (stamp == null) return '-';
  return new Intl.DateTimeFormat('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Jakarta',
  }).format(new Date(stamp));
}

function duplicateNameAnswer(text: string, employees: any[]): EvidenceQueryResult | null {
  if (!/\b(nama sama|nama (?:yang )?duplikat|duplikat nama|double name)\b/.test(text)) return null;
  const groups = new Map<string, any[]>();
  employees.forEach((employee) => {
    const key = normalizedName(employee.name);
    if (!key) return;
    groups.set(key, [...(groups.get(key) || []), employee]);
  });
  const duplicates = [...groups.values()]
    .filter((items) => items.length > 1)
    .sort((a, b) => b.length - a.length || String(a[0]?.name).localeCompare(String(b[0]?.name)));
  const affected = duplicates.flat();
  if (!duplicates.length) {
    return {
      markdown: `Tidak ditemukan nama karyawan yang sama pada **${employees.length} data karyawan**.\n\n_Sumber: tabel employees; pencocokan nama setelah normalisasi huruf dan spasi._`,
      worker: 'HR',
      sourceTables: ['employees'],
      recordIds: [],
    };
  }
  const rows = duplicates
    .slice(0, 20)
    .map((items, index) => `| ${index + 1} | ${items[0].name} | ${items.length} | ${items.map((item) => item.id).join(', ')} |`)
    .join('\n');
  return {
    markdown:
      `Ditemukan **${duplicates.length} nama duplikat** yang melibatkan **${affected.length} karyawan**.\n\n` +
      `| No | Nama | Jumlah | ID karyawan |\n|---:|---|---:|---|\n${rows}\n\n` +
      `_Sumber: tabel employees; nama sama belum tentu orang yang sama, sehingga ID tetap ditampilkan untuk verifikasi._`,
    worker: 'HR',
    sourceTables: ['employees'],
    recordIds: affected.map((employee) => String(employee.id)),
  };
}

function contractAnswer(text: string, employees: any[], referenceStamp: number): EvidenceQueryResult | null {
  if (!/\b(kontrak|contract|habis|berakhir|expired)\b/.test(text)) return null;
  const expired: any[] = [];
  const active: any[] = [];
  const unknown: any[] = [];
  employees.forEach((employee) => {
    const end = dateStamp(contractEndOf(employee));
    const status = contractStatusOf(employee);
    if ((end != null && end < referenceStamp) || /habis|berakhir|expired|selesai|terminated/.test(status)) {
      expired.push(employee);
    } else if ((end != null && end >= referenceStamp) || /aktif|active|berjalan/.test(status)) {
      active.push(employee);
    } else {
      unknown.push(employee);
    }
  });
  const asksOldest = /\b(paling lama|terlama|paling awal)\b/.test(text) && /\b(habis|berakhir|expired)\b/.test(text);
  if (asksOldest) {
    const dated = expired
      .filter((employee) => dateStamp(contractEndOf(employee)) != null)
      .sort((a, b) => Number(dateStamp(contractEndOf(a))) - Number(dateStamp(contractEndOf(b))));
    if (!dated.length) {
      return {
        markdown: `Ada **${expired.length} karyawan** berstatus kontrak berakhir, tetapi tanggal akhir kontraknya belum tersedia. Karena itu saya belum bisa menentukan siapa yang paling lama habis.\n\n_Sumber: employees dan employee_contracts; tidak dihitung dari selisih total._`,
        worker: 'HR', sourceTables: ['employees', 'employee_contracts'], recordIds: expired.map((item) => String(item.id)),
      };
    }
    const employee = dated[0];
    return {
      markdown: `Kontrak yang paling lama sudah berakhir adalah **${employee.name}** (${employee.id}), tanggal akhir **${formatDate(contractEndOf(employee))}**.\n\n_Sumber: employee_contracts.contract_end._`,
      worker: 'HR', sourceTables: ['employees', 'employee_contracts'], recordIds: [String(employee.id)],
    };
  }
  if (/\b(habis|berakhir|expired)\b/.test(text)) {
    const sample = expired
      .filter((employee) => dateStamp(contractEndOf(employee)) != null)
      .sort((a, b) => Number(dateStamp(contractEndOf(a))) - Number(dateStamp(contractEndOf(b))))
      .slice(0, 10)
      .map((employee) => `- **${employee.name}** (${employee.id}) — ${formatDate(contractEndOf(employee))}`)
      .join('\n');
    return {
      markdown:
        `Ada **${expired.length} karyawan** dengan kontrak berakhir. Kontrak aktif: **${active.length}**; tanggal/status belum cukup: **${unknown.length}**.` +
        (sample ? `\n\n**Tanggal berakhir paling awal**\n${sample}` : '') +
        `\n\n_Sumber: employees dan employee_contracts; hasil tidak dibuat dari total dikurangi kontrak aktif._`,
      worker: 'HR', sourceTables: ['employees', 'employee_contracts'], recordIds: expired.map((item) => String(item.id)),
    };
  }
  return null;
}

function payrollProblemAnswer(text: string, db: any): EvidenceQueryResult | null {
  const asksPayrollProblem =
    /\b(payroll|perhitungan gaji)\b.*\b(masalah|error|salah|bermasalah)\b/.test(text) ||
    /\b(masalah|error|salah|bermasalah)\b.*\b(payroll|perhitungan gaji)\b/.test(text);
  const asksProblemCount = /\b(berapa|jumlah|ada)\b.*\bdata\b.*\b(bermasalah|error|invalid)\b/.test(text);
  if (!asksPayrollProblem && !asksProblemCount) return null;
  const report = validatePayrollIndonesia(db, { period: db.meta?.currentPeriod });
  const affectedIds = new Set(
    report.issues.filter((issue) => issue.severity === 'error' && issue.employeeId).map((issue) => String(issue.employeeId))
  );
  const codeCounts = new Map<string, number>();
  report.issues
    .filter((issue) => issue.severity === 'error')
    .forEach((issue) => codeCounts.set(issue.code, (codeCounts.get(issue.code) || 0) + 1));
  const topCodes = [...codeCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([code, count]) => `- ${code}: **${count}**`)
    .join('\n');
  const period = db.meta?.currentPeriod || '-';
  const payroll = (db.payrolls || []).find((item: any) => item.period === period);
  const arithmeticIssues: string[] = [];
  if (payroll?.details?.length) {
    const totals = payroll.details.reduce(
      (sum: any, row: any) => ({
        gross: sum.gross + Number(row.gross || 0),
        deduction: sum.deduction + Number(row.deductions || 0),
        net: sum.net + Number(row.net || 0),
      }),
      { gross: 0, deduction: 0, net: 0 }
    );
    if (totals.gross !== Number(payroll.summary?.totalGross || 0)) arithmeticIssues.push('total gross tidak cocok');
    if (totals.deduction !== Number(payroll.summary?.totalDeduction || 0)) arithmeticIssues.push('total potongan tidak cocok');
    if (totals.net !== Number(payroll.summary?.totalNet || 0) || totals.net !== totals.gross - totals.deduction) arithmeticIssues.push('total net tidak cocok');
  }
  return {
    markdown:
      `**Audit payroll ${period}**\n\n` +
      `- Konsistensi perhitungan: **${payroll ? (arithmeticIssues.length ? `Bermasalah — ${arithmeticIssues.join(', ')}` : 'Lulus') : 'Belum ada payroll'}**\n` +
      `- Error data/compliance: **${report.errorCount}**\n` +
      `- Karyawan terdampak: **${affectedIds.size}**\n` +
      `- Warning: **${report.warningCount}**\n` +
      (topCodes ? `\n**Masalah terbanyak**\n${topCodes}\n` : '') +
      `\n_Sumber: payroll, payroll lines, employees, dan validatePayrollIndonesia. Error dihitung langsung, bukan diperkirakan._`,
    worker: 'PAYROLL',
    sourceTables: ['payrolls', 'payroll_lines', 'employees'],
    recordIds: [...affectedIds],
  };
}

function operationsAnswer(text: string, db: any): EvidenceQueryResult | null {
  if (!/\b(project|proyek)\b/.test(text) || !/\b(berapa|jumlah|ada|daftar|list)\b/.test(text)) return null;
  const projects = db.projects || [];
  const rows = projects.slice(0, 20).map((project: any) => `- **${project.name}** — ${project.company || 'klien belum terisi'}`).join('\n');
  return {
    markdown: `Saat ini ada **${projects.length} project** dan **${db.companies?.length || 0} klien**.${rows ? `\n\n${rows}` : ''}\n\n_Sumber: tabel projects dan clients; project tidak disamakan dengan klien._`,
    worker: 'OPERATIONS', sourceTables: ['projects', 'clients'], recordIds: projects.map((project: any) => String(project.id)),
  };
}

export function answerEvidenceQuery(text: string, db: any, options: QueryOptions = {}): EvidenceQueryResult | null {
  const normalized = text.toLowerCase().trim();
  const employees = db.employees || [];
  const referenceValue = options.referenceDate ?? Date.now();
  const referenceStamp = referenceValue instanceof Date ? referenceValue.getTime() : typeof referenceValue === 'number' ? referenceValue : Date.parse(referenceValue);
  return (
    duplicateNameAnswer(normalized, employees) ||
    contractAnswer(normalized, employees, Number.isFinite(referenceStamp) ? referenceStamp : Date.now()) ||
    payrollProblemAnswer(normalized, db) ||
    operationsAnswer(normalized, db)
  );
}
