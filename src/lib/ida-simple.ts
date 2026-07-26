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
  if (!pay) return `Periode **${period}**: ketik **hitung payroll**.`;
  switch (pay.status) {
    case 'DRAFT':
    case 'CALCULATED':
      return `Payroll **${period}** status **${pay.status}**. Lanjut: **ajukan approval**.`;
    case 'APPROVED':
      return `Payroll **APPROVED**. Lanjut: **buat payment instruction**.`;
    case 'PAYMENT_INSTRUCTION':
      return `Payment instruction sudah ada. Lanjut: **tandai paid** atau **unduh payment csv** · **buat invoice**.`;
    case 'PAID':
      return `Payroll **PAID**. Cek **margin** / **buat invoice** / **outstanding**.`;
    default:
      return `Status payroll: **${pay.status}**. Ketik **help** untuk menu.`;
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

  // ── Greeting ──
  if (/^(halo|hai|hi|hello|hey|pagi|siang|sore|malam)\b/.test(t) && t.length < 25) {
    return {
      reply: renderMarkdown(
        `Halo! Aku **IDA**.\n\n${nextStep(db)}\n\nKetik **help** untuk menu proses bisnis lengkap.`
      ),
    };
  }

  // ── Help / alur bisnis ──
  if (/\b(help|bantuan|bisa apa|menu|perintah|alur|proses bisnis|business process)\b/.test(t)) {
    return {
      reply: renderMarkdown(
        `**ProQPay — Alur bisnis**\n\n` +
          `1. **hitung payroll** → CALCULATED\n` +
          `2. **ajukan approval** → APPROVED\n` +
          `3. **buat payment instruction** → PAYMENT_INSTRUCTION\n` +
          `4. **unduh payment csv** (opsional)\n` +
          `5. **tandai paid** → PAID\n` +
          `6. **buat invoice** → tagihan ke client\n` +
          `7. **margin** / **outstanding**\n\n` +
          `**Info**\n` +
          `- status · next · ringkasan\n` +
          `- daftar karyawan / client\n` +
          `- provinsi [lokasi] · UMR [provinsi]\n` +
          `- audit · validasi karyawan\n\n` +
          `**Import** data HRIS lewat kartu Excel di dashboard.\n\n` +
          nextStep(db)
      ),
    };
  }

  // ── Next step ──
  if (/\b(next|lanjut|langkah selanjutnya|apa lagi|selanjutnya)\b/.test(t)) {
    return { reply: renderMarkdown(`**Langkah berikutnya**\n\n${nextStep(db)}`) };
  }

  // ── Provinsi ──
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
    const resolved = resolveWorkLocation({
      lokasi: cleaned,
      cabang: cleaned,
    });
    return {
      reply: renderMarkdown(
        `**Identifikasi wilayah**\n\n` +
          `- Input: **${cleaned || text}**\n` +
          `- Provinsi: **${hit.province}**\n` +
          `- Confidence: ${hit.confidence} (${hit.source}` +
          (hit.matchedKey ? ` · ${hit.matchedKey}` : '') +
          `)\n` +
          `- Work location: **${resolved.name}**`
      ),
    };
  }

  // ── Margin ──
  if (/\b(margin|laba|profit|keuntungan|potensi margin)\b/.test(t)) {
    return { reply: renderMarkdown(formatMarginReply(calcMargin(db))) };
  }

  // ── Ringkasan / status umum ──
  if (/\b(ringkasan|summary|overview|status|kondisi)\b/.test(t) && !/payroll/.test(t)) {
    const emp = db.employees?.length || 0;
    const cli = db.companies?.length || 0;
    const pay = payrollOf(db);
    const ar = (db.arMonitor || []).filter((a: any) => a.status === 'OUTSTANDING');
    const totalAr = ar.reduce((s: number, a: any) => s + a.amount, 0);
    const m = calcMargin(db);

    let msg = `**Ringkasan ${db.meta?.orgName}**\n\n`;
    msg += `- Periode: **${periodOf(db)}**\n`;
    msg += `- ${emp} karyawan · ${cli} client\n`;
    if (pay) msg += `- Payroll: **${pay.status}** · Net ${formatIDR(pay.summary?.totalNet)}\n`;
    else msg += `- Payroll: belum dihitung\n`;
    msg += `- Margin: **${formatIDR(m.margin)}** (${m.marginPct.toFixed(1)}%)\n`;
    if (ar.length) msg += `- AR outstanding: **${formatIDR(totalAr)}**\n`;
    msg += `\n${nextStep(db)}`;
    return { reply: renderMarkdown(msg) };
  }

  // ── Karyawan ──
  if (/\b(karyawan|employee|pegawai)\b/.test(t) && /\b(berapa|daftar|list|jumlah|siapa)\b/.test(t)) {
    const emp = db.employees || [];
    let msg = `**${emp.length} Karyawan**\n\n`;
    emp.slice(0, 10).forEach((e: any) => {
      msg += `- **${e.name}** — ${e.company} (${e.status || e.status_aktif || '-'})\n`;
    });
    if (emp.length > 10) msg += `\n…+${emp.length - 10} lainnya.`;
    return { reply: renderMarkdown(msg) };
  }

  // ── Validasi karyawan ──
  if (/\b(validasi|cek data|data rusak|kelengkapan)\b/.test(t)) {
    const issues: string[] = [];
    (db.employees || []).forEach((e: any) => {
      if (!e.bankAccount && !e.bank_account) issues.push(`${e.name}: rekening kosong`);
      if (!e.nik && !e.ktp) issues.push(`${e.name}: NIK/KTP kosong`);
      if (!(e.salaryGross > 0) && !(e.basic_salary > 0)) issues.push(`${e.name}: gaji 0`);
    });
    if (!issues.length) return { reply: renderMarkdown('✅ Validasi OK — tidak ada temuan kritis.') };
    return {
      reply: renderMarkdown(
        `**Validasi** — ${issues.length} temuan:\n\n` +
          issues
            .slice(0, 12)
            .map((x) => `- ${x}`)
            .join('\n')
      ),
    };
  }

  // ── Client ──
  if (/\b(client|klien|perusahaan)\b/.test(t) && /\b(daftar|list|berapa|siapa)\b/.test(t)) {
    const cos = db.companies || [];
    let msg = `**${cos.length} Client**\n\n`;
    cos.forEach((c: any) => {
      const count = (db.employees || []).filter((e: any) => e.company === c.name).length;
      msg += `- **${c.name}** — ${count} emp · ${c.payrollType || 'BULANAN'}\n`;
    });
    return { reply: renderMarkdown(msg) };
  }

  // ── Status payroll ──
  if (
    /\b(status payroll|payroll status|progress payroll)\b/.test(t) ||
    (/\bpayroll\b/.test(t) && /\bstatus\b/.test(t))
  ) {
    const payrolls = db.payrolls || [];
    if (!payrolls.length) return { reply: renderMarkdown('Belum ada payroll. Ketik **hitung payroll**.') };
    let msg = `**Payroll Status**\n\n`;
    payrolls
      .slice()
      .sort((a: any, b: any) => String(b.period).localeCompare(String(a.period)))
      .forEach((p: any) => {
        msg += `- **${p.period}** — ${p.status} · ${formatIDRShort(p.summary?.totalNet || 0)}\n`;
      });
    msg += `\n${nextStep(db)}`;
    return { reply: renderMarkdown(msg) };
  }

  // ── Hitung payroll ──
  if (
    /\b(hitung|buat|generate|calculate)\b.*\b(payroll|gaji)\b/.test(t) ||
    /\bpayroll\b.*\b(hitung|buat|generate)\b/.test(t)
  ) {
    const period = periodOf(db);
    const existing = payrollOf(db, period);

    if (existing && !['DRAFT'].includes(existing.status) && existing.summary?.totalNet) {
      return {
        reply: renderMarkdown(
          `Payroll **${period}** sudah ada (**${existing.status}**).\n` +
            `Net: **${formatIDR(existing.summary?.totalNet)}**\n\n${nextStep(db)}`
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
        detail: `Payroll ${period}: ${payroll.summary.employeeCount} emp, net ${formatIDR(payroll.summary.totalNet)}`,
        entity: 'Payroll',
        entityId: payroll.id,
      },
    ];
    saveDatabase(newDb);

    return {
      reply: renderMarkdown(
        `✅ **Payroll ${period} CALCULATED**\n\n` +
          `- Karyawan: **${payroll.summary.employeeCount}**\n` +
          `- Gross: **${formatIDR(payroll.summary.totalGross)}**\n` +
          `- Potongan: **${formatIDR(payroll.summary.totalDeduction)}**\n` +
          `- **Net: ${formatIDR(payroll.summary.totalNet)}**\n\n` +
          `Lanjut: **ajukan approval**`
      ),
      dbChanged: true,
      newDb,
    };
  }

  // ── Approval ──
  if (/\b(ajukan approval|approve|setujui|approval)\b/.test(t)) {
    const period = periodOf(db);
    const payroll = payrollOf(db, period);
    if (!payroll) {
      return { reply: renderMarkdown(`Belum ada payroll ${period}. Ketik **hitung payroll** dulu.`) };
    }
    if (['APPROVED', 'PAID', 'PAYMENT_INSTRUCTION'].includes(payroll.status)) {
      return { reply: renderMarkdown(`Sudah **${payroll.status}**.\n\n${nextStep(db)}`) };
    }
    if (payroll.status !== 'CALCULATED') {
      return {
        reply: renderMarkdown(`Status **${payroll.status}**. Perlu **CALCULATED** dulu.`),
      };
    }

    const newDb = {
      ...db,
      payrolls: db.payrolls.map((p: any) => (p.period === period ? { ...p, status: 'APPROVED' } : p)),
    };
    newDb.approvals = [
      ...(newDb.approvals || []),
      {
        id: `APR${Date.now()}`,
        payrollId: payroll.id,
        period,
        approvedBy: 'IDA',
        role: 'AI',
        approvedAt: Date.now(),
        status: 'APPROVED',
      },
    ];
    newDb.auditLogs = [
      ...(newDb.auditLogs || []),
      {
        id: `LOG${Date.now()}`,
        timestamp: Date.now(),
        user: 'IDA',
        role: 'AI',
        action: 'PAYROLL_APPROVED',
        detail: `Payroll ${period} disetujui`,
        entity: 'Payroll',
        entityId: payroll.id,
      },
    ];
    saveDatabase(newDb);

    return {
      reply: renderMarkdown(`✅ **${period} APPROVED**\n\nLanjut: **buat payment instruction**`),
      dbChanged: true,
      newDb,
    };
  }

  // ── Payment instruction ──
  if (/\b(payment instruction|instruksi pembayaran|buat payment)\b/.test(t) && !/csv|unduh|download/.test(t)) {
    const period = periodOf(db);
    const payroll = payrollOf(db, period);
    if (!payroll) return { reply: renderMarkdown('Belum ada payroll. **hitung payroll** dulu.') };
    if (payroll.status !== 'APPROVED' && payroll.status !== 'PAYMENT_INSTRUCTION') {
      return {
        reply: renderMarkdown(`Harus **APPROVED** dulu (sekarang **${payroll.status}**).`),
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
    };
    newDb.auditLogs = [
      ...(newDb.auditLogs || []),
      {
        id: `LOG${Date.now()}`,
        timestamp: Date.now(),
        user: 'IDA',
        role: 'AI',
        action: 'PAYMENT_INSTRUCTION_CREATED',
        detail: `${payment.id} · ${formatIDR(payment.amount)}`,
        entity: 'Payment',
        entityId: payment.id,
      },
    ];
    saveDatabase(newDb);

    return {
      reply: renderMarkdown(
        `🏦 **Payment instruction**\n\n` +
          `- ID: **${payment.id}**\n` +
          `- Bank: BCA\n` +
          `- Total: **${formatIDR(payment.amount)}**\n\n` +
          `Lanjut: **unduh payment csv** · **tandai paid** · **buat invoice**`
      ),
      dbChanged: true,
      newDb,
    };
  }

  // ── Unduh payment CSV ──
  if (/\b(unduh|download)\b.*\b(payment|csv|transfer)\b/.test(t) || /\b(payment csv|csv payment)\b/.test(t)) {
    const period = periodOf(db);
    const payroll = payrollOf(db, period);
    if (!payroll?.details?.length) {
      // try regenerate details if missing
      if (!payroll) return { reply: renderMarkdown('Belum ada payroll. **hitung payroll** dulu.') };
      const regenerated = generatePayroll(db, period);
      payroll.details = regenerated.details;
    }
    const file = generatePaymentFile(db, period, { bank: 'BCA' });
    if (!file) return { reply: renderMarkdown('Gagal buat file — pastikan payroll punya detail karyawan.') };
    downloadCsv(file.filename, file.content);
    return {
      reply: renderMarkdown(
        `📥 File **${file.filename}** diunduh.\n\nFormat: ${file.schema.fields.join('; ')}`
      ),
    };
  }

  // ── Tandai paid ──
  if (/\b(tandai paid|mark paid|sudah dibayar|konfirmasi bayar|set paid)\b/.test(t)) {
    const period = periodOf(db);
    const payroll = payrollOf(db, period);
    if (!payroll) return { reply: renderMarkdown('Belum ada payroll.') };
    if (!['PAYMENT_INSTRUCTION', 'APPROVED', 'PAID'].includes(payroll.status)) {
      return {
        reply: renderMarkdown(`Status **${payroll.status}** — buat payment instruction dulu.`),
      };
    }

    const newDb = {
      ...db,
      payrolls: db.payrolls.map((p: any) => (p.period === period ? { ...p, status: 'PAID' } : p)),
      payments: (db.payments || []).map((p: any) =>
        p.period === period
          ? { ...p, status: 'PAID', paidAt: Date.now(), reference: p.reference || `MANUAL-${Date.now()}` }
          : p
      ),
    };
    newDb.auditLogs = [
      ...(newDb.auditLogs || []),
      {
        id: `LOG${Date.now()}`,
        timestamp: Date.now(),
        user: 'IDA',
        role: 'AI',
        action: 'PAYMENT_CONFIRMED',
        detail: `Payroll ${period} ditandai PAID`,
        entity: 'Payroll',
        entityId: payroll.id,
      },
    ];
    saveDatabase(newDb);

    return {
      reply: renderMarkdown(`✅ **${period} PAID**\n\nLanjut: **buat invoice** · **margin**`),
      dbChanged: true,
      newDb,
    };
  }

  // ── Buat invoice (semua client) ──
  if (/\b(buat invoice|generate invoice|terbit invoice|invoice)\b/.test(t)) {
    const period = periodOf(db);
    const payroll = payrollOf(db, period);
    if (!payroll) {
      return { reply: renderMarkdown('Invoice butuh payroll. Ketik **hitung payroll** dulu.') };
    }
    // ensure details exist
    if (!payroll.details?.length) {
      const regen = generatePayroll(db, period);
      payroll.details = regen.details;
    }

    const companies = db.companies || [];
    const newInvoices = [...(db.invoices || [])];
    const created: string[] = [];

    companies.forEach((c: any) => {
      const exists = newInvoices.find((inv: any) => inv.company === c.name && inv.period === period);
      if (exists) {
        created.push(`${c.name}: sudah ada ${exists.id}`);
        return;
      }
      const inv = generateInvoice({ ...db, invoices: newInvoices, payrolls: db.payrolls.map((p: any) => (p.period === period ? payroll : p)) }, c.name, period);
      if (!inv) {
        created.push(`${c.name}: skip (tidak ada detail)`);
        return;
      }
      inv.status = 'SENT';
      newInvoices.push(inv);
      created.push(`${c.name}: **${inv.id}** · ${formatIDR(inv.totalAmount)}`);
    });

    // AR for unpaid invoices this period
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
          notes: `Invoice ${period}`,
        });
      });

    const newDb = {
      ...db,
      payrolls: db.payrolls.map((p: any) => (p.period === period ? payroll : p)),
      invoices: newInvoices,
      arMonitor: newAr,
      auditLogs: [
        ...(db.auditLogs || []),
        {
          id: `LOG${Date.now()}`,
          timestamp: Date.now(),
          user: 'IDA',
          role: 'AI',
          action: 'INVOICE_GENERATED',
          detail: `Invoice periode ${period}`,
          entity: 'Invoice',
          entityId: period,
        },
      ],
    };
    saveDatabase(newDb);

    return {
      reply: renderMarkdown(
        `🧾 **Invoice ${period}**\n\n` + created.map((x) => `- ${x}`).join('\n') + `\n\nCek **margin** / **outstanding**`
      ),
      dbChanged: true,
      newDb,
    };
  }

  // ── Outstanding AR ──
  if (/\b(outstanding|ar |piutang|tagihan belum)\b/.test(t)) {
    const ar = (db.arMonitor || []).filter((a: any) => a.status === 'OUTSTANDING');
    if (!ar.length) return { reply: renderMarkdown('✅ Tidak ada outstanding AR.') };
    let msg = `**Outstanding AR**\n\n`;
    ar.forEach((a: any) => {
      msg += `- **${a.company}** — ${formatIDR(a.amount)} (${a.invoiceId})\n`;
    });
    return { reply: renderMarkdown(msg) };
  }

  // ── Audit log ──
  if (/\b(audit|log aktivitas|riwayat)\b/.test(t)) {
    const logs = (db.auditLogs || []).slice().sort((a: any, b: any) => (b.timestamp || 0) - (a.timestamp || 0));
    if (!logs.length) return { reply: renderMarkdown('Belum ada audit log.') };
    let msg = `**Audit (terbaru)**\n\n`;
    logs.slice(0, 8).forEach((l: any) => {
      msg += `- **${l.action}** — ${l.detail || ''}\n`;
    });
    return { reply: renderMarkdown(msg) };
  }

  // ── UMR ──
  if (/\b(umr|umk|upah minimum)\b/.test(t)) {
    for (const [prov, val] of Object.entries(UMR_2025)) {
      const key = prov.toLowerCase();
      if (t.includes(key.split(' ')[0].toLowerCase()) || t.includes(key)) {
        return { reply: renderMarkdown(`UMR **${prov}** 2025: **${formatIDR(val)}**`) };
      }
    }
    if (/jakarta|dki/.test(t)) return { reply: renderMarkdown(`UMR DKI Jakarta 2025: **${formatIDR(UMR_2025['DKI Jakarta'])}**`) };
    return {
      reply: renderMarkdown(
        `Contoh UMR 2025:\n` +
          `- DKI Jakarta: ${formatIDR(UMR_2025['DKI Jakarta'])}\n` +
          `- Jawa Barat: ${formatIDR(UMR_2025['Jawa Barat'])}\n` +
          `- Sumatera Utara: ${formatIDR(UMR_2025['Sumatera Utara'])}\n` +
          `- Bali: ${formatIDR(UMR_2025['Bali'])}`
      ),
    };
  }

  // ── Import hint ──
  if (/\b(import|upload|excel|hris)\b/.test(t)) {
    return {
      reply: renderMarkdown(
        `Import HRIS lewat kartu **Import HRIS Excel (IAP)** di dashboard.\n\n` +
          `Alur: pilih .xlsx → preview (+ provinsi) → **Import ke database** (Neon).`
      ),
    };
  }

  return {
    reply: renderMarkdown(
      `Belum kebaca. Ketik **help** atau **next**.\n\n${nextStep(db)}`
    ),
  };
}
