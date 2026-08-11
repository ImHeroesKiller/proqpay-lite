import { validatePayrollIndonesia } from '../payroll-validate';

export type EvidenceQueryResult = {
  markdown: string;
  worker: 'HR' | 'PAYROLL' | 'OPERATIONS' | 'COMPLIANCE';
  sourceTables: string[];
  recordIds: string[];
};

type QueryOptions = {
  referenceDate?: string | number | Date;
  currentRole?: string;
  permissions?: string[];
};

function normalizedName(value: unknown) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleUpperCase('id-ID');
}

function editDistance(a: string, b: string) {
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let row = 1; row <= a.length; row += 1) {
    let diagonal = previous[0];
    previous[0] = row;
    for (let column = 1; column <= b.length; column += 1) {
      const above = previous[column];
      previous[column] = Math.min(
        previous[column] + 1,
        previous[column - 1] + 1,
        diagonal + (a[row - 1] === b[column - 1] ? 0 : 1)
      );
      diagonal = above;
    }
  }
  return previous[b.length];
}

function similarNameAnswer(text: string, employees: any[]): EvidenceQueryResult | null {
  if (!/\b(nama mirip|bernama mirip|mirip namanya|kemiripan nama|nama serupa)\b/.test(text)) return null;
  const pairs: Array<{ left: any; right: any; score: number }> = [];
  for (let leftIndex = 0; leftIndex < employees.length; leftIndex += 1) {
    const leftName = normalizedName(employees[leftIndex].name);
    if (leftName.length < 4) continue;
    for (let rightIndex = leftIndex + 1; rightIndex < employees.length; rightIndex += 1) {
      const rightName = normalizedName(employees[rightIndex].name);
      if (leftName === rightName || rightName.length < 4) continue;
      const score = 1 - editDistance(leftName, rightName) / Math.max(leftName.length, rightName.length);
      const leftTokens = new Set(leftName.split(' ').filter((token) => token.length > 2));
      const rightTokens = new Set(rightName.split(' ').filter((token) => token.length > 2));
      const sharedTokens = [...leftTokens].filter((token) => rightTokens.has(token)).length;
      const tokenScore = sharedTokens / Math.max(leftTokens.size, rightTokens.size, 1);
      const bestScore = Math.max(score, tokenScore);
      if (bestScore >= 0.72 && (score >= 0.78 || sharedTokens >= 1)) {
        pairs.push({ left: employees[leftIndex], right: employees[rightIndex], score: bestScore });
      }
    }
  }
  pairs.sort((a, b) => b.score - a.score);
  const rows = pairs.slice(0, 20).map((pair, index) =>
    `| ${index + 1} | ${pair.left.name} (${pair.left.id}) | ${pair.right.name} (${pair.right.id}) | ${Math.round(pair.score * 100)}% |`
  ).join('\n');
  return {
    markdown: pairs.length
      ? `Ditemukan **${pairs.length} pasangan nama mirip** untuk ditinjau.\n\n| No | Karyawan 1 | Karyawan 2 | Kemiripan |\n|---:|---|---|---:|\n${rows}\n\n_Sumber: employees; ini kandidat pencocokan, bukan keputusan bahwa orangnya sama._`
      : `Tidak ditemukan nama yang cukup mirip pada **${employees.length} karyawan** dengan ambang pencocokan saat ini.\n\n_Sumber: employees; perbandingan ejaan dan token nama._`,
    worker: 'HR',
    sourceTables: ['employees'],
    recordIds: pairs.slice(0, 20).flatMap((pair) => [String(pair.left.id), String(pair.right.id)]),
  };
}

function bankAccountAnswer(text: string, employees: any[]): EvidenceQueryResult | null {
  const asksMissingBank =
    /\b(tidak ada|tanpa|belum ada|kosong|missing)\b.*\b(nomor )?(rekening(?:nya)?|akun bank)\b/.test(text) ||
    /\b(nomor )?(rekening(?:nya)?|akun bank)\b.*\b(tidak ada|belum ada|kosong|missing)\b/.test(text);
  if (!asksMissingBank) return null;
  const missing = employees.filter((employee) => !String(employee.accountNo || employee.bankAccount || '').trim());
  const sample = missing.slice(0, 20).map((employee) => `- **${employee.name}** (${employee.id})`).join('\n');
  return {
    markdown:
      `Ada **${missing.length} dari ${employees.length} karyawan** yang belum memiliki nomor rekening bank.` +
      (sample ? `\n\n${sample}${missing.length > 20 ? `\n…+${missing.length - 20} lainnya` : ''}` : '') +
      `\n\n_Sumber: employee_bank_accounts.account_no melalui endpoint employees._`,
    worker: 'HR',
    sourceTables: ['employees', 'employee_bank_accounts'],
    recordIds: missing.map((employee) => String(employee.id)),
  };
}

function dataCatalogAnswer(text: string, db: any, options: QueryOptions): EvidenceQueryResult | null {
  if (!/\b(endpoint|kolom|field|akses data|data apa|baca database|membaca database|datasheet|knowledge|pengetahuan data)\b/.test(text)) return null;
  const role = options.currentRole || 'CLIENT_USER';
  const permissions = options.permissions || [];
  const fields = db.employees?.[0] ? Object.keys(db.employees[0]).sort() : [];
  const endpointsByRole: Record<string, string[]> = {
    SUPER_ADMIN: ['health', 'me', 'employees', 'clients-projects', 'state', 'operating-model', 'payment-proof', 'wilayah', 'ida', 'schema', 'reset'],
    PAYROLL_PROCESSOR: ['health', 'me', 'employees', 'state', 'operating-model', 'wilayah', 'ida'],
    PAYROLL_CONTROLLER: ['health', 'me', 'employees', 'state', 'operating-model', 'payment-proof', 'ida'],
    CLIENT_USER: ['health', 'me', 'employees (sesuai client scope)', 'operating-model (sesuai client scope)', 'payment-proof', 'ida'],
  };
  const endpoints = endpointsByRole[role] || ['health', 'me', 'employees (read-only sesuai role)', 'ida'];
  const fieldLines = fields.length
    ? fields.reduce<string[]>((lines, field, index) => {
        const group = Math.floor(index / 12);
        lines[group] = [...(lines[group] ? [lines[group]] : []), `\`${field}\``].join(' · ');
        return lines;
      }, []).join('\n')
    : 'Belum ada record karyawan yang bisa digunakan untuk membaca katalog kolom.';
  return {
    markdown:
      `**Akses IDA untuk role ${role}**\n\n` +
      `Endpoint: ${endpoints.map((endpoint) => `\`${endpoint}\``).join(' · ')}\n\n` +
      `**Kolom employee yang tersedia (${fields.length})**\n${fieldLines}\n\n` +
      `**Permission aktif**\n${permissions.length ? permissions.map((permission) => `\`${permission}\``).join(' · ') : '`read`'}\n\n` +
      `_IDA hanya menampilkan data sesuai role dan client scope. Secret, API key, token, dan environment variable tidak pernah dibuka._`,
    worker: 'HR', sourceTables: ['employees', 'employee_contracts', 'employee_identity', 'employee_bank_accounts'], recordIds: [],
  };
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
    dataCatalogAnswer(normalized, db, options) ||
    similarNameAnswer(normalized, employees) ||
    duplicateNameAnswer(normalized, employees) ||
    bankAccountAnswer(normalized, employees) ||
    contractAnswer(normalized, employees, Number.isFinite(referenceStamp) ? referenceStamp : Date.now()) ||
    payrollProblemAnswer(normalized, db) ||
    operationsAnswer(normalized, db)
  );
}
