import { formatIDR } from './format';

const KES_CEILING = 12_000_000;

export function calcBpjsTotals(db: any) {
  const emps = db.employees || [];
  let kesEmp = 0;
  let kesEr = 0;
  let jhtEmp = 0;
  let jhtEr = 0;
  let jpEmp = 0;
  let jpEr = 0;
  let jkk = 0;
  let jkm = 0;
  let countedKes = 0;
  let countedTk = 0;

  for (const e of emps) {
    const base = Number(e.salaryGross ?? e.basic_salary ?? 0) || 0;
    if (base <= 0) continue;

    if (e.bpjsKesehatan !== false) {
      const b = Math.min(base, KES_CEILING);
      kesEmp += Math.round(b * 0.01);
      kesEr += Math.round(b * 0.04);
      countedKes++;
    }
    if (e.bpjsKetenagakerjaan !== false) {
      jhtEmp += Math.round(base * 0.02);
      jhtEr += Math.round(base * 0.037);
      jpEmp += Math.round(base * 0.01);
      jpEr += Math.round(base * 0.02);
      jkk += Math.round(base * 0.0024);
      jkm += Math.round(base * 0.003);
      countedTk++;
    }
  }

  return {
    employeeCount: emps.length,
    countedKes,
    countedTk,
    kesEmp,
    kesEr,
    kesTotal: kesEmp + kesEr,
    jhtEmp,
    jhtEr,
    jpEmp,
    jpEr,
    jkk,
    jkm,
    tkErTotal: jhtEr + jpEr + jkk + jkm,
    erTotal: kesEr + jhtEr + jpEr + jkk + jkm,
    empTotal: kesEmp + jhtEmp + jpEmp,
  };
}

export function formatBpjsReply(db: any, focus: 'all' | 'kes' | 'kes_er' | 'company' | 'tk' = 'all') {
  const b = calcBpjsTotals(db);
  if (focus === 'kes') {
    return (
      `**BPJS Kesehatan** (estimasi dari ${b.countedKes} karyawan)\n\n` +
      `- Porsi karyawan (1%): **${formatIDR(b.kesEmp)}**\n` +
      `- Porsi perusahaan (4%): **${formatIDR(b.kesEr)}**\n` +
      `- Total iuran: **${formatIDR(b.kesTotal)}**\n\n` +
      `_Plafond upah dihitung max Rp ${KES_CEILING.toLocaleString('id-ID')}._`
    );
  }
  if (focus === 'kes_er' || focus === 'company') {
    return (
      `Perusahaan menanggung **4%** BPJS Kesehatan: **${formatIDR(b.kesEr)}** ` +
      `(dari ${b.countedKes} karyawan).\n\n` +
      `Kalau dijumlahkan dengan porsi pemberi kerja BPJS TK (JHT+JP+JKK+JKM): **${formatIDR(b.erTotal)}**.`
    );
  }
  if (focus === 'tk') {
    return (
      `**BPJS Ketenagakerjaan** (estimasi ${b.countedTk} karyawan)\n\n` +
      `- JHT karyawan 2%: ${formatIDR(b.jhtEmp)}\n` +
      `- JHT perusahaan 3,7%: ${formatIDR(b.jhtEr)}\n` +
      `- JP karyawan 1%: ${formatIDR(b.jpEmp)} · perusahaan 2%: ${formatIDR(b.jpEr)}\n` +
      `- JKK+JKM (perusahaan): ${formatIDR(b.jkk + b.jkm)}\n` +
      `- **Beban perusahaan TK: ${formatIDR(b.tkErTotal)}**`
    );
  }
  return (
    `**Ringkas iuran BPJS** (${b.employeeCount} karyawan)\n\n` +
    `- Kes karyawan: ${formatIDR(b.kesEmp)} · perusahaan: **${formatIDR(b.kesEr)}**\n` +
    `- TK beban perusahaan: **${formatIDR(b.tkErTotal)}**\n` +
    `- **Total beban perusahaan (Kes+TK): ${formatIDR(b.erTotal)}**`
  );
}
