import { generatePayroll, saveDatabase } from './database';
import { formatIDR, formatIDRShort } from './format';
import { calcMargin, formatMarginReply } from './margin';
import { renderMarkdown } from './markdown';

export function handleIdaIntent(text: string, db: any): { reply: string; dbChanged?: boolean; newDb?: any } {
  const t = text.toLowerCase().trim();

  if (/^(halo|hai|hi|hello|hey|pagi|siang|sore|malam)\b/.test(t) && t.length < 25) {
    return {
      reply: renderMarkdown('Halo! Aku **IDA**, asisten payroll kamu. Tanya aja bebas ya — atau ketik **help** / **margin** / **hitung payroll**.'),
    };
  }

  // Margin — jawab langsung dengan angka
  if (/\b(margin|laba|profit|keuntungan|potensi margin)\b/.test(t)) {
    const m = calcMargin(db);
    return { reply: renderMarkdown(formatMarginReply(m)) };
  }

  if (/\b(help|bantuan|bisa apa|menu|perintah)\b/.test(t)) {
    return {
      reply: renderMarkdown(
        `Bisa bantu ini nih:\n\n` +
          `**Info**\n` +
          `- status / ringkasan\n` +
          `- daftar karyawan / client\n` +
          `- **margin** (hitung cepat)\n` +
          `- outstanding / UMR Jakarta\n\n` +
          `**Payroll**\n` +
          `- hitung payroll\n` +
          `- ajukan approval\n` +
          `- buat payment instruction`
      ),
    };
  }

  if (/\b(ringkasan|summary|overview|status|kondisi)\b/.test(t) && !/payroll/.test(t)) {
    const emp = db.employees?.length || 0;
    const cli = db.companies?.length || 0;
    const payroll = db.payrolls?.find((p: any) => p.period === db.meta?.currentPeriod);
    const ar = (db.arMonitor || []).filter((a: any) => a.status === 'OUTSTANDING');
    const totalAr = ar.reduce((s: number, a: any) => s + a.amount, 0);
    const m = calcMargin(db);

    let msg = `**Ringkasan ${db.meta?.orgName}**\n\n`;
    msg += `- Periode: **${db.meta?.currentPeriod}**\n`;
    msg += `- ${emp} karyawan · ${cli} client\n`;
    if (payroll) {
      msg += `- Payroll: **${payroll.status}** · Net ${formatIDR(payroll.summary?.totalNet)}\n`;
    } else {
      msg += `- Payroll: belum dihitung\n`;
    }
    msg += `- **Margin estimasi: ${formatIDR(m.margin)}** (${m.marginPct.toFixed(1)}%)\n`;
    if (ar.length) msg += `- AR outstanding: **${formatIDR(totalAr)}**`;
    return { reply: renderMarkdown(msg) };
  }

  if (/\b(karyawan|employee|pegawai)\b/.test(t) && /\b(berapa|daftar|list|jumlah|siapa)\b/.test(t)) {
    const emp = db.employees || [];
    let msg = `**${emp.length} Karyawan**\n\n`;
    emp.slice(0, 8).forEach((e: any) => {
      msg += `- **${e.name}** — ${e.company} (${e.status})\n`;
    });
    if (emp.length > 8) msg += `\n…dan ${emp.length - 8} lainnya.`;
    return { reply: renderMarkdown(msg) };
  }

  if (/\b(client|klien|perusahaan)\b/.test(t) && /\b(daftar|list|berapa|siapa)\b/.test(t)) {
    const cos = db.companies || [];
    let msg = `**${cos.length} Client**\n\n`;
    cos.forEach((c: any) => {
      const count = (db.employees || []).filter((e: any) => e.company === c.name).length;
      msg += `- **${c.name}** — ${count} emp · ${c.payrollType}\n`;
    });
    return { reply: renderMarkdown(msg) };
  }

  if (/\b(status payroll|payroll status|progress payroll)\b/.test(t) || (/\bpayroll\b/.test(t) && /\bstatus\b/.test(t))) {
    const payrolls = db.payrolls || [];
    if (!payrolls.length) return { reply: renderMarkdown('Belum ada payroll. Ketik **hitung payroll** ya.') };
    let msg = `**Payroll Status**\n\n`;
    payrolls.forEach((p: any) => {
      msg += `- **${p.period}** — ${p.status} · ${formatIDRShort(p.summary?.totalNet || 0)}\n`;
    });
    return { reply: renderMarkdown(msg) };
  }

  if (
    /\b(hitung|buat|generate|calculate)\b.*\b(payroll|gaji)\b/.test(t) ||
    /\bpayroll\b.*\b(hitung|buat|generate)\b/.test(t)
  ) {
    const period = db.meta?.currentPeriod || '2025-07';
    const existing = db.payrolls?.find((p: any) => p.period === period);

    if (existing && !['DRAFT'].includes(existing.status) && existing.summary?.totalNet) {
      return {
        reply: renderMarkdown(
          `Payroll **${period}** sudah ada (status: **${existing.status}**).\n` +
            `Total Net: **${formatIDR(existing.summary?.totalNet)}**\n\n` +
            `Lanjut **ajukan approval** kalau mau.`
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
        detail: `Payroll ${period} dihitung: ${payroll.summary.employeeCount} karyawan, net ${formatIDR(payroll.summary.totalNet)}`,
        entity: 'Payroll',
        entityId: payroll.id,
      },
    ];

    saveDatabase(newDb);

    return {
      reply: renderMarkdown(
        `✅ **Payroll ${period} beres!**\n\n` +
          `- Karyawan: **${payroll.summary.employeeCount}**\n` +
          `- Gross: **${formatIDR(payroll.summary.totalGross)}**\n` +
          `- Potongan: **${formatIDR(payroll.summary.totalDeduction)}**\n` +
          `- **Net: ${formatIDR(payroll.summary.totalNet)}**\n\n` +
          `Mau lanjut **ajukan approval**?`
      ),
      dbChanged: true,
      newDb,
    };
  }

  if (/\b(ajukan approval|approve|setujui|approval)\b/.test(t)) {
    const period = db.meta?.currentPeriod || '2025-07';
    const payroll = db.payrolls?.find((p: any) => p.period === period);
    if (!payroll) {
      return { reply: renderMarkdown(`Belum ada payroll ${period}. Ketik **hitung payroll** dulu ya.`) };
    }
    if (['APPROVED', 'PAID', 'PAYMENT_INSTRUCTION'].includes(payroll.status)) {
      return { reply: renderMarkdown(`Payroll ${period} sudah **${payroll.status}**.`) };
    }
    if (payroll.status !== 'CALCULATED') {
      return {
        reply: renderMarkdown(
          `Status sekarang **${payroll.status}**. Hitung payroll dulu biar jadi CALCULATED.`
        ),
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
      reply: renderMarkdown(`✅ Payroll **${period} APPROVED**.\n\nLanjut **buat payment instruction**?`),
      dbChanged: true,
      newDb,
    };
  }

  if (/\b(payment instruction|instruksi pembayaran|buat payment)\b/.test(t)) {
    const period = db.meta?.currentPeriod || '2025-07';
    const payroll = db.payrolls?.find((p: any) => p.period === period);
    if (!payroll) return { reply: renderMarkdown('Belum ada payroll. Ketik **hitung payroll** dulu.') };
    if (payroll.status !== 'APPROVED' && payroll.status !== 'PAYMENT_INSTRUCTION') {
      return {
        reply: renderMarkdown(
          `Payroll harus **APPROVED** dulu (sekarang: **${payroll.status}**). Ketik **ajukan approval**.`
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
    };
    newDb.auditLogs = [
      ...(newDb.auditLogs || []),
      {
        id: `LOG${Date.now()}`,
        timestamp: Date.now(),
        user: 'IDA',
        role: 'AI',
        action: 'PAYMENT_INSTRUCTION_CREATED',
        detail: `Payment instruction ${payment.id} dibuat untuk ${period}`,
        entity: 'Payment',
        entityId: payment.id,
      },
    ];
    saveDatabase(newDb);

    return {
      reply: renderMarkdown(
        `🏦 **Payment instruction siap**\n\n` +
          `- ID: **${payment.id}**\n` +
          `- Bank: BCA\n` +
          `- Total: **${formatIDR(payment.amount)}**\n` +
          `- Status: INSTRUCTION_CREATED`
      ),
      dbChanged: true,
      newDb,
    };
  }

  if (/\b(outstanding|ar |piutang|tagihan belum)\b/.test(t)) {
    const ar = (db.arMonitor || []).filter((a: any) => a.status === 'OUTSTANDING');
    if (!ar.length) return { reply: renderMarkdown('✅ Tidak ada outstanding AR.') };
    let msg = `**Outstanding AR**\n\n`;
    ar.forEach((a: any) => {
      msg += `- **${a.company}** — ${formatIDR(a.amount)} (${a.invoiceId})\n`;
    });
    return { reply: renderMarkdown(msg) };
  }

  if (/\b(umr|umk|upah minimum)\b/.test(t)) {
    if (/jakarta|dki/.test(t)) return { reply: renderMarkdown('UMR DKI Jakarta 2025: **Rp 5.396.761**') };
    if (/barat|jabar/.test(t)) return { reply: renderMarkdown('UMR Jawa Barat 2025: **Rp 2.049.324**') };
    if (/timur|jatim/.test(t)) return { reply: renderMarkdown('UMR Jawa Timur 2025: **Rp 2.246.100**') };
    return {
      reply: renderMarkdown(
        'Contoh UMR 2025:\n- DKI Jakarta: Rp 5.396.761\n- Jawa Barat: Rp 2.049.324\n- Jawa Timur: Rp 2.246.100'
      ),
    };
  }

  return {
    reply: renderMarkdown(`Hmm belum kebaca maksudnya. Coba ketik **help** atau **margin**.`),
  };
}
