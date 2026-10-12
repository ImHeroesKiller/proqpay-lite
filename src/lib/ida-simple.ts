import { generatePayroll, UMR_2025 } from './database';
import { formatIDR, formatIDRShort } from './format';
import { calcMargin, formatMarginReply } from './margin';
import { renderMarkdown } from './markdown';
import { identifyProvince, resolveWorkLocation } from './wilayah';
import { validatePayrollIndonesia, formatValidationMarkdown } from './payroll-validate';
import { formatBpjsReply } from './bpjs-calc';
import { loadSettings } from './app-settings';
import { buildSharedContext, orchestrateRequest } from './ida-os/orchestrator';
import { executeReadOnlyPlan } from './ida-os/read-workers';
import type { SharedContext } from './ida-os/contracts';
import { writeSystemLog } from './system-log';
import { buildPayrollBreakdown, type PayrollPreview } from './ida-os/payroll-preview';
import { payrollEmployeeRows, payrollReadiness, rankPayrollEmployees } from './ida-os/payroll-query';
import type { ApprovalPreview } from './ida-os/approval-preview';

export type PendingPayrollPreview = PayrollPreview;
export type PendingApprovalPreview = ApprovalPreview;

type IdaWorkflowContext = {
  confirmedPayrollPlanId?: string | null;
  confirmedApprovalPlanId?: string | null;
};

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
  if (!pay) return `Periode **${period}**: buka **Pay Runs** untuk membuat payroll melalui workflow canonical, atau gunakan **validasi** untuk pemeriksaan data.`;
  switch (pay.status) {
    case 'DRAFT':
    case 'CALCULATED':
      return `Payroll **${period}** status **${pay.status}**. Lanjut: **ajukan approval**.`;
    case 'APPROVED':
      return `Payroll **APPROVED**. Lanjutkan **Payment Instructions** melalui workflow canonical.`;
    case 'PAYMENT_INSTRUCTION':
      return `Payment Instruction sudah ada. Pantau approval, disbursement, dan reconciliation melalui **Payment Instructions**.`;
    case 'PAID':
      return `Payroll **PAID**. Cek **Billing & AR** untuk penerbitan invoice dan piutang.`;
    default:
      return `Status payroll: **${pay.status}**. Ketik **help**.`;
  }
}

export function handleIdaIntent(
  text: string,
  db: any,
  contextOverrides: Partial<SharedContext> = {},
  _workflow: IdaWorkflowContext = {}
): {
  reply: string;
  dbChanged?: boolean;
  newDb?: any;
  pendingPayrollPreview?: PendingPayrollPreview;
  payrollPlanExecuted?: string;
  pendingApprovalPreview?: PendingApprovalPreview;
  approvalPlanExecuted?: string;
} {
  const t = text.toLowerCase().trim();
  const billing = loadSettings();
  const orchestration = orchestrateRequest(text, buildSharedContext(db, contextOverrides));
  let workerAnswer: string | undefined;
  if (orchestration.allowed && orchestration.plan.risk === 'READ') {
    const workerResult = executeReadOnlyPlan(orchestration.plan, db);
    workerAnswer = workerResult.answerMarkdown;
    writeSystemLog(
      workerResult.errors.length ? 'WARN' : 'INFO',
      'IDA',
      'WORKER_RESULT_COLLECTED',
      `${workerResult.worker} menyelesaikan ${orchestration.plan.intent}`,
      {
        planId: orchestration.plan.id,
        worker: workerResult.worker,
        facts: workerResult.facts,
        errors: workerResult.errors.length,
        warnings: workerResult.warnings.length,
        evidence: workerResult.evidence,
        sourceTables: workerResult.sourceTables,
      }
    );
  }

  if (/^(halo|hai|hi|hello|hey|pagi|siang|sore|malam)\b/.test(t) && t.length < 25) {
    return {
      reply: renderMarkdown(`Hai. ${nextStep(db)} Ketik **help** kalau perlu menu.`),
    };
  }

  if (/\b(help|bantuan|bisa apa|menu|perintah|alur|proses bisnis|business process)\b/.test(t)) {
    return {
      reply: renderMarkdown(
        `**Alur singkat**\n` +
          `0 Data Intake → 1 Validasi → 2 Pay Runs → 3 Approval → 4 Payment Instruction → 5 Disbursement → 6 Reconciliation → 7 Billing & AR\n\n` +
          `Lain: daftar karyawan · UMR · BPJS · provinsi [lokasi]\n\n${nextStep(db)}`
      ),
    };
  }

  if (/\b(next|lanjut|langkah selanjutnya|apa lagi|selanjutnya)\b/.test(t)) {
    return { reply: renderMarkdown(nextStep(db)) };
  }

  if (workerAnswer) {
    return { reply: renderMarkdown(workerAnswer) };
  }

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
    return { reply: renderMarkdown(formatMarginReply(calcMargin(db, undefined, billing))) };
  }

  if (/\b(ringkasan|summary|overview|status|kondisi)\b/.test(t) && !/payroll/.test(t)) {
    const emp = db.employees?.length || 0;
    const cli = db.companies?.length || 0;
    const pay = payrollOf(db);
    const ar = (db.arMonitor || []).filter((a: any) => a.status === 'OUTSTANDING');
    const totalAr = ar.reduce((s: number, a: any) => s + a.amount, 0);
    const m = calcMargin(db, undefined, billing);
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

  if (/\b(bersihkan data|data resign|karyawan resign|pegawai nonaktif|karyawan nonaktif)\b/.test(t)) {
    const inactive = (db.employees || []).filter((employee: any) => {
      const status = [employee.status, employee.statusAktif, employee.contractStatus]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return /resign|inactive|nonaktif|berhenti|terminated|keluar/.test(status);
    });
    if (!inactive.length) {
      return {
        reply: renderMarkdown(
          `Tidak ada karyawan yang berstatus **resign/nonaktif** pada ${db.employees?.length || 0} data saat ini. Saya tidak akan menghapus berdasarkan dugaan. Sebutkan kriteria lain bila perlu, misalnya kontrak berakhir atau rekening kosong.`
        ),
      };
    }
    const preview = inactive
      .slice(0, 15)
      .map((employee: any) => `- **${employee.name}** (${employee.id}) — ${employee.statusAktif || employee.contractStatus || employee.status}`)
      .join('\n');
    return {
      reply: renderMarkdown(
        `Ditemukan **${inactive.length} kandidat nonaktif/resign**:\n\n${preview}` +
          (inactive.length > 15 ? `\n…+${inactive.length - 15} lainnya` : '') +
          `\n\nBelum ada data yang dihapus. Penghapusan membutuhkan role yang berwenang dan konfirmasi target.`
      ),
    };
  }

  if (/\b(validasi|cek data|kelengkapan|compliance|regulasi)\b/.test(t)) {
    return {
      reply: renderMarkdown(formatValidationMarkdown(validatePayrollIndonesia(db, { period: periodOf(db) }))),
    };
  }

  if (/\b(perbaiki|koreksi|benahi)\b/.test(t)) {
    const report = validatePayrollIndonesia(db, { period: periodOf(db) });
    if (report.ok) {
      return { reply: renderMarkdown('Tidak ada error validasi payroll yang perlu diperbaiki.') };
    }
    const belowUmr = report.issues.filter((item: any) => item.code === 'BELOW_UMR');
    const missingEmail = report.issues.filter((item: any) => item.code === 'EMAIL_MISSING');
    return {
      reply: renderMarkdown(
        `Saya menemukan **${report.errorCount} error** yang memblokir payment instruction. Saya tidak akan mengubah nominal gaji tanpa persetujuan karena berdampak finansial.\n\n` +
          (belowUmr.length
            ? `- **${belowUmr.length} gaji di bawah UMR**: perlu koreksi gaji pokok sesuai wilayah. Sebutkan **setujui penyesuaian UMR** jika Anda ingin IDA menyiapkan perubahan untuk dikonfirmasi.\n`
            : '') +
          (missingEmail.length
            ? `- **${missingEmail.length} email kosong**: hanya informasi dan tidak memblokir pembayaran.\n`
            : '') +
          `\nBelum ada data yang diubah. Ketik **validasi** untuk melihat detail lagi.`
      ),
    };
  }

  if (
    /\b(as is|apa adanya|tetap|jangan diubah)\b/.test(t) &&
    /\b(umr|gaji|email)\b/.test(t)
  ) {
    const report = validatePayrollIndonesia(db, { period: periodOf(db) });
    const belowUmr = report.issues.filter((item: any) => item.code === 'BELOW_UMR');
    const missingEmail = report.issues.filter((item: any) => item.code === 'EMAIL_MISSING');
    return {
      reply: renderMarkdown(
        `**Preview kebijakan data — belum dieksekusi**\n\n` +
          `- **${belowUmr.length} gaji** dipertahankan apa adanya. Error UMR tetap tercatat dan payment instruction tetap diblokir sampai ada kebijakan pengecualian yang sah.\n` +
          `- **${missingEmail.length} email kosong** dapat diberi alamat placeholder nonaktif dengan pola \`NRK@pending.proqpay.invalid\`. Alamat ini hanya penanda data dan tidak bisa menerima payslip.\n\n` +
          `Tidak ada nilai gaji atau email yang diubah. Perubahan email termasuk aksi HR dan akan disiapkan pada tahap manajemen data dengan preview per karyawan.`
      ),
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
    /\b(payroll|gaji)\b.*\b(ready|siap)\b|\b(ready|siap)\b.*\b(payroll|gaji)\b/.test(t)
  ) {
    const period = periodOf(db);
    const activeTier = (db.servicePlans || []).find((plan: any) => plan.status === 'ACTIVE')?.tier;
    if (activeTier === 'TIER_1_PAYMENT_PROCESSING') {
      return { reply: renderMarkdown(
        `Klien menggunakan **Tier 1 — Payment Processing**. ProQPay tidak menghitung ulang payroll; Gross, Potongan, dan THP final harus mengikuti file sumber klien. Lanjutkan melalui **Payroll Operations → Exception Center**, lalu siapkan payment instruction setelah temuan kritis selesai.`
      ) };
    }
    const payroll = payrollOf(db, period);
    if (!payroll) return { reply: renderMarkdown(`Payroll **${period}** belum dibuat.`) };
    const report = validatePayrollIndonesia(db, { period });
    const readiness = payrollReadiness(payroll, report.errorCount);
    return {
      reply: renderMarkdown(
        `**Kesiapan payroll ${period}**\n\n` +
          `- Status: **${payroll.status}**\n` +
          `- Karyawan: **${payroll.summary?.employeeCount || 0}**\n` +
          `- Net: **${formatIDR(payroll.summary?.totalNet || 0)}**\n` +
          `- Siap diajukan approval: **${readiness.readyForApproval ? 'Ya' : 'Tidak'}**\n` +
          `- Siap payment instruction: **${readiness.readyForPayment ? 'Ya' : 'Tidak'}**\n` +
          `- Catatan: ${readiness.reason}\n\n` +
          `_Sumber: payroll ${payroll.id}, status payroll, dan hasil validasi deterministik._`
      ),
    };
  }

  if (
    /\b(siapa|daftar|tampilkan)\b.*\b(gaji(?:nya)?|upah(?:nya)?)\b.*\b(paling kecil|terendah|paling besar|tertinggi)\b/.test(t) ||
    /\b(gaji(?:nya)?|upah(?:nya)?)\b.*\b(paling kecil|terendah|paling besar|tertinggi)\b/.test(t)
  ) {
    const period = periodOf(db);
    let payroll = payrollOf(db, period);
    if (!payroll) return { reply: renderMarkdown(`Payroll **${period}** belum dibuat.`) };
    if (!payroll.details?.length) payroll = { ...payroll, details: generatePayroll(db, period).details };
    const highest = /\b(paling besar|tertinggi)\b/.test(t);
    const rows = rankPayrollEmployees(payroll, highest ? 'HIGHEST' : 'LOWEST', 10);
    const table = rows
      .map((row, index) => `| ${index + 1} | ${row.name} | ${row.company} | ${formatIDR(row.salaryGross)} | ${formatIDR(row.net)} |`)
      .join('\n');
    return {
      reply: renderMarkdown(
        `**10 gaji pokok ${highest ? 'tertinggi' : 'terendah'} · ${period}**\n\n` +
          `| No | Karyawan | Klien | Gaji pokok | Net |\n|---:|---|---|---:|---:|\n${table}\n\n` +
          `_Diurutkan berdasarkan gaji pokok pada payroll lines. Tidak ada data yang diubah._`
      ),
    };
  }

  if (
    /\b(tabel|daftar|rincian|perincian|detail)\b.*\b(per karyawan|karyawan|pegawai)\b/.test(t) ||
    /\b(per karyawan)\b/.test(t)
  ) {
    const period = periodOf(db);
    let payroll = payrollOf(db, period);
    if (!payroll) return { reply: renderMarkdown(`Payroll **${period}** belum dibuat.`) };
    if (!payroll.details?.length) payroll = { ...payroll, details: generatePayroll(db, period).details };
    const allRows = payrollEmployeeRows(payroll);
    const rows = allRows.slice(0, 20);
    const table = rows
      .map((row, index) => `| ${index + 1} | ${row.name} | ${formatIDR(row.gross)} | ${formatIDR(row.deduction)} | ${formatIDR(row.net)} |`)
      .join('\n');
    return {
      reply: renderMarkdown(
        `**Rincian payroll per karyawan · ${period}**\n\n` +
          `| No | Karyawan | Gross | Potongan | Net |\n|---:|---|---:|---:|---:|\n${table}\n\n` +
          (allRows.length > rows.length ? `_Menampilkan 20 dari ${allRows.length} payroll lines._` : `_Menampilkan ${allRows.length} payroll lines._`) +
          ` Tidak ada data yang diubah.`
      ),
    };
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
    /\b(rincian|perincian|breakdown|komponen|detail)\b/.test(t) &&
    (/\b(payroll|gaji|biaya|data|anggaran)\b/.test(t) || Boolean(payrollOf(db)))
  ) {
    const period = periodOf(db);
    let payroll = payrollOf(db, period);
    if (!payroll) {
      return { reply: renderMarkdown(`Belum ada payroll **${period}**. Minta **buat payroll** untuk melihat preview terlebih dahulu.`) };
    }
    if (!payroll.details?.length) payroll = { ...payroll, details: generatePayroll(db, period).details };
    const breakdown = buildPayrollBreakdown(payroll);
    const componentRows = Object.entries(breakdown.components)
      .filter(([, value]) => Number(value) !== 0)
      .map(([name, value]) => `- ${name}: **${formatIDR(Number(value))}**`)
      .join('\n');
    const clientRows = Object.entries(breakdown.clients)
      .map(([name, values]) => `- **${name}** — ${values.count} karyawan · gross ${formatIDR(values.gross)} · net ${formatIDR(values.net)}`)
      .join('\n');
    return {
      reply: renderMarkdown(
        `**Breakdown payroll ${period}**\n\n` +
          `Status: **${payroll.status}** · ${payroll.summary?.employeeCount || payroll.details.length} karyawan\n\n` +
          `**Komponen**\n${componentRows}\n` +
          `- Total gross: **${formatIDR(payroll.summary?.totalGross || 0)}**\n` +
          `- Total potongan: **${formatIDR(payroll.summary?.totalDeduction || 0)}**\n` +
          `- Total net: **${formatIDR(payroll.summary?.totalNet || 0)}**\n\n` +
          `**Per klien**\n${clientRows || '- Tidak ada data klien'}\n\n` +
          `_Sumber: payroll ${payroll.id}, payroll lines, dan kalkulasi deterministik. Tidak ada data yang diubah._`
      ),
    };
  }

  // G0: IDA is read-only for financial workflow mutations. The canonical
  // server endpoints enforce maker-checker, MFA, immutable PI and audit.
  if (/\b(hitung|buat|generate|calculate)\b.*\b(payroll|gaji)\b/.test(t)
    || /\bpayroll\b.*\b(hitung|buat|generate)\b/.test(t)
    || /^konfirmasi payroll\b/.test(t)) {
    return {reply:renderMarkdown('IDA tidak membuat atau menyimpan payroll secara lokal. Gunakan **Pay Runs** untuk kalkulasi dan approval melalui backend canonical. Tidak ada perubahan data.')};
  }
  if (/\b(ajukan approval|approve|approved|setujui|disetujui|approval)\b/.test(t)
    || /^konfirmasi approval\b/.test(t)) {
    return {reply:renderMarkdown('Approval payroll hanya melalui **Pay Runs / Payment Instructions** sesuai hak akses dan maker-checker. IDA tidak mengeksekusi approval lokal. Tidak ada status yang diubah.')};
  }

  if (/\b(payment instruction|instruksi pembayaran|buat payment|payment csv|csv payment|tandai paid|mark paid|sudah dibayar|konfirmasi bayar|set paid)\b/.test(t)
    || (/\b(unduh|download)\b/.test(t) && /\b(payment|csv|transfer)\b/.test(t))) {
    return { reply: renderMarkdown('Payment Instruction kini hanya menggunakan workflow canonical pada **Payroll Operations → Payment & Rekonsiliasi**. Pembuatan PI, file bank, bukti, dan perubahan status tidak lagi dilakukan oleh penyimpanan lokal IDA.') };
  }

  if (/\b(buat invoice|generate invoice|terbit invoice|invoice|tagihan)\b/.test(t)) {
    return {reply:renderMarkdown('Penerbitan invoice hanya melalui **Billing & AR** di backend canonical. IDA tidak membuat invoice atau piutang lokal. Tidak ada perubahan data.')};
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
      const firstWord = prov.split(' ')[0].toLowerCase();
      if (t.includes(prov.toLowerCase()) || (firstWord.length >= 3 && t.includes(firstWord))) {
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
        'Klik **📎** di chat ini, pilih file .xlsx, lalu ketik **import sekarang**. Dashboard tidak menerima upload.'
      ),
    };
  }

  return { reply: renderMarkdown(`Coba **help**, **bpjs**, **validasi**, atau **next**.`) };
}
