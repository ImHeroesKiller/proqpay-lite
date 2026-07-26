import {
  generatePayroll,
  generateInvoice,
  generatePaymentFile,
  saveDatabase,
  UMR_2025,
} from './database';
import { formatIDR, formatIDRShort } from './format';
import { calcMargin, formatMarginReply } from './margin';
import { renderMarkdown } from './markdown';
import { identifyProvince, resolveWorkLocation } from './wilayah';
import { validatePayrollIndonesia, formatValidationMarkdown } from './payroll-validate';
import { formatBpjsReply } from './bpjs-calc';

function periodOf(db: any) {
  return db.meta?.currentPeriod || '2025-07';
}

function payrollOf(db: any, period?: string) {
  const p = period || periodOf(db);
  return (db.payrolls || []).find((x: any) => x.period === p);
}

function nextStep(db: any) {
  const period = periodOf(db);
  const pay = payrollOf(db, period);
  if (!pay) return `Periode **${period}**: ketik **hitung payroll** (atau **validasi** dulu).`;
  switch (pay.status) {
    case 'DRAFT':
    case 'CALCULATED':
      return `Payroll **${period}** status **${pay.status}**. Lanjut: **ajukan approval**.`;
    case 'APPROVED':
      return `Payroll **APPROVED**. Lanjut: **validasi** lalu **buat payment instruction**.`;
    case 'PAYMENT_INSTRUCTION':
      return `Payment instruction sudah ada. Lanjut: **tandai paid** / **unduh payment csv** / **buat invoice**.`;
    case 'PAID':
      return `Payroll **PAID**. Cek **margin** / **buat invoice** / **outstanding**.`;
    default:
      return `Status payroll: **${pay.status}**. Ketik **help**.`;
  }
}

function downloadCsv(filename: string, content: string) {
  if (typeof window === 'undefined') return;
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function handleIdaIntent(
  text: string,
  db: any
): { reply: string; dbChanged?: boolean; newDb?: any } {
  const t = text.toLowerCase().trim();

  if (/^(halo|hai|hi|hello|hey|pagi|siang|sore|malam)\b/.test(t) && t.length < 25) {
    return {
      reply: renderMarkdown(`Hai. ${nextStep(db)} Ketik **help** kalau perlu menu.`),
    };
  }

  if (/\b(help|bantuan|bisa apa|menu|perintah|alur|proses bisnis|business process)\b/.test(t)) {
    return {
      reply: renderMarkdown(
        `**Alur singkat**\n` +
          `0 validasi → 1 hitung payroll → 2 ajukan approval → 3 payment instruction → 4 unduh csv → 5 tandai paid → 6 buat invoice → 7 margin\n\n` +
          `Lain: daftar karyawan · UMR · BPJS · provinsi [lokasi]\n\n${nextStep(db)}`
      ),
    };
  }

  if (/\b(next|lanjut|langkah selanjutnya|apa lagi|selanjutnya)\b/.test(t)) {
    return { reply: renderMarkdown(nextStep(db)) };
  }

  // BPJS — jawab natural dari data lokal
  if (/\b(bpjs|iuran)\b/.test(t)) {
    if (/perusahaan|pemberi kerja|yang harus dibayar perusahaan|beban perusahaan|4\s*%/.test(t)) {
      return { reply: renderMarkdown(formatBpjsReply(db, 'company')) };
    }
    if (/kesehatan|jkn/.test(t)) {
      return { reply: renderMarkdown(formatBpjsReply(db, 'kes')) };
    }
    if (/ketenagakerjaan|jht|jkk|jkm|\bjp\b|tk\b/.test(t)) {
      return { reply: renderMarkdown(formatBpjsReply(db, 'tk')) };
    }
    return { reply: renderMarkdown(formatBpjsReply(db, 'all')) };
  }

  if (
    /\b(provinsi|wilayah|daerah)\b/.test(t) ||
    /\b(lokasi|cabang|kota)\b.*\b(mana|apa|provinsi)\b/.test(t) ||
    /^provinsi\s+.+/.test(t)
  ) {
    const cleaned = text
      .replace(/\b(provinsi|wilayah|daerah|lokasi|cabang|kota|apa|mana|dari|untuk|ya|dong|sih)\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const hit = identifyProvince(cleaned || text);
    const resolved = resolveWorkLocation({ lokasi: cleaned, cabang: cleaned });
    return {
      reply: renderMarkdown(
        `**${cleaned || text}** → provinsi **${hit.province}** (${hit.confidence}, ${hit.source}` +
          (hit.matchedKey ? `, ${hit.matchedKey}` : '') +
          `). Work location: **${resolved.name}**.`
      ),
    };
  }

  if (/\b(margin|laba|profit|keuntungan|potensi margin)\b/.test(t)) {
    return { reply: renderMarkdown(formatMarginReply(calcMargin(db))) };
  }

  if (/\b(ringkasan|summary|overview|status|kondisi)\b/.test(t) && !/payroll/.test(t)) {
    const emp = db.employees?.length || 0;
    const cli = db.companies?.length || 0;
    const pay = payrollOf(db);
    const ar = (db.arMonitor || []).filter((a: any) => a.status === 'OUTSTANDING');
    const totalAr = ar.reduce((s: number, a: any) => s + a.amount, 0);
    const m = calcMargin(db);
    const v = validatePayrollIndonesia(db);
    let msg = `**${db.meta?.orgName}** · ${periodOf(db)}\n`;
    msg += `${emp} karyawan · ${cli} client`;
    if (pay) msg += ` · payroll **${pay.status}** net ${formatIDR(pay.summary?.totalNet)}`;
    msg += ` · margin ${formatIDR(m.margin)} · validasi ${v.errorCount}E/${v.warningCount}W`;
    if (ar.length) msg += ` · AR ${formatIDR(totalAr)}`;
    return { reply: renderMarkdown(msg) };
  }

  if (/\b(karyawan|employee|pegawai)\b/.test(t) && /\b(berapa|daftar|list|jumlah|siapa)\b/.test(t)) {
    const emp = db.employees || [];
    let msg = `**${emp.length} karyawan**\n`;
    emp.slice(0, 10).forEach((e: any) => {
      msg += `- **${e.name}** — ${e.company}\n`;
    });
    if (emp.length > 10) msg += `…+${emp.length - 10}`;
    return { reply: renderMarkdown(msg) };
  }

  if (/\b(validasi|cek data|kelengkapan|compliance|regulasi)\b/.test(t)) {
    return {
      reply: renderMarkdown(formatValidationMarkdown(validatePayrollIndonesia(db, { period: periodOf(db) }))),
    };
  }

  if (/\b(client|klien|perusahaan)\b/.test(t) && /\b(daftar|list|berapa|siapa)\b/.test(t)) {
    const cos = db.companies || [];
    let msg = `**${cos.length} client**\n`;
    cos.forEach((c: any) => {
      const count = (db.employees || []).filter((e: any) => e.company === c.name).length;
      msg += `- **${c.name}** — ${count} emp\n`;
    });
    return { reply: renderMarkdown(msg) };
  }

  if (
    /\b(status payroll|payroll status|progress payroll)\b/.test(t) ||
    (/\bpayroll\b/.test(t) && /\bstatus\b/.test(t))
  ) {
    const payrolls = db.payrolls || [];
    if (!payrolls.length) return { reply: renderMarkdown('Belum ada payroll. Ketik **hitung payroll**.') };
    let msg = `**Payroll**\n`;
    payrolls
      .slice()
      .sort((a: any, b: any) => String(b.period).localeCompare(String(a.period)))
      .forEach((p: any) => {
        msg += `- **${p.period}** — ${p.status} · ${formatIDRShort(p.summary?.totalNet || 0)}\n`;
      });
    return { reply: renderMarkdown(msg) };
  }

  if (
    /\b(hitung|buat|generate|calculate)\b.*\b(payroll|gaji)\b/.test(t) ||
    /\bpayroll\b.*\b(hitung|buat|generate)\b/.test(t)
  ) {
    const period = periodOf(db);
    const existing = payrollOf(db, period);
    const report = validatePayrollIndonesia(db, { period });
    if (existing && !['DRAFT'].includes(existing.status) && existing.summary?.totalNet) {
      return {
        reply: renderMarkdown(
          `Payroll **${period}** sudah ada (**${existing.status}**), net **${formatIDR(existing.summary?.totalNet)}**. ${nextStep(db)}`
        ),
      };
    }
    const payroll = generatePayroll(db, period);
    payroll.status = 'CALCULATED';
    const newDb = { ...db, payrolls: [...(db.payrolls || [])] };
    const idx = newDb.payrolls.findIndex((p: any) => p.period === period);
    if (idx >= 0) newDb.payrolls[idx] = payroll;
    else newDb.payrolls.push(payroll);
    newDb.auditLogs = [
      ...(newDb.auditLogs || []),
      {
        id: `LOG${Date.now()}`,
        timestamp: Date.now(),
        user: 'IDA',
        role: 'AI',
        action: 'PAYROLL_CALCULATED',
        detail: `Payroll ${period}`,
        entity: 'Payroll',
        entityId: payroll.id,
      },
    ];
    saveDatabase(newDb);
    let msg = `Payroll **${period}** beres — ${payroll.summary.employeeCount} org, net **${formatIDR(payroll.summary.totalNet)}** (${report.errorCount} error validasi).`;
    if (!report.ok) msg += ` Payment akan diblokir sampai data dibenerin — ketik **validasi**.`;
    else msg += ` Lanjut **ajukan approval**.`;
    return { reply: renderMarkdown(msg), dbChanged: true, newDb };
  }

  if (/\b(ajukan approval|approve|setujui|approval)\b/.test(t)) {
    const period = periodOf(db);
    const payroll = payrollOf(db, period);
    if (!payroll) return { reply: renderMarkdown(`Belum ada payroll ${period}. **hitung payroll** dulu.`) };
    if (['APPROVED', 'PAID', 'PAYMENT_INSTRUCTION'].includes(payroll.status)) {
      return { reply: renderMarkdown(`Sudah **${payroll.status}**.`) };
    }
    if (payroll.status !== 'CALCULATED') {
      return { reply: renderMarkdown(`Status **${payroll.status}** — perlu CALCULATED dulu.`) };
    }
    const report = validatePayrollIndonesia(db, { period });
    const newDb = {
      ...db,
      payrolls: db.payrolls.map((p: any) => (p.period === period ? { ...p, status: 'APPROVED' } : p)),
      approvals: [
        ...(db.approvals || []),
        { id: `APR${Date.now()}`, payrollId: payroll.id, period, approvedBy: 'IDA', status: 'APPROVED', approvedAt: Date.now() },
      ],
      auditLogs: [
        ...(db.auditLogs || []),
        { id: `LOG${Date.now()}`, timestamp: Date.now(), user: 'IDA', role: 'AI', action: 'PAYROLL_APPROVED', detail: period, entity: 'Payroll', entityId: payroll.id },
      ],
    };
    saveDatabase(newDb);
    let msg = `**${period}** sudah APPROVED.`;
    if (!report.ok) msg += ` Masih ${report.errorCount} error validasi sebelum payment.`;
    else msg += ` Lanjut **buat payment instruction**.`;
    return { reply: renderMarkdown(msg), dbChanged: true, newDb };
  }

  if (/\b(payment instruction|instruksi pembayaran|buat payment)\b/.test(t) && !/csv|unduh|download/.test(t)) {
    const period = periodOf(db);
    const payroll = payrollOf(db, period);
    if (!payroll) return { reply: renderMarkdown('Belum ada payroll.') };
    if (payroll.status !== 'APPROVED' && payroll.status !== 'PAYMENT_INSTRUCTION') {
      return { reply: renderMarkdown(`Harus APPROVED dulu (sekarang ${payroll.status}).`) };
    }
    const report = validatePayrollIndonesia(db, { period });
    if (!report.ok) {
      return {
        reply: renderMarkdown(
          `Payment instruction diblokir (${report.errorCount} error).\n\n` + formatValidationMarkdown(report)
        ),
      };
    }
    const payment = {
      id: `PMT${period.replace('-', '')}`,
      payrollId: payroll.id,
      period,
      bank: 'BCA',
      account: '1234567890',
      amount: payroll.summary?.totalNet || 0,
      status: 'INSTRUCTION_CREATED',
      createdAt: Date.now(),
    };
    const newDb = {
      ...db,
      payrolls: db.payrolls.map((p: any) =>
        p.period === period ? { ...p, status: 'PAYMENT_INSTRUCTION' } : p
      ),
      payments: [...(db.payments || []).filter((x: any) => x.period !== period), payment],
      auditLogs: [
        ...(db.auditLogs || []),
        { id: `LOG${Date.now()}`, timestamp: Date.now(), user: 'IDA', role: 'AI', action: 'PAYMENT_INSTRUCTION_CREATED', detail: payment.id, entity: 'Payment', entityId: payment.id },
      ],
    };
    saveDatabase(newDb);
    return {
      reply: renderMarkdown(
        `Payment instruction **${payment.id}** siap · **${formatIDR(payment.amount)}**. Bisa **unduh payment csv** atau **tandai paid**.`
      ),
      dbChanged: true,
      newDb,
    };
  }

  if (/\b(unduh|download)\b.*\b(payment|csv|transfer)\b/.test(t) || /\b(payment csv|csv payment)\b/.test(t)) {
    const period = periodOf(db);
    const payroll = payrollOf(db, period);
    if (!payroll) return { reply: renderMarkdown('Belum ada payroll.') };
    if (!payroll.details?.length) payroll.details = generatePayroll(db, period).details;
    if (!validatePayrollIndonesia(db, { period }).ok) {
      return { reply: renderMarkdown('CSV diblokir — masih ada error validasi. Ketik **validasi**.') };
    }
    const file = generatePaymentFile(db, period, { bank: 'BCA' });
    if (!file) return { reply: renderMarkdown('Gagal buat file.') };
    downloadCsv(file.filename, file.content);
    return { reply: renderMarkdown(`File **${file.filename}** diunduh.`) };
  }

  if (/\b(tandai paid|mark paid|sudah dibayar|konfirmasi bayar|set paid)\b/.test(t)) {
    const period = periodOf(db);
    const payroll = payrollOf(db, period);
    if (!payroll) return { reply: renderMarkdown('Belum ada payroll.') };
    if (!['PAYMENT_INSTRUCTION', 'APPROVED', 'PAID'].includes(payroll.status)) {
      return { reply: renderMarkdown(`Status ${payroll.status} — buat payment instruction dulu.`) };
    }
    const newDb = {
      ...db,
      payrolls: db.payrolls.map((p: any) => (p.period === period ? { ...p, status: 'PAID' } : p)),
      payments: (db.payments || []).map((p: any) =>
        p.period === period ? { ...p, status: 'PAID', paidAt: Date.now() } : p
      ),
    };
    saveDatabase(newDb);
    return { reply: renderMarkdown(`**${period}** ditandai PAID.`), dbChanged: true, newDb };
  }

  if (/\b(buat invoice|generate invoice|terbit invoice|invoice)\b/.test(t)) {
    const period = periodOf(db);
    const payroll = payrollOf(db, period);
    if (!payroll) return { reply: renderMarkdown('Invoice butuh payroll dulu.') };
    if (!payroll.details?.length) payroll.details = generatePayroll(db, period).details;
    const companies = db.companies || [];
    const newInvoices = [...(db.invoices || [])];
    const created: string[] = [];
    companies.forEach((c: any) => {
      const exists = newInvoices.find((inv: any) => inv.company === c.name && inv.period === period);
      if (exists) {
        created.push(`${c.name}: ${exists.id} (sudah ada)`);
        return;
      }
      const inv = generateInvoice(
        { ...db, invoices: newInvoices, payrolls: db.payrolls.map((p: any) => (p.period === period ? payroll : p)) },
        c.name,
        period
      );
      if (!inv) return;
      inv.status = 'SENT';
      newInvoices.push(inv);
      created.push(`${c.name}: **${inv.id}** ${formatIDR(inv.totalAmount)}`);
    });
    const newAr = [...(db.arMonitor || [])];
    newInvoices
      .filter((inv: any) => inv.period === period && inv.status !== 'PAID')
      .forEach((inv: any) => {
        if (newAr.some((a: any) => a.invoiceId === inv.id)) return;
        newAr.push({
          id: `AR-${inv.id}`,
          company: inv.company,
          invoiceId: inv.id,
          amount: inv.totalAmount,
          status: 'OUTSTANDING',
          dueDate: Date.now() + 14 * 86400000,
          daysOverdue: 0,
          type: 'SERVICE',
          notes: period,
        });
      });
    const newDb = { ...db, payrolls: db.payrolls.map((p: any) => (p.period === period ? payroll : p)), invoices: newInvoices, arMonitor: newAr };
    saveDatabase(newDb);
    return {
      reply: renderMarkdown(`Invoice **${period}**:\n` + created.map((x) => `- ${x}`).join('\n')),
      dbChanged: true,
      newDb,
    };
  }

  if (/\b(outstanding|ar |piutang|tagihan belum)\b/.test(t)) {
    const ar = (db.arMonitor || []).filter((a: any) => a.status === 'OUTSTANDING');
    if (!ar.length) return { reply: renderMarkdown('Tidak ada outstanding AR.') };
    let msg = `**Outstanding**\n`;
    ar.forEach((a: any) => {
      msg += `- **${a.company}** ${formatIDR(a.amount)} (${a.invoiceId})\n`;
    });
    return { reply: renderMarkdown(msg) };
  }

  if (/\b(audit|log aktivitas|riwayat)\b/.test(t)) {
    const logs = (db.auditLogs || []).slice().sort((a: any, b: any) => (b.timestamp || 0) - (a.timestamp || 0));
    if (!logs.length) return { reply: renderMarkdown('Belum ada audit.') };
    let msg = `**Audit**\n`;
    logs.slice(0, 8).forEach((l: any) => {
      msg += `- ${l.action}: ${l.detail || ''}\n`;
    });
    return { reply: renderMarkdown(msg) };
  }

  if (/\b(umr|umk|upah minimum)\b/.test(t)) {
    for (const [prov, val] of Object.entries(UMR_2025)) {
      if (t.includes(prov.toLowerCase()) || t.includes(prov.split(' ')[0].toLowerCase())) {
        return { reply: renderMarkdown(`UMR **${prov}** 2025: **${formatIDR(val)}**`) };
      }
    }
    if (/jakarta|dki/.test(t))
      return { reply: renderMarkdown(`UMR DKI Jakarta 2025: **${formatIDR(UMR_2025['DKI Jakarta'])}**`) };
    return {
      reply: renderMarkdown(
        `Contoh UMR 2025: DKI ${formatIDR(UMR_2025['DKI Jakarta'])} · Jabar ${formatIDR(UMR_2025['Jawa Barat'])} · Bali ${formatIDR(UMR_2025['Bali'])}`
      ),
    };
  }

  if (/\b(import|upload|excel|hris|lampir)\b/.test(t)) {
    return {
      reply: renderMarkdown(
        `Klik **📎** di chat ini, pilih file `.xlsx`, lalu ketik **import sekarang**. Dashboard tidak menerima upload.`
      ),
    };
  }

  return { reply: renderMarkdown(`Coba **help**, **bpjs**, **validasi**, atau **next**.`) };
}
