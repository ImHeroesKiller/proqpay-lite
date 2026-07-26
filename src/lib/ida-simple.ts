import { generatePayroll, saveDatabase } from './database';
import { formatIDR, formatIDRShort } from './format';

export function handleIdaIntent(text: string, db: any): { reply: string; dbChanged?: boolean; newDb?: any } {
  const t = text.toLowerCase().trim();

  // Greeting
  if (/^(halo|hai|hi|hello|hey|pagi|siang|sore|malam)\b/.test(t) && t.length < 25) {
    return {
      reply: `Halo! Saya <strong>IDA</strong>, AI Payroll Manager. Ketik <strong>help</strong> untuk melihat perintah, atau <strong>status</strong> untuk ringkasan.`,
    };
  }

  // Help
  if (/\b(help|bantuan|bisa apa|menu|perintah)\b/.test(t)) {
    return {
      reply:
        `Berikut yang bisa saya lakukan:<br><br>` +
        `📋 <strong>Info</strong><br>` +
        `• status / ringkasan<br>` +
        `• daftar karyawan / client<br>` +
        `• outstanding / AR<br>` +
        `• UMR Jakarta<br><br>` +
        `💰 <strong>Payroll</strong><br>` +
        `• status payroll<br>` +
        `• hitung payroll / buat payroll<br>` +
        `• total payroll`,
    };
  }

  // Summary / status
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

  // Employees list
  if (/\b(karyawan|employee|pegawai)\b/.test(t) && /\b(berapa|daftar|list|jumlah|siapa)\b/.test(t)) {
    const emp = db.employees || [];
    let msg = `👥 <strong>${emp.length} Karyawan</strong><br><br>`;
    emp.slice(0, 8).forEach((e: any) => {
      msg += `• <strong>${e.name}</strong> — ${e.company} (${e.status})<br>`;
    });
    if (emp.length > 8) msg += `<br>…dan ${emp.length - 8} lainnya.`;
    return { reply: msg };
  }

  // Clients
  if (/\b(client|klien|perusahaan)\b/.test(t) && /\b(daftar|list|berapa|siapa)\b/.test(t)) {
    const cos = db.companies || [];
    let msg = `🏢 <strong>${cos.length} Client</strong><br><br>`;
    cos.forEach((c: any) => {
      const count = (db.employees || []).filter((e: any) => e.company === c.name).length;
      msg += `• <strong>${c.name}</strong> — ${count} emp · ${c.payrollType}<br>`;
    });
    return { reply: msg };
  }

  // Payroll status
  if (/\b(status payroll|payroll status|progress payroll)\b/.test(t) || (/\bpayroll\b/.test(t) && /\bstatus\b/.test(t))) {
    const payrolls = db.payrolls || [];
    if (!payrolls.length) return { reply: `Belum ada payroll. Ketik <strong>hitung payroll</strong> untuk memulai.` };
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

    if (existing && existing.status !== 'DRAFT') {
      return {
        reply: `Payroll <strong>${period}</strong> sudah ada (status: <strong>${existing.status}</strong>).<br>Total Net: <strong>${formatIDR(existing.summary?.totalNet)}</strong>`,
      };
    }

    const payroll = generatePayroll(db, period);
    payroll.status = 'CALCULATED';

    const newDb = { ...db };
    if (!newDb.payrolls) newDb.payrolls = [];
    const idx = newDb.payrolls.findIndex((p: any) => p.period === period);
    if (idx >= 0) newDb.payrolls[idx] = payroll;
    else newDb.payrolls.push(payroll);

    // Audit log
    if (!newDb.auditLogs) newDb.auditLogs = [];
    newDb.auditLogs.push({
      id: `LOG${Date.now()}`,
      timestamp: Date.now(),
      user: 'IDA',
      role: 'AI',
      action: 'PAYROLL_CALCULATED',
      detail: `Payroll ${period} dihitung: ${payroll.summary.employeeCount} karyawan, net ${formatIDR(payroll.summary.totalNet)}`,
      entity: 'Payroll',
      entityId: payroll.id,
    });

    saveDatabase(newDb);

    return {
      reply:
        `✅ <strong>Payroll ${period} berhasil dihitung!</strong><br><br>` +
        `• Karyawan: <strong>${payroll.summary.employeeCount}</strong><br>` +
        `• Total Gross: <strong>${formatIDR(payroll.summary.totalGross)}</strong><br>` +
        `• Total Deduction: <strong>${formatIDR(payroll.summary.totalDeduction)}</strong><br>` +
        `• <strong>Total Net: ${formatIDR(payroll.summary.totalNet)}</strong><br><br>` +
        `Dashboard akan menampilkan data terbaru setelah refresh.`,
      dbChanged: true,
      newDb,
    };
  }

  // Outstanding / AR
  if (/\b(outstanding|ar |piutang|tagihan belum)\b/.test(t)) {
    const ar = (db.arMonitor || []).filter((a: any) => a.status === 'OUTSTANDING');
    if (!ar.length) return { reply: `✅ Tidak ada outstanding AR.` };
    let msg = `⏳ <strong>Outstanding AR</strong><br><br>`;
    ar.forEach((a: any) => {
      msg += `• <strong>${a.company}</strong> — ${formatIDR(a.amount)} (${a.invoiceId})<br>`;
    });
    return { reply: msg };
  }

  // UMR
  if (/\b(umr|umk|upah minimum)\b/.test(t)) {
    if (/jakarta|dki/.test(t)) return { reply: `UMR DKI Jakarta 2025: <strong>Rp 5.396.761</strong>` };
    if (/barat|jabar/.test(t)) return { reply: `UMR Jawa Barat 2025: <strong>Rp 2.049.324</strong>` };
    if (/timur|jatim/.test(t)) return { reply: `UMR Jawa Timur 2025: <strong>Rp 2.246.100</strong>` };
    return {
      reply: `Contoh UMR 2025:<br>• DKI Jakarta: Rp 5.396.761<br>• Jawa Barat: Rp 2.049.324<br>• Jawa Timur: Rp 2.246.100<br><br>Ketik "UMR Jakarta" untuk detail.`,
    };
  }

  return {
    reply: `Saya belum yakin maksud Anda dengan "${text}". Ketik <strong>help</strong> untuk melihat perintah yang saya pahami.`,
  };
}
