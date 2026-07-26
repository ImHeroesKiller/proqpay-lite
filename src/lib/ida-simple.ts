import { generatePayroll, saveDatabase } from './database';
import { formatIDR, formatIDRShort } from './format';

export function handleIdaIntent(text: string, db: any): { reply: string; dbChanged?: boolean; newDb?: any } {
  const t = text.toLowerCase().trim();

  if (/^(halo|hai|hi|hello|hey|pagi|siang|sore|malam)\b/.test(t) && t.length < 25) {
    return {
      reply: `Halo! Saya <strong>IDA</strong>, AI Payroll Manager. Ketik <strong>help</strong> atau <strong>hitung payroll</strong>.`,
    };
  }

  if (/\b(help|bantuan|bisa apa|menu|perintah)\b/.test(t)) {
    return {
      reply:
        `Perintah yang tersedia:<br><br>` +
        `📋 <strong>Info</strong> — status, daftar karyawan, daftar client, outstanding, UMR Jakarta<br><br>` +
        `💰 <strong>Payroll</strong><br>` +
        `• hitung payroll<br>` +
        `• status payroll<br>` +
        `• ajukan approval / approve payroll<br>` +
        `• buat payment instruction`,
    };
  }

  if (/\b(ringkasan|summary|overview|status|kondisi)\b/.test(t) && !/payroll/.test(t)) {
    const emp = db.employees?.length || 0;
    const cli = db.companies?.length || 0;
    const payroll = db.payrolls?.find((p: any) => p.period === db.meta?.currentPeriod);
    const ar = (db.arMonitor || []).filter((a: any) => a.status === 'OUTSTANDING');
    const totalAr = ar.reduce((s: number, a: any) => s + a.amount, 0);

    let msg = `📊 <strong>Ringkasan</strong><br><br>`;
    msg += `• Org: <strong>${db.meta?.orgName}</strong><br>`;
    msg += `• Periode: <strong>${db.meta?.currentPeriod}</strong><br>`;
    msg += `• ${emp} karyawan · ${cli} client<br>`;
    if (payroll) {
      msg += `<br>Payroll ${payroll.period}: <strong>${payroll.status}</strong><br>`;
      msg += `Net: <strong>${formatIDR(payroll.summary?.totalNet)}</strong>`;
    } else {
      msg += `<br>Payroll periode ini belum dihitung.`;
    }
    if (ar.length) msg += `<br><br>⚠️ AR Outstanding: <strong>${formatIDR(totalAr)}</strong>`;
    return { reply: msg };
  }

  if (/\b(karyawan|employee|pegawai)\b/.test(t) && /\b(berapa|daftar|list|jumlah|siapa)\b/.test(t)) {
    const emp = db.employees || [];
    let msg = `👥 <strong>${emp.length} Karyawan</strong><br><br>`;
    emp.slice(0, 8).forEach((e: any) => {
      msg += `• <strong>${e.name}</strong> — ${e.company} (${e.status})<br>`;
    });
    if (emp.length > 8) msg += `<br>…dan ${emp.length - 8} lainnya.`;
    return { reply: msg };
  }

  if (/\b(client|klien|perusahaan)\b/.test(t) && /\b(daftar|list|berapa|siapa)\b/.test(t)) {
    const cos = db.companies || [];
    let msg = `🏢 <strong>${cos.length} Client</strong><br><br>`;
    cos.forEach((c: any) => {
      const count = (db.employees || []).filter((e: any) => e.company === c.name).length;
      msg += `• <strong>${c.name}</strong> — ${count} emp · ${c.payrollType}<br>`;
    });
    return { reply: msg };
  }

  if (/\b(status payroll|payroll status|progress payroll)\b/.test(t) || (/\bpayroll\b/.test(t) && /\bstatus\b/.test(t))) {
    const payrolls = db.payrolls || [];
    if (!payrolls.length) return { reply: `Belum ada payroll. Ketik <strong>hitung payroll</strong>.` };
    let msg = `📈 <strong>Payroll Status</strong><br><br>`;
    payrolls.forEach((p: any) => {
      msg += `• <strong>${p.period}</strong> — ${p.status} · ${formatIDRShort(p.summary?.totalNet || 0)}<br>`;
    });
    return { reply: msg };
  }

  // Calculate payroll
  if (/\b(hitung|buat|generate|proses|calculate)\b.*\b(payroll|gaji)\b/.test(t) || /\bpayroll\b.*\b(hitung|buat|generate)\b/.test(t)) {
    const period = db.meta?.currentPeriod || '2025-07';
    const existing = db.payrolls?.find((p: any) => p.period === period);

    if (existing && !['DRAFT'].includes(existing.status) && existing.summary?.totalNet) {
      return {
        reply: `Payroll <strong>${period}</strong> sudah ada (status: <strong>${existing.status}</strong>).<br>Total Net: <strong>${formatIDR(existing.summary?.totalNet)}</strong><br><br>Ketik <strong>ajukan approval</strong> jika status CALCULATED.`,
      };
    }

    const payroll = generatePayroll(db, period);
    payroll.status = 'CALCULATED';

    const newDb = { ...db, payrolls: [...(db.payrolls || [])] };
    const idx = newDb.payrolls.findIndex((p: any) => p.period === period);
    if (idx >= 0) newDb.payrolls[idx] = payroll;
    else newDb.payrolls.push(payroll);

    newDb.auditLogs = [...(newDb.auditLogs || []), {
      id: `LOG${Date.now()}`,
      timestamp: Date.now(),
      user: 'IDA',
      role: 'AI',
      action: 'PAYROLL_CALCULATED',
      detail: `Payroll ${period} dihitung: ${payroll.summary.employeeCount} karyawan, net ${formatIDR(payroll.summary.totalNet)}`,
      entity: 'Payroll',
      entityId: payroll.id,
    }];

    saveDatabase(newDb);

    return {
      reply:
        `✅ <strong>Payroll ${period} berhasil dihitung!</strong><br><br>` +
        `• Karyawan: <strong>${payroll.summary.employeeCount}</strong><br>` +
        `• Gross: <strong>${formatIDR(payroll.summary.totalGross)}</strong><br>` +
        `• Deduction: <strong>${formatIDR(payroll.summary.totalDeduction)}</strong><br>` +
        `• <strong>Net: ${formatIDR(payroll.summary.totalNet)}</strong><br><br>` +
        `Lanjut: ketik <strong>ajukan approval</strong>.`,
      dbChanged: true,
      newDb,
    };
  }

  // Approval
  if (/\b(ajukan approval|approve|setujui|approval)\b/.test(t)) {
    const period = db.meta?.currentPeriod || '2025-07';
    const payroll = db.payrolls?.find((p: any) => p.period === period);
    if (!payroll) {
      return { reply: `Belum ada payroll untuk ${period}. Ketik <strong>hitung payroll</strong> dulu.` };
    }
    if (payroll.status === 'APPROVED' || payroll.status === 'PAID' || payroll.status === 'PAYMENT_INSTRUCTION') {
      return { reply: `Payroll ${period} sudah berstatus <strong>${payroll.status}</strong>.` };
    }
    if (payroll.status !== 'CALCULATED') {
      return { reply: `Status saat ini: <strong>${payroll.status}</strong>. Hitung payroll dulu agar status CALCULATED.` };
    }

    const newDb = { ...db, payrolls: db.payrolls.map((p: any) =>
      p.period === period ? { ...p, status: 'APPROVED' } : p
    ) };
    newDb.approvals = [...(newDb.approvals || []), {
      id: `APR${Date.now()}`,
      payrollId: payroll.id,
      period,
      approvedBy: 'IDA',
      role: 'AI',
      approvedAt: Date.now(),
      status: 'APPROVED',
    }];
    newDb.auditLogs = [...(newDb.auditLogs || []), {
      id: `LOG${Date.now()}`,
      timestamp: Date.now(),
      user: 'IDA',
      role: 'AI',
      action: 'PAYROLL_APPROVED',
      detail: `Payroll ${period} disetujui`,
      entity: 'Payroll',
      entityId: payroll.id,
    }];
    saveDatabase(newDb);

    return {
      reply: `✅ <strong>Payroll ${period} APPROVED</strong><br><br>Lanjut: ketik <strong>buat payment instruction</strong>.`,
      dbChanged: true,
      newDb,
    };
  }

  // Payment instruction
  if (/\b(payment instruction|instruksi pembayaran|buat payment)\b/.test(t)) {
    const period = db.meta?.currentPeriod || '2025-07';
    const payroll = db.payrolls?.find((p: any) => p.period === period);
    if (!payroll) return { reply: `Belum ada payroll. Ketik <strong>hitung payroll</strong> dulu.` };
    if (payroll.status !== 'APPROVED' && payroll.status !== 'PAYMENT_INSTRUCTION') {
      return { reply: `Payroll harus berstatus APPROVED dulu (saat ini: <strong>${payroll.status}</strong>). Ketik <strong>ajukan approval</strong>.` };
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
    newDb.auditLogs = [...(newDb.auditLogs || []), {
      id: `LOG${Date.now()}`,
      timestamp: Date.now(),
      user: 'IDA',
      role: 'AI',
      action: 'PAYMENT_INSTRUCTION_CREATED',
      detail: `Payment instruction ${payment.id} dibuat untuk ${period}`,
      entity: 'Payment',
      entityId: payment.id,
    }];
    saveDatabase(newDb);

    return {
      reply:
        `🏦 <strong>Payment instruction dibuat</strong><br><br>` +
        `• ID: <strong>${payment.id}</strong><br>` +
        `• Bank: BCA<br>` +
        `• Total: <strong>${formatIDR(payment.amount)}</strong><br>` +
        `• Status: INSTRUCTION_CREATED`,
      dbChanged: true,
      newDb,
    };
  }

  if (/\b(outstanding|ar |piutang|tagihan belum)\b/.test(t)) {
    const ar = (db.arMonitor || []).filter((a: any) => a.status === 'OUTSTANDING');
    if (!ar.length) return { reply: `✅ Tidak ada outstanding AR.` };
    let msg = `⏳ <strong>Outstanding AR</strong><br><br>`;
    ar.forEach((a: any) => {
      msg += `• <strong>${a.company}</strong> — ${formatIDR(a.amount)} (${a.invoiceId})<br>`;
    });
    return { reply: msg };
  }

  if (/\b(umr|umk|upah minimum)\b/.test(t)) {
    if (/jakarta|dki/.test(t)) return { reply: `UMR DKI Jakarta 2025: <strong>Rp 5.396.761</strong>` };
    if (/barat|jabar/.test(t)) return { reply: `UMR Jawa Barat 2025: <strong>Rp 2.049.324</strong>` };
    if (/timur|jatim/.test(t)) return { reply: `UMR Jawa Timur 2025: <strong>Rp 2.246.100</strong>` };
    return {
      reply: `Contoh UMR 2025:<br>• DKI Jakarta: Rp 5.396.761<br>• Jawa Barat: Rp 2.049.324<br>• Jawa Timur: Rp 2.246.100`,
    };
  }

  return {
    reply: `Saya belum yakin maksud Anda dengan "${text}". Ketik <strong>help</strong> untuk daftar perintah.`,
  };
}
