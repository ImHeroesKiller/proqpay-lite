'use client';

import { useState, useEffect, useRef } from 'react';
import { loadDatabase, saveDatabase } from '@/lib/database';
import {
  handleIdaIntent,
  type PendingApprovalPreview,
  type PendingPayrollPreview,
} from '@/lib/ida-simple';
import { emitDbChange, onDbChange } from '@/lib/events';
import { renderMarkdown } from '@/lib/markdown';
import { calcMargin } from '@/lib/margin';
import { formatIDR } from '@/lib/format';
import { getIdaSessionId } from '@/lib/session';
import { parseIapWorkbook, type ParsedEmployee } from '@/lib/excel-iap';
import { validatePayrollIndonesia, formatValidationMarkdown } from '@/lib/payroll-validate';
import { loadSettings, onSettingsChange } from '@/lib/app-settings';
import { persistBusinessState, syncDatabaseFromNeon } from '@/lib/neon-sync';
import { writeSystemLog } from '@/lib/system-log';
import type { IdaRole, SharedContext } from '@/lib/ida-os/contracts';

const IDA_AVATAR = 'https://user.uploads.dev/file/bf193782176dd9739d8c52e33f3b1378.jpg';

const INITIAL_MESSAGE: Msg = {
  role: 'ida',
  text: renderMarkdown('Hai, aku **IDA** — copilot operasional untuk payroll, BPJS, invoice, validasi, dan impor data.'),
  html: true,
};

const QUICK_ACTIONS = [
  { label: 'Validasi data', prompt: 'validasi data payroll periode aktif' },
  { label: 'Ringkasan payroll', prompt: 'ringkasan payroll periode aktif' },
  { label: 'Cek BPJS', prompt: 'cek BPJS perusahaan dan karyawan' },
  { label: 'Langkah berikutnya', prompt: 'next' },
] as const;

type Msg = { role: 'ida' | 'user'; text: string; cot?: string[]; html?: boolean };
type HealthState = 'checking' | 'online' | 'degraded';

function cleanCot(list?: string[] | null) {
  if (!list) return undefined;
  const x = list.map((s) => String(s || '').trim()).filter(Boolean);
  return x.length ? x : undefined;
}

type ImportIssue = { row?: number; field?: string; message?: string };
type PendingEmailFill = {
  planId: string;
  domain: string;
  expectedCount: number;
  samples: Array<{ name: string; email: string }>;
};
type ServiceTier = 'TIER_1_PAYMENT_PROCESSING' | 'TIER_2_MANAGED_PAYROLL' | 'TIER_3_INTEGRATED_AUTOMATION';
type PendingImportContext = {
  clientName: string;
  clientId?: string;
  projectId?: string;
  servicePlanId?: string;
  tier?: ServiceTier;
  period: string;
};

const TIER_LABELS: Record<ServiceTier, string> = {
  TIER_1_PAYMENT_PROCESSING: 'Tier 1 — Payment Processing',
  TIER_2_MANAGED_PAYROLL: 'Tier 2 — Managed Payroll',
  TIER_3_INTEGRATED_AUTOMATION: 'Tier 3 — Integrated Automation',
};

function normalizedName(value: unknown) {
  return String(value || '').toLocaleLowerCase('id-ID').replace(/\bpt\b/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

function formatImportIssues(issues: ImportIssue[], rowOffset = 0) {
  if (!issues.length) return '';
  return issues
    .slice(0, 12)
    .map((issue) => {
      const row = Number(issue.row || 0);
      const position = row > 0 ? `Baris ${row + rowOffset}` : 'File';
      const field = issue.field && issue.field !== 'rows' ? ` · kolom **${issue.field}**` : '';
      return `- ${position}${field}: ${issue.message || 'Data tidak valid'}`;
    })
    .join('\n');
}

function inspectParsedRows(rows: ParsedEmployee[]) {
  const issues: ImportIssue[] = [];
  const warnings: ImportIssue[] = [];
  const seen = new Map<string, number>();
  rows.forEach((row, index) => {
    const rowNo = index + 2;
    const nrk = String(row.nrk || '').trim().toUpperCase();
    if (!nrk) issues.push({ row: rowNo, field: 'NRK', message: 'NRK wajib diisi' });
    else if (seen.has(nrk)) issues.push({ row: rowNo, field: 'NRK', message: `Duplikat dengan baris ${seen.get(nrk)}` });
    else seen.set(nrk, rowNo);
    if (!String(row.name || '').trim()) issues.push({ row: rowNo, field: 'Nama', message: 'Nama wajib diisi' });
    if (!Number.isFinite(row.basicSalary) || row.basicSalary < 0) issues.push({ row: rowNo, field: 'Gaji Pokok', message: 'Gaji harus berupa angka minimal 0' });
    if (row.basicSalary === 0) warnings.push({ row: rowNo, field: 'Gaji Pokok', message: 'Nilai gaji 0; pastikan memang benar' });
    if (!row.accountNo) warnings.push({ row: rowNo, field: 'Rekening', message: 'Rekening belum diisi' });
    if (row.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email)) issues.push({ row: rowNo, field: 'Email', message: 'Format email tidak valid' });
  });
  return { issues, warnings };
}

function findClientForDelete(text: string, companies: any[]) {
  const query = text
    .toLowerCase()
    .replace(/\b(tolong|mohon|hapus|delete|data|klien|client|perusahaan|pt|semua|beserta)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  if (!query) return null;
  const terms = query.split(/\s+/).filter((term) => term.length > 2);
  return (companies || []).find((company: any) => {
    const name = String(company.name || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ');
    return terms.every((term) => name.includes(term));
  }) || null;
}

function autoFixImportRows(rows: ParsedEmployee[]) {
  const changes: { row: number; field: string; before: string; after: string }[] = [];
  const fixed = rows.map((row, index) => {
    const next = { ...row };
    if (next.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next.email)) {
      changes.push({ row: index + 2, field: 'Email', before: next.email, after: '-' });
      next.email = null;
    }
    return next;
  });
  return { rows: fixed, changes };
}

function companyPlaceholderDomain(name: string) {
  const slug = String(name || 'perusahaan')
    .toLowerCase()
    .replace(/\b(pt|cv|tbk|persero)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, 40) || 'perusahaan';
  return `${slug}.pending.proqpay.invalid`;
}

function placeholderEmail(employee: any, domain: string) {
  const local = String(employee.id || employee.name || 'karyawan')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '') || 'karyawan';
  return `${local}@${domain}`;
}

function emailFillPlanId(employees: any[], domain: string) {
  const source = `${domain}|${employees.map((item) => item.id).sort().join('|')}`;
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `PLAN-EMAIL-${(hash >>> 0).toString(16).toUpperCase()}`;
}

function looksLikePromptLeak(text: string) {
  return /no\s+["“](halo|cta)|repetitive explanations|system prompt|developer message|follow these instructions/i.test(text);
}

function looksLikeUnverifiedMutationClaim(text: string) {
  return /\b(sudah|berhasil|selesai|telah)\b.{0,80}\b(dibuat|diproses|disimpan|diubah|diupdate|dihapus|dibayar|paid|approved|payment instruction)\b/i.test(text);
}

function looksLikeLocalAction(text: string) {
  const t = text.toLowerCase();
  return (
    /\b(margin|laba|profit|bpjs|iuran|jht|jkk|jkm|jkn|provinsi|wilayah)\b/.test(t) ||
    /\b(payroll|gaji|approval|approve|approved|setujui|disetujui|payment|pembayaran|transfer|buat invoice|invoice|tandai paid|unduh)\b/.test(t) ||
    /\b(karyawan|pegawai|employee|kontrak|contract|habis|berakhir|expired|project|proyek|klien|client|nama sama|nama mirip|duplikat|bermasalah|invalid|rekening|endpoint|kolom|field|akses data|database|datasheet|knowledge|pengetahuan)\b/.test(t) ||
    /\b(help|bantuan|next|status|ringkasan|validasi|cek data|kelengkapan|siap|ready|bersihkan|perbaiki|koreksi|rincian|perincian|breakdown|komponen|detail|tabel|per karyawan|terendah|tertinggi|paling kecil|paling besar|resign|nonaktif|import|upload|audit|umr|daftar)\b/.test(t) ||
    /^(iya|iy|yes|ok|oke|ya|y|generate|kirim|buatkan|proses|eksekusi)\b/.test(t)
  );
}

function mapConfirmToAction(text: string, lastUserHint?: string) {
  const t = text.toLowerCase().trim();
  if (lastUserHint && /\b(habis|berakhir|expired)\b/.test(t) && /\b(kontrak|contract)\b/.test(lastUserHint)) {
    return `${text} kontrak karyawan`;
  }
  if (/\btabel\b/.test(t) && lastUserHint && /per karyawan|karyawan|pegawai/.test(lastUserHint)) {
    return 'tabel payroll per karyawan';
  }
  if (/\b(perbaiki|koreksi|benahi)\b/.test(t) && lastUserHint && /validasi/.test(lastUserHint)) {
    return 'perbaiki error validasi';
  }
  if (/\b(rincian|perincian|breakdown|komponen|detail)\b/.test(t) && lastUserHint && /payroll|gaji/.test(lastUserHint)) {
    return 'rincian payroll';
  }
  if (/^(iya|iy|yes|ok|oke|ya|y|generate|kirim|buatkan|proses|eksekusi)\b/.test(t)) {
    if (lastUserHint && /\b(endpoint|kolom|field|akses|database|datasheet|knowledge|pengetahuan)\b/.test(lastUserHint)) return 'jelaskan endpoint, kolom, dan akses data saya';
    if (lastUserHint && /\b(nama sama|duplikat)\b/.test(lastUserHint)) return 'cek nama karyawan yang sama';
    if (lastUserHint && /\b(kontrak|habis|berakhir|expired)\b/.test(lastUserHint)) return 'cek kontrak karyawan yang sudah habis';
    if (lastUserHint && /paling kecil|terendah/.test(lastUserHint)) return 'tampilkan gaji terendah';
    if (lastUserHint && /paling besar|tertinggi/.test(lastUserHint)) return 'tampilkan gaji tertinggi';
    if (lastUserHint && /per karyawan|tabel/.test(lastUserHint)) return 'tabel payroll per karyawan';
    if (lastUserHint && /payment|pembayaran/.test(lastUserHint)) return 'buat payment instruction';
    if (lastUserHint && /approval|approve|approved|setuju|disetujui/.test(lastUserHint)) return 'ajukan approval';
    if (lastUserHint && /payroll|gaji/.test(lastUserHint)) return 'hitung payroll';
    if (lastUserHint && /invoice/.test(lastUserHint)) return 'buat invoice';
    return text;
  }
  if (/\b(payment|pembayaran|transfer)\b/.test(t) && /\b(mana|buat|buatkan|proses|eksekusi)\b/.test(t)) {
    return 'buat payment instruction';
  }
  if (/\binvoice\b/.test(t)) return 'buat invoice';
  return text;
}

/** Strip HTML for typing, then re-render markdown at end */
function stripHtml(html: string) {
  if (typeof document === 'undefined') return html.replace(/<[^>]+>/g, '');
  const d = document.createElement('div');
  d.innerHTML = html;
  return d.textContent || '';
}

export default function IdaFab({ openSignal = 0 }: { openSignal?: number }) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [sessionId, setSessionId] = useState('default');
  const [messages, setMessages] = useState<Msg[]>([INITIAL_MESSAGE]);
  const [input, setInput] = useState('');
  const [db, setDb] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [typing, setTyping] = useState(false);
  const [pendingRows, setPendingRows] = useState<ParsedEmployee[] | null>(null);
  const [pendingImportContext, setPendingImportContext] = useState<PendingImportContext | null>(null);
  const [lastImportFailure, setLastImportFailure] = useState('');
  const [pendingFullReset, setPendingFullReset] = useState(false);
  const [pendingClientDelete, setPendingClientDelete] = useState<{ id: string; name: string; employees: number } | null>(null);
  const [cotLive, setCotLive] = useState<string[] | null>(null);
  const [showCot, setShowCot] = useState(true);
  const [typingMs, setTypingMs] = useState(28);
  const [compactResponses, setCompactResponses] = useState(false);
  const [autoSuggestions, setAutoSuggestions] = useState(true);
  const [actorContext, setActorContext] = useState<Partial<SharedContext>>({
    currentUser: { email: 'unknown@local' },
    currentRole: 'CLIENT_USER',
    permissions: [],
  });
  const [pendingPayrollPreview, setPendingPayrollPreview] = useState<PendingPayrollPreview | null>(null);
  const [pendingApprovalPreview, setPendingApprovalPreview] = useState<PendingApprovalPreview | null>(null);
  const [pendingEmailFill, setPendingEmailFill] = useState<PendingEmailFill | null>(null);
  const [health, setHealth] = useState<HealthState>('checking');
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const lastTopicRef = useRef('');
  const typingCancel = useRef(false);

  useEffect(() => {
    const localDb = loadDatabase();
    setDb(localDb);
    setSessionId(getIdaSessionId());
    const st = loadSettings();
    setShowCot(st.idaShowCot);
    setTypingMs(st.idaTypingMs);
    setCompactResponses(st.idaCompactResponses);
    setAutoSuggestions(st.idaAutoSuggestions);
    const controller = new AbortController();
    fetch('/api/health', {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then((result) => {
        setHealth(result?.ready && result?.database === 'connected' ? 'online' : 'degraded');
      })
      .catch((error) => {
        if (error?.name !== 'AbortError') setHealth('degraded');
      });
    fetch('/api/me', { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then((identity) => {
        const user = identity?.user;
        if (!user?.email || !user?.role) return;
        setActorContext({
          currentUser: { id: user.id, email: user.email },
          currentRole: user.role as IdaRole,
          permissions: Array.isArray(user.permissions) ? user.permissions : [],
        });
      })
      .catch((error) => {
        if (error?.name !== 'AbortError') {
          writeSystemLog('WARN', 'SECURITY', 'IDA_CONTEXT_FALLBACK', 'Identitas IDA menggunakan role CLIENT_USER', {
            reason: String(error?.message || error),
          });
        }
      });
    syncDatabaseFromNeon(localDb, { signal: controller.signal })
      .then((result) => {
        if (!result.synced) return;
        saveDatabase(result.db);
        setDb(result.db);
        emitDbChange();
        writeSystemLog('SUCCESS', 'DATABASE', 'NEON_SYNC_COMPLETED', `${result.count} karyawan tersinkron`);
      })
      .catch((error) => {
        writeSystemLog('ERROR', 'DATABASE', 'NEON_SYNC_FAILED', String(error?.message || error));
      });
    const unsubscribe = onSettingsChange(() => {
      const s = loadSettings();
      setShowCot(s.idaShowCot);
      setTypingMs(s.idaTypingMs);
      setCompactResponses(s.idaCompactResponses);
      setAutoSuggestions(s.idaAutoSuggestions);
    });
    const unsubscribeDb = onDbChange(() => {
      // Keep IDA context aligned with dashboard filters and remote sync.
      // Without this subscription IDA keeps the database snapshot from mount.
      setDb(loadDatabase());
    });
    return () => {
      controller.abort();
      unsubscribe();
      unsubscribeDb();
    };
  }, []);

  useEffect(() => {
    if (openSignal > 0) setOpen(true);
  }, [openSignal]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, cotLive, expanded, typing]);

  async function typeOut(finalHtml: string, cot?: string[]) {
    typingCancel.current = false;
    setTyping(true);
    const plain = stripHtml(finalHtml);
    const steps = Math.min(plain.length, 400);
    const chunk = Math.max(1, Math.floor(plain.length / 60));
    let shown = '';
    setMessages((prev) => [...prev, { role: 'ida', text: '', cot: cleanCot(cot), html: false }]);
    for (let i = 0; i < plain.length; i += chunk) {
      if (typingCancel.current) break;
      shown = plain.slice(0, i + chunk);
      setMessages((prev) => {
        const copy = [...prev];
        copy[copy.length - 1] = { role: 'ida', text: shown + (i + chunk < plain.length ? '▍' : ''), cot: cleanCot(cot), html: false };
        return copy;
      });
      await new Promise((r) => setTimeout(r, typingMs));
      if (i > steps * 2) break;
    }
    setMessages((prev) => {
      const copy = [...prev];
      copy[copy.length - 1] = { role: 'ida', text: finalHtml, cot: cleanCot(cot), html: true };
      return copy;
    });
    setTyping(false);
  }

  async function pushIda(text: string, isMarkdown = true, cot?: string[]) {
    const html = isMarkdown ? renderMarkdown(text) : text;
    await typeOut(html, cot);
  }

  function buildContext(database: any) {
    const period = database.meta?.currentPeriod;
    const payroll = (database.payrolls || []).find((p: any) => p.period === period);
    const m = calcMargin(database, undefined, loadSettings());
    return {
      org: database.meta?.orgName,
      period,
      employees: database.employees?.length,
      clients: database.companies?.length,
      clientNames: (database.companies || []).map((c: any) => c.name),
      payrollNet: payroll?.summary?.totalNet ?? null,
      payrollStatus: payroll?.status ?? null,
      marginFormatted: formatIDR(m.margin),
      revenueFormatted: formatIDR(m.revenue),
      costFormatted: formatIDR(m.cost),
    };
  }

  async function handleFile(file: File) {
    setBusy(true);
    setCotLive(['Membaca file…', 'Memetakan wilayah…']);
    setMessages((prev) => [...prev, { role: 'user', text: `📎 ${file.name}` }]);
    try {
      if (file.size > 5 * 1024 * 1024) {
        throw new Error('Ukuran file maksimal 5 MB');
      }
      const parsed = parseIapWorkbook(await file.arrayBuffer());
      if (!parsed.rows.length) {
        const scanned = parsed.diagnostics.map((sheet) => sheet.sheetName).join(', ');
        throw new Error(`Tidak ditemukan datasheet dengan kombinasi kolom NRK dan NAMA. Sheet diperiksa: ${scanned || 'tidak ada'}`);
      }
      writeSystemLog('INFO', 'IDA', 'FILE_PARSED', `${file.name}: ${parsed.rows.length} baris terbaca`, {
        fileName: file.name,
        rows: parsed.rows.length,
        skipped: parsed.skipped,
      });
      setPendingRows(parsed.rows);
      setLastImportFailure('');
      const review = inspectParsedRows(parsed.rows);
      const clientNames = [...new Set(parsed.rows.map((row) => row.client || row.company).filter(Boolean))];
      if (clientNames.length !== 1) {
        throw new Error(`Satu file harus berisi satu klien. Terdeteksi ${clientNames.length || 0} klien.`);
      }
      const clientName = String(clientNames[0]);
      const directoryResponse = await fetch('/api/client-projects', { headers: { Accept: 'application/json' } });
      const directory = await directoryResponse.json().catch(() => ({}));
      if (!directoryResponse.ok) throw new Error(directory.error || 'Gagal memeriksa master klien');
      const client = (directory.clients || []).find((item: any) => normalizedName(item.name) === normalizedName(clientName));
      const projects = client ? (directory.projects || []).filter((item: any) => item.client_id === client.id) : [];
      let activePlan: any = null;
      if (client) {
        const planResponse = await fetch(`/api/operating-model?resource=service-plans&clientId=${encodeURIComponent(client.id)}`);
        const planData = await planResponse.json().catch(() => ({}));
        if (planResponse.ok) activePlan = (planData.servicePlans || []).find((plan: any) => plan.status === 'ACTIVE');
      }
      const context: PendingImportContext = {
        clientName, clientId: client?.id, projectId: projects[0]?.id,
        servicePlanId: activePlan?.id, tier: activePlan?.tier,
        period: db?.meta?.currentPeriod || new Date().toISOString().slice(0, 7),
      };
      setPendingImportContext(context);
      const sample = parsed.rows
        .slice(0, 3)
        .map((r) => `- **${r.name}** → **${r.province}**`)
        .join('\n');
      if (review.issues.length) {
        writeSystemLog('WARN', 'VALIDATION', 'IMPORT_REVIEW_FAILED', `${review.issues.length} masalah ditemukan sebelum import`, {
          issues: review.issues.slice(0, 20),
        });
      } else {
        writeSystemLog('SUCCESS', 'VALIDATION', 'IMPORT_REVIEW_PASSED', `${parsed.rows.length} baris lolos validasi awal`, {
          warnings: review.warnings.length,
        });
      }
      const validationText = review.issues.length
        ? `\n\n**Ditemukan ${review.issues.length} masalah yang harus diperbaiki:**\n${formatImportIssues(review.issues)}\n\nKetik **perbaiki otomatis** agar IDA membersihkan field opsional yang aman diperbaiki.`
        : `\n\n**Validasi awal lulus.** ${review.warnings.length} catatan opsional ditemukan.`;
      const employeeSheets = parsed.diagnostics.filter((sheet) => sheet.kind === 'EMPLOYEE_DATA');
      const ignoredSheets = parsed.diagnostics.filter((sheet) => sheet.kind === 'NON_EMPLOYEE_SHEET').length;
      const sourceText = `**Datasheet:** ${employeeSheets.map((sheet) => `\`${sheet.sheetName}\` (${sheet.accepted} baris)`).join(' · ')}`;
      const workbookText = `Workbook memiliki **${parsed.diagnostics.length} sheet**; **${ignoredSheets} sheet non-karyawan** dikenali dan tidak diperlakukan sebagai baris gagal.`;
      const duplicateText = parsed.duplicateRows ? ` **${parsed.duplicateRows} duplikat NRK** dari sheet lain tidak digandakan.` : '';
      const payrollText = parsed.payrollSummary.gross || parsed.payrollSummary.net
        ? `\n\n**Ringkasan THP terbaca**\n- Gross: **${formatIDR(parsed.payrollSummary.gross)}**\n- Potongan: **${formatIDR(parsed.payrollSummary.deductions)}**\n- Netto/THP: **${formatIDR(parsed.payrollSummary.net)}**`
        : '';
      const tierText = activePlan
        ? `\n\n**Konteks layanan**\n- Klien: **${clientName}**\n- Project: **${projects[0]?.name || 'belum dipasangkan'}**\n- Tier: **${TIER_LABELS[activePlan.tier as ServiceTier]}**`
        : `\n\n**Import ditahan — tier klien belum tersedia.**\nKlien **${clientName}** ${client ? 'sudah ditemukan' : 'belum ada di master data'}. Pilih layanan dengan mengetik **tier 1**, **tier 2**, atau **tier 3**. IDA akan membuat/memasangkan klien, project payroll, dan service plan sebelum import.`;
      await pushIda(
        `File terbaca: **${parsed.rows.length} karyawan**. ${sourceText}\n\n${workbookText}${duplicateText}` +
          (parsed.skipped ? ` **${parsed.skipped} baris** pada datasheet kandidat dilewati karena NRK/nama kosong.` : '') +
          `${payrollText}${tierText}\n\n${sample}${validationText}\n\n` +
          (!activePlan ? 'Pilih tier terlebih dahulu; **import sekarang** belum dapat dijalankan.' : review.issues.length ? 'Ketik **perbaiki otomatis** untuk koreksi aman, atau unggah ulang jika data wajib yang salah.' : 'Ketik **import sekarang** untuk menyimpan.'),
        true,
        ['Membaca struktur file', 'Memeriksa data wajib', review.issues.length ? 'Perlu perbaikan' : 'Siap diimpor']
      );
    } catch (e: any) {
      await pushIda(`Gagal membaca file: ${e?.message || e}`, true, ['Gagal membaca']);
      setPendingRows(null);
      setPendingImportContext(null);
    } finally {
      setCotLive(null);
      setBusy(false);
    }
  }

  async function runImport() {
    if (!pendingRows?.length || !db) {
      await pushIda('Belum ada file. Gunakan 📎 dulu.');
      return;
    }
    if (!pendingImportContext?.clientId || !pendingImportContext.servicePlanId || !pendingImportContext.tier) {
      await pushIda('Import belum dapat dijalankan karena service tier klien belum ditentukan. Ketik **tier 1**, **tier 2**, atau **tier 3**.');
      return;
    }
    setBusy(true);
    setCotLive(['Menyimpan data…', 'Memperbarui ringkasan…']);
    try {
      const res = await fetch('/api/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: pendingRows, context: pendingImportContext }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const issueText = formatImportIssues(Array.isArray(data.issues) ? data.issues : [], 1);
        const reason = issueText || data.message || data.error || `HTTP ${res.status}`;
        setLastImportFailure(reason);
        throw new Error(reason);
      }
      const inserted = data.inserted || 0;
      const updated = data.updated || 0;
      const errors = data.errors || 0;
      const synced = await syncDatabaseFromNeon(db, { requireData: true });
      const newDb = {
        ...synced.db,
        meta: { ...synced.db.meta },
      };
      saveDatabase(newDb);
      setDb(newDb);
      emitDbChange();
      setPendingRows(null);
      setLastImportFailure('');
      writeSystemLog('SUCCESS', 'DATABASE', 'IMPORT_COMMITTED', `Import selesai: ${inserted} baru, ${updated} diperbarui`, {
        inserted,
        updated,
        total: inserted + updated,
      });
      const report = validatePayrollIndonesia(newDb, {
        period: pendingImportContext.period,
        tier: pendingImportContext.tier,
        clientId: pendingImportContext.clientId,
      });
      const actionable = report.issues.filter((issue) => issue.severity !== 'info').map((issue) => ({
        employeeId: issue.employeeId,
        category: issue.code,
        severity: issue.severity === 'error' ? 'CRITICAL' : 'WARNING',
        reason: issue.message,
      }));
      let exceptionCount = 0;
      if (data.submissionId) {
        const exceptionResponse = await fetch('/api/operating-model', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
          action: 'CREATE_VALIDATION_BATCH', submissionId: data.submissionId, issues: actionable,
        }) });
        const exceptionResult = await exceptionResponse.json().catch(() => ({}));
        if (exceptionResponse.ok) exceptionCount = Number(exceptionResult.created || 0);
      }
      await pushIda(
        `Data tersimpan (**${inserted} baru, ${updated} diperbarui, ${errors} gagal**). Dashboard tersinkron **${synced.count} karyawan**.\n\n` +
          `Submission **${data.submissionId || '-'}** dibuat untuk **${TIER_LABELS[pendingImportContext.tier]}**. ` +
          `${exceptionCount} temuan operasional dikirim ke **Exception Center** untuk ditindaklanjuti.\n\n` + formatValidationMarkdown(report),
        true,
        ['Data disimpan', 'Pemeriksaan selesai']
      );
      setPendingImportContext(null);
    } catch (e: any) {
      const reason = String(e?.message || e);
      setLastImportFailure(reason);
      writeSystemLog('ERROR', 'DATABASE', 'IMPORT_REJECTED', reason);
      await pushIda(
        `**Import belum disimpan.**\n\n${reason}\n\nPerbaiki baris tersebut pada Excel, lalu unggah ulang. Tidak ada data parsial yang masuk ke database.`,
        true,
        ['Validasi gagal', 'Transaksi dibatalkan']
      );
    } finally {
      setCotLive(null);
      setBusy(false);
    }
  }

  async function send(messageOverride?: string) {
    const userMsg = (messageOverride ?? input).trim();
    if (!userMsg || !db || busy || typing) return;
    writeSystemLog('INFO', 'IDA', 'MESSAGE_RECEIVED', 'Permintaan pengguna diterima', { characters: userMsg.length });
    setMessages((prev) => [...prev, { role: 'user', text: userMsg }]);
    setInput('');
    setBusy(true);
    setCotLive(['Memahami permintaan…']);

    const incomingTopic = userMsg.toLowerCase();
    const previousTopic = lastTopicRef.current;

    try {
      async function applyResult(result: ReturnType<typeof handleIdaIntent>) {
        let reply = result.reply;
        if (result.pendingPayrollPreview) {
          setPendingPayrollPreview(result.pendingPayrollPreview);
          writeSystemLog('INFO', 'PAYROLL', 'PAYROLL_PREVIEW_CREATED', `Preview payroll ${result.pendingPayrollPreview.period}`, {
            ...result.pendingPayrollPreview,
          });
        }
        if (result.payrollPlanExecuted) {
          setPendingPayrollPreview(null);
          writeSystemLog('SUCCESS', 'PAYROLL', 'PAYROLL_PLAN_EXECUTED', `Plan ${result.payrollPlanExecuted} dieksekusi`);
        }
        if (result.pendingApprovalPreview) {
          setPendingApprovalPreview(result.pendingApprovalPreview);
          writeSystemLog('INFO', 'PAYROLL', 'APPROVAL_PREVIEW_CREATED', `Preview approval ${result.pendingApprovalPreview.period}`, {
            ...result.pendingApprovalPreview,
          });
        }
        if (result.approvalPlanExecuted) {
          setPendingApprovalPreview(null);
          writeSystemLog('SUCCESS', 'PAYROLL', 'APPROVAL_PLAN_EXECUTED', `Plan ${result.approvalPlanExecuted} dieksekusi`);
        }
        if (result.dbChanged && result.newDb) {
          setDb(result.newDb);
          emitDbChange();
          try {
            await persistBusinessState(result.newDb);
          } catch {
            reply += renderMarkdown('\n\n_Data tersimpan di perangkat, tetapi sinkronisasi server belum berhasil._');
          }
        }
        return reply;
      }
      const low = userMsg.toLowerCase();
      if (/^batal$/i.test(userMsg.trim()) && pendingEmailFill) {
        writeSystemLog('INFO', 'HR', 'EMAIL_FILL_PREVIEW_CANCELLED', `Plan ${pendingEmailFill.planId} dibatalkan`);
        setPendingEmailFill(null);
        await pushIda('Preview pengisian email dibatalkan. Tidak ada data yang berubah.', true, ['Preview dibatalkan']);
        return;
      }
      if (/^batal$/i.test(userMsg.trim()) && pendingPayrollPreview) {
        writeSystemLog('INFO', 'PAYROLL', 'PAYROLL_PREVIEW_CANCELLED', `Plan ${pendingPayrollPreview.planId} dibatalkan`);
        setPendingPayrollPreview(null);
        await pushIda('Preview payroll dibatalkan. Tidak ada data yang berubah.', true, ['Preview dibatalkan']);
        return;
      }
      if (/^batal$/i.test(userMsg.trim()) && pendingApprovalPreview) {
        writeSystemLog('INFO', 'PAYROLL', 'APPROVAL_PREVIEW_CANCELLED', `Plan ${pendingApprovalPreview.planId} dibatalkan`);
        setPendingApprovalPreview(null);
        await pushIda('Preview approval dibatalkan. Tidak ada status yang berubah.', true, ['Preview dibatalkan']);
        return;
      }
      if (/\b(batal|jangan|tidak jadi)\b.*\b(hapus|delete)|^batal$/.test(low) && pendingClientDelete) {
        setPendingClientDelete(null);
        writeSystemLog('INFO', 'SECURITY', 'CLIENT_DELETE_CANCELLED', 'Penghapusan klien dibatalkan');
        await pushIda('Penghapusan klien dibatalkan. Tidak ada data yang berubah.', true, ['Membatalkan tindakan']);
        return;
      }
      if (/\b(hapus|delete)\b.*\b(klien|client|perusahaan)\b|\b(klien|client|perusahaan)\b.*\b(hapus|delete)\b/.test(low) && !pendingClientDelete) {
        const target = findClientForDelete(userMsg, db.companies || []);
        if (!target) {
          const names = (db.companies || []).map((company: any) => company.name).join(', ');
          await pushIda(
            `Klien yang dimaksud tidak ditemukan. Klien tersedia: **${names || 'tidak ada'}**. Sebutkan nama klien secara spesifik.`,
            true,
            ['Mencari klien di database']
          );
          return;
        }
        const employeeCount = (db.employees || []).filter((employee: any) => employee.company === target.name).length;
        setPendingClientDelete({ id: target.id, name: target.name, employees: employeeCount });
        writeSystemLog('WARN', 'SECURITY', 'CLIENT_DELETE_REQUESTED', `Penghapusan ${target.name} diminta`, { employees: employeeCount });
        await pushIda(
          `Klien ditemukan: **${target.name}** dengan **${employeeCount} karyawan**. Penghapusan juga menghapus data karyawan, invoice, dan piutang klien tersebut. Detail payroll terkait akan dikeluarkan dan payroll terdampak kembali ke **DRAFT**.\n\nRole akan diverifikasi server. Ketik persis **iya hapus klien** untuk melanjutkan, atau **batal**.`,
          true,
          ['Klien ditemukan', 'Menghitung data terdampak', 'Menunggu konfirmasi']
        );
        return;
      }
      if (pendingClientDelete) {
        if (!/^iya\s+hapus\s+klien[.!]?$/i.test(userMsg.trim())) {
          await pushIda('Belum dihapus. Ketik persis **iya hapus klien** atau **batal**.', true, ['Menjaga tindakan destruktif']);
          return;
        }
        setCotLive(['Memverifikasi role…', 'Menghapus klien secara atomik…', 'Menyinkronkan dashboard…']);
        const response = await fetch('/api/client-delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ clientId: pendingClientDelete.id, confirmation: 'HAPUS KLIEN' }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
          const reason = result.error || result.message || `HTTP ${response.status}`;
          writeSystemLog('ERROR', 'SECURITY', 'CLIENT_DELETE_REJECTED', reason, { client: pendingClientDelete.name });
          await pushIda(`Penghapusan ditolak: **${reason}**. Tidak ada data yang berubah.`, true, ['Verifikasi gagal']);
          return;
        }
        const deletedName = pendingClientDelete.name;
        const synced = await syncDatabaseFromNeon(db, { requireData: true });
        saveDatabase(synced.db);
        setDb(synced.db);
        emitDbChange();
        setPendingClientDelete(null);
        writeSystemLog('SUCCESS', 'SECURITY', 'CLIENT_DELETE_COMPLETED', `${deletedName} berhasil dihapus`, { deleted: result.deleted });
        await pushIda(
          `Klien **${result.deleted?.clientName || deletedName}** dan **${result.deleted?.employees || 0} karyawan terkait** berhasil dihapus. Payroll terdampak dikembalikan ke DRAFT dan dashboard sudah disinkronkan.`,
          true,
          ['Role SUPER_ADMIN terverifikasi', 'Transaksi selesai', 'Dashboard tersinkron']
        );
        return;
      }
            if (/\b(batal|jangan|tidak jadi)\b.*\b(hapus|reset)|^batal$/.test(low) && pendingFullReset) {
        setPendingFullReset(false);
        writeSystemLog('INFO', 'SECURITY', 'FULL_RESET_CANCELLED', 'Permintaan penghapusan seluruh data dibatalkan');
        await pushIda('Penghapusan dibatalkan. Tidak ada data yang berubah.', true, ['Membatalkan tindakan']);
        return;
      }
      if (/\b(hapus|reset)\s+(semua|seluruh)\s+data\b/.test(low) && !pendingFullReset) {
        setPendingFullReset(true);
        writeSystemLog('WARN', 'SECURITY', 'FULL_RESET_REQUESTED', 'Penghapusan seluruh data diminta');
        await pushIda(
          `Permintaan ini akan menghapus **seluruh data operasional**: ${db.employees?.length || 0} karyawan, klien, payroll, invoice, payment, dan piutang. Organisasi serta konfigurasi aplikasi tetap dipertahankan.\n\nRole akan diverifikasi oleh server. Untuk melanjutkan, ketik persis: **iya hapus sekarang**. Ketik **batal** untuk membatalkan.`,
          true,
          ['Mengidentifikasi tindakan permanen', 'Menunggu konfirmasi eksplisit']
        );
        return;
      }
      if (pendingFullReset) {
        if (!/^iya\s+hapus\s+sekarang[.!]?$/i.test(userMsg.trim())) {
          await pushIda(
            'Belum dihapus. Konfirmasi belum sesuai. Ketik persis **iya hapus sekarang** atau **batal**.',
            true,
            ['Menjaga tindakan destruktif']
          );
          return;
        }
        setCotLive(['Memverifikasi role…', 'Menghapus data dalam satu transaksi…', 'Menyinkronkan dashboard…']);
        const response = await fetch('/api/reset', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ confirmation: 'HAPUS SEMUA DATA' }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
          const reason = result.error || result.message || `HTTP ${response.status}`;
          writeSystemLog('ERROR', 'SECURITY', 'FULL_RESET_REJECTED', reason);
          await pushIda(`Penghapusan ditolak: **${reason}**. Tidak ada data yang berubah.`, true, ['Verifikasi gagal']);
          return;
        }
        const synced = await syncDatabaseFromNeon(db, { requireData: true });
        saveDatabase(synced.db);
        setDb(synced.db);
        emitDbChange();
        setPendingFullReset(false);
        writeSystemLog('SUCCESS', 'SECURITY', 'FULL_RESET_COMPLETED', 'Seluruh data operasional berhasil dihapus', {
          deleted: result.deleted,
          actorVerified: true,
        });
        await pushIda(
          `Seluruh data operasional berhasil dihapus secara atomik.\n\nTerhapus: **${result.deleted?.employees || 0} karyawan**, **${result.deleted?.clients || 0} klien**, **${result.deleted?.payrolls || 0} payroll**, dan **${result.deleted?.invoices || 0} invoice**. Organisasi dan konfigurasi aplikasi tetap tersedia.`,
          true,
          ['Role SUPER_ADMIN terverifikasi', 'Transaksi selesai', 'Dashboard tersinkron']
        );
        return;
      }
      if (/\b(perbaiki|koreksi|bersihkan).*(otomatis|sendiri)?|\b(bisa|dapat).*(perbaiki|koreksi)\b/.test(low) && pendingRows?.length) {
        const fixed = autoFixImportRows(pendingRows);
        if (!fixed.changes.length) {
          await pushIda('Tidak ada field opsional yang dapat diperbaiki otomatis. Masalah pada NRK, nama, atau gaji memerlukan nilai sumber yang benar.', true, ['Memeriksa batas koreksi aman']);
          return;
        }
        setPendingRows(fixed.rows);
        setLastImportFailure('');
        writeSystemLog('SUCCESS', 'IDA', 'IMPORT_AUTOFIX_APPLIED', `${fixed.changes.length} field diperbaiki di staging`, {
          changes: fixed.changes,
        });
        const preview = fixed.changes
          .slice(0, 12)
          .map((item) => `- Baris ${item.row} · **${item.field}**: \`${item.before}\` → **${item.after}**`)
          .join('\n');
        await pushIda(
          `IDA sudah memperbaiki **${fixed.changes.length} field opsional** pada data staging:\n\n${preview}\n\nNilai **-** disimpan sebagai kosong agar sesuai tipe database. File asli tidak diubah. Ketik **import sekarang** untuk menyimpan hasil koreksi ke database.`,
          true,
          ['Mengidentifikasi koreksi aman', 'Memperbaiki data staging', 'Menunggu konfirmasi import']
        );
        return;
      }
      if (
        /\b(perbaiki|isi|masukkan|buat|tambahkan)\b.*\bemail\b.*\b(kosong|dummy|placeholder)\b/.test(low) ||
        /\bemail\s+(dummy|placeholder)\b/.test(low)
      ) {
        const missing = (db.employees || []).filter((employee: any) => !String(employee.email || '').trim());
        if (!missing.length) {
          await pushIda('Tidak ada email karyawan yang kosong. Tidak ada data yang diubah.', true, ['Memeriksa data karyawan']);
          return;
        }
        const company = missing[0]?.company || db.companies?.[0]?.name || 'perusahaan';
        const domain = companyPlaceholderDomain(company);
        const preview: PendingEmailFill = {
          planId: emailFillPlanId(missing, domain),
          domain,
          expectedCount: missing.length,
          samples: missing.slice(0, 5).map((employee: any) => ({
            name: employee.name,
            email: placeholderEmail(employee, domain),
          })),
        };
        setPendingEmailFill(preview);
        writeSystemLog('INFO', 'HR', 'EMAIL_FILL_PREVIEW_CREATED', `Preview ${missing.length} email placeholder`, preview);
        const samples = preview.samples
          .map((item) => `- **${item.name}** → \`${item.email}\``)
          .join('\n');
        await pushIda(
          `**Preview pengisian email — belum dieksekusi**\n\n` +
            `- Karyawan terdampak: **${preview.expectedCount}**\n` +
            `- Domain placeholder: \`${preview.domain}\`\n` +
            `- Alamat tidak dapat menerima email karena memakai domain **.invalid**.\n\n` +
            `**Contoh**\n${samples}\n\n` +
            `Ketik persis **konfirmasi email ${preview.planId}** untuk menyimpan, atau **batal**.`,
          true,
          ['HR Staff memeriksa email kosong', 'Menyiapkan preview', 'Menunggu konfirmasi']
        );
        return;
      }
      if (pendingEmailFill) {
        const expected = `konfirmasi email ${pendingEmailFill.planId}`.toLowerCase();
        if (low !== expected) {
          await pushIda(
            `Preview **${pendingEmailFill.expectedCount} email** sudah siap dengan domain \`${pendingEmailFill.domain}\`. ` +
              `Untuk keamanan, ketik persis **konfirmasi email ${pendingEmailFill.planId}** atau **batal**.`,
            true,
            ['Menjaga konfirmasi tindakan HR']
          );
          return;
        }
        setCotLive(['Memverifikasi role HR…', 'Mengubah email secara atomik…', 'Menyinkronkan dashboard…']);
        const response = await fetch('/api/employee-email-fill', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            confirmation: 'ISI EMAIL DUMMY',
            planId: pendingEmailFill.planId,
            domain: pendingEmailFill.domain,
            expectedCount: pendingEmailFill.expectedCount,
          }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
          const reason = result.error || `HTTP ${response.status}`;
          writeSystemLog('ERROR', 'HR', 'EMAIL_FILL_REJECTED', reason, { planId: pendingEmailFill.planId });
          if (response.status === 409) setPendingEmailFill(null);
          await pushIda(`Pengisian email ditolak: **${reason}**. Tidak ada perubahan parsial.`, true, ['Transaksi dibatalkan']);
          return;
        }
        const synced = await syncDatabaseFromNeon(db, { requireData: true });
        saveDatabase(synced.db);
        setDb(synced.db);
        emitDbChange();
        setPendingEmailFill(null);
        writeSystemLog('SUCCESS', 'HR', 'EMAIL_FILL_COMPLETED', `${result.updated} email placeholder tersimpan`, result);
        await pushIda(
          `Berhasil mengisi **${result.updated} email placeholder** secara atomik dengan domain \`${result.domain}\`. ` +
            `Dashboard sudah disinkronkan. Alamat tersebut tetap ditandai nonaktif untuk pengiriman payslip.`,
          true,
          ['Role terverifikasi', 'Transaksi selesai', 'Dashboard tersinkron']
        );
        return;
      }
      if (/\b(kenapa|mengapa|apa penyebab).*(gagal|error)|\b(gagal|error).*(kenapa|mengapa|penyebab)\b/.test(low) && lastImportFailure) {
        await pushIda(
          `Import terakhir gagal karena:\n\n${lastImportFailure}\n\nTidak terkait database yang masih kosong. Silakan perbaiki baris tersebut lalu unggah ulang.`,
          true,
          ['Membaca hasil validasi terakhir']
        );
        return;
      }
      const tierChoice = pendingRows?.length && pendingImportContext && low.match(/^(?:pilih\s+|set\s+)?tier\s*([123])$/i);
      if (tierChoice) {
        if (!['SUPER_ADMIN', 'PAYROLL_PROCESSOR'].includes(String(actorContext.currentRole))) {
          await pushIda('Service tier hanya dapat ditetapkan oleh **SUPER_ADMIN** atau **PAYROLL_PROCESSOR**. Hubungi tim ProQPay; file tetap tersimpan di staging browser dan belum diimpor.', true, ['Memeriksa otorisasi tier']);
          return;
        }
        const tierMap: Record<string, ServiceTier> = {
          '1': 'TIER_1_PAYMENT_PROCESSING', '2': 'TIER_2_MANAGED_PAYROLL', '3': 'TIER_3_INTEGRATED_AUTOMATION',
        };
        const tier = tierMap[tierChoice[1]];
        setCotLive(['Memeriksa master klien…', 'Memasangkan project…', 'Mengaktifkan service tier…']);
        let clientId = pendingImportContext.clientId;
        let projectId = pendingImportContext.projectId;
        if (!clientId) {
          const response = await fetch('/api/client-projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
            action: 'CREATE_CLIENT', name: pendingImportContext.clientName,
          }) });
          const result = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(result.error || 'Gagal membuat klien');
          clientId = result.client.id;
        }
        if (!projectId) {
          const response = await fetch('/api/client-projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
            action: 'CREATE_PROJECT', clientId,
            name: `${pendingImportContext.clientName} — Payroll`,
          }) });
          const result = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(result.error || 'Gagal membuat project payroll');
          projectId = result.project.id;
        }
        const planResponse = await fetch('/api/operating-model', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
          action: 'CREATE_SERVICE_PLAN', clientId, tier, effectiveFrom: new Date().toISOString().slice(0, 10),
        }) });
        const planResult = await planResponse.json().catch(() => ({}));
        if (!planResponse.ok) throw new Error(planResult.error || 'Gagal mengaktifkan service tier');
        setPendingImportContext({ ...pendingImportContext, clientId, projectId, tier, servicePlanId: planResult.servicePlan.id });
        await pushIda(
          `Konteks import siap:\n\n- Klien: **${pendingImportContext.clientName}**\n- Project: **${pendingImportContext.clientName} — Payroll**\n- Tier: **${TIER_LABELS[tier]}**\n\nValidasi berikutnya akan memakai mandatory field khusus tier ini. Ketik **import sekarang** untuk menyimpan.`,
          true, ['Klien terpasang', 'Project terpasang', 'Service tier aktif']
        );
        return;
      }
      if (
        pendingRows?.length &&
        /^(?:(?:iya|ya|ok|oke)\s+)?(?:import|simpan)(?:\s+sekarang)?[.!]?$/.test(low)
      ) {
        await runImport();
        return;
      }
      if (/\b(batal import)\b/.test(low)) {
        setPendingRows(null);
        setPendingImportContext(null);
        await pushIda('Antrian dibatalkan.');
        return;
      }
      if (/\b(upload|import|excel|lampir)\b/.test(low) && !pendingRows?.length) {
        if (/\b(buatkan|buat|ekspor|export)\b.*\bexcel\b/.test(low)) {
          await pushIda(
            'Ekspor Excel belum tersedia pada alur chat ini. Saya tidak akan mengklaim file sudah dibuat. Data dapat ditampilkan sebagai tabel faktual di chat.',
            true,
            ['Memeriksa kemampuan aplikasi']
          );
          return;
        }
        await pushIda('Gunakan tombol **📎** di bawah, lalu ketik **import sekarang**.', true, ['Arahkan unggah file']);
        return;
      }

      const mapped = mapConfirmToAction(userMsg, previousTopic);
      if (looksLikeLocalAction(userMsg) || /invoice|payroll|gaji|approval|approve|approved|setuju|payment|pembayaran|upload|bpjs|validasi|ready|siap|tabel|per karyawan|terendah|tertinggi|paling kecil|paling besar/.test(incomingTopic)) {
        lastTopicRef.current = incomingTopic;
      } else if (mapped !== userMsg) {
        lastTopicRef.current = mapped;
      }
      if (looksLikeLocalAction(userMsg) || mapped !== userMsg) {
        setCotLive(['Menyiapkan jawaban…', `Menjalankan: ${mapped}`]);
        const result = handleIdaIntent(mapped, db, actorContext, {
          confirmedPayrollPlanId: pendingPayrollPreview?.planId,
          confirmedApprovalPlanId: pendingApprovalPreview?.planId,
        });
        await pushIda(await applyResult(result), false, ['Selesai']);
        return;
      }

      setCotLive(['Mencari informasi terkait…', 'Menyusun jawaban…']);
      const res = await fetch('/api/ida', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userMsg, context: buildContext(db), sessionId, responseStyle: compactResponses ? 'compact' : 'standard' }),
      });
      const data = await res.json();
      if (
        data.ok &&
        data.reply &&
        !looksLikePromptLeak(String(data.reply)) &&
        !looksLikeUnverifiedMutationClaim(String(data.reply))
      ) {
        const cot =
          cleanCot(data.cot?.lines) ||
          cleanCot([
            data.cot?.webTriggers?.length ? 'Memeriksa aturan terkait' : '',
            'Menyusun jawaban',
          ]);
        await pushIda(data.reply, true, cot);
        return;
      }
      if (data?.reply && looksLikePromptLeak(String(data.reply))) {
        writeSystemLog('ERROR', 'IDA', 'PROMPT_LEAK_BLOCKED', 'Respons model yang memuat instruksi internal diblokir');
      }
      if (data?.reply && looksLikeUnverifiedMutationClaim(String(data.reply))) {
        writeSystemLog('ERROR', 'IDA', 'UNVERIFIED_MUTATION_BLOCKED', 'Klaim mutasi tanpa transaksi diblokir');
      }
      const result = handleIdaIntent(userMsg, db, actorContext, {
        confirmedPayrollPlanId: pendingPayrollPreview?.planId,
        confirmedApprovalPlanId: pendingApprovalPreview?.planId,
      });
      await pushIda(await applyResult(result), false, ['Selesai']);
    } catch (error) {
      if (pendingRows?.length && /^(?:pilih\s+|set\s+)?tier\s*[123]$/i.test(userMsg.toLowerCase())) {
        await pushIda(`Konteks tier belum berhasil disimpan: **${error instanceof Error ? error.message : 'kesalahan sistem'}**. Tidak ada data karyawan yang diimpor.`, true, ['Konfigurasi tier gagal']);
        return;
      }
      const result = handleIdaIntent(userMsg, db, actorContext, {
        confirmedPayrollPlanId: pendingPayrollPreview?.planId,
        confirmedApprovalPlanId: pendingApprovalPreview?.planId,
      });
      if (result.dbChanged && result.newDb) {
        setDb(result.newDb);
        emitDbChange();
        persistBusinessState(result.newDb).catch(() => {
          // Mirror lokal tetap tersedia bila koneksi server terputus.
        });
      }
      await pushIda(result.reply, false);
    } finally {
      setCotLive(null);
      setBusy(false);
    }
  }

  function clearConversation() {
    typingCancel.current = true;
    setMessages([INITIAL_MESSAGE]);
    setInput('');
    setCotLive(null);
    setPendingRows(null);
    setPendingImportContext(null);
    setLastImportFailure('');
    setPendingPayrollPreview(null);
    setPendingApprovalPreview(null);
    setPendingEmailFill(null);
    lastTopicRef.current = '';
  }

  const panelStyle: React.CSSProperties = expanded
    ? { position: 'fixed', top: 0, right: 0, width: 'min(640px, 52vw)', minWidth: 360, height: '100dvh', borderRadius: 0, zIndex: 90 }
    : {
        position: 'fixed',
        bottom: 90,
        right: 26,
        width: 440,
        maxWidth: 'calc(100vw - 52px)',
        height: 620,
        maxHeight: 'calc(100vh - 140px)',
        borderRadius: 'var(--r-xl)',
        zIndex: 90,
      };

  const currentPeriod = db?.meta?.currentPeriod || 'Belum dipilih';
  const employeeCount = Array.isArray(db?.employees) ? db.employees.length : 0;
  const healthLabel = health === 'online' ? 'Database terhubung' : health === 'checking' ? 'Memeriksa sistem' : 'Koneksi terbatas';

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="ida-fab"
        aria-label={open ? 'Tutup IDA' : 'Buka IDA'}
        aria-expanded={open}
        style={{
          position: 'fixed',
          bottom: 26,
          right: 26,
          zIndex: 50,
          display: expanded && open ? 'none' : 'flex',
          alignItems: 'center',
          gap: 11,
          padding: '6px 20px 6px 6px',
          background: 'var(--bg-surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--r-pill)',
          boxShadow: 'var(--shadow-fab)',
          cursor: 'pointer',
        }}
      >
        <img src={IDA_AVATAR} alt="IDA" style={{ width: 42, height: 42, borderRadius: '50%', objectFit: 'cover' }} />
        <div style={{ textAlign: 'left' }}>
          <div style={{ fontSize: 14, fontWeight: 700 }}>Ask IDA</div>
          <div style={{ fontSize: 10.5, color: 'var(--text2)' }}>Asisten payroll</div>
        </div>
      </button>

      {open && (
        <div
          className="ida-panel"
          role="dialog"
          aria-label="IDA Payroll Copilot"
          style={{
            ...panelStyle,
            background: 'var(--bg-surface)',
            border: '1px solid var(--border)',
            boxShadow: 'var(--shadow-lg)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          <div className="ida-header">
            <img src={IDA_AVATAR} alt="" style={{ width: 42, height: 42, borderRadius: '50%', objectFit: 'cover', border: '2px solid rgba(255,255,255,.55)' }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 15, fontWeight: 750 }}>IDA Payroll Copilot</div>
              <div className="ida-system-status" aria-live="polite">
                <span className={`ida-status-dot ida-status-${health}`} />
                {busy || typing ? 'Sedang bekerja' : pendingRows ? `${pendingRows.length} baris siap diimpor` : healthLabel}
              </div>
            </div>
            <button type="button" className="ida-icon-button" aria-label="Mulai percakapan baru" title="Percakapan baru" onClick={clearConversation}>
              ↻
            </button>
            <button type="button" className="ida-icon-button" aria-label={expanded ? 'Kecilkan panel IDA' : 'Perbesar panel IDA'} onClick={() => setExpanded((e) => !e)}>
              {expanded ? '⛶' : '⤢'}
            </button>
            <button
              type="button"
              className="ida-icon-button"
              aria-label="Tutup IDA"
              onClick={() => {
                setOpen(false);
                setExpanded(false);
              }}
            >
              ✕
            </button>
          </div>

          <div className="ida-context-bar">
            <span><small>Periode</small>{currentPeriod}</span>
            <span><small>Karyawan</small>{employeeCount}</span>
            <span><small>Akses</small>{actorContext.currentRole || 'CLIENT_USER'}</span>
          </div>

          <div ref={scrollRef} className="ida-message-list" role="log" aria-live="polite" aria-relevant="additions">
            {messages.map((m, i) => (
              <div key={i} style={{ maxWidth: '92%', alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
                {showCot && m.role === 'ida' && m.cot && m.cot.length > 0 && (
                  <details style={{ marginBottom: 6, fontSize: 11, color: 'var(--text3)' }}>
                    <summary style={{ cursor: 'pointer', fontWeight: 650 }}>Langkah kerja</summary>
                    <ol style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                      {m.cot.map((c, j) => (
                        <li key={j}>{c}</li>
                      ))}
                    </ol>
                  </details>
                )}
                <div
                  style={{
                    padding: '11px 15px',
                    borderRadius: 'var(--r-md)',
                    fontSize: 13,
                    lineHeight: 1.55,
                    background: m.role === 'user' ? 'linear-gradient(135deg, var(--accent), var(--accent2))' : 'var(--bg-subtle)',
                    color: m.role === 'user' ? '#fff' : 'var(--text)',
                    border: m.role === 'ida' ? '1px solid var(--border-soft)' : 'none',
                    whiteSpace: m.html ? undefined : 'pre-wrap',
                  }}
                  {...(m.html
                    ? { dangerouslySetInnerHTML: { __html: m.text } }
                    : { children: m.text })}
                />
              </div>
            ))}

            {autoSuggestions && messages.length === 1 && !busy && !typing ? (
              <div className="ida-quick-actions" aria-label="Aksi cepat IDA">
                {QUICK_ACTIONS.map((action) => (
                  <button key={action.label} type="button" onClick={() => void send(action.prompt)}>
                    {action.label}
                  </button>
                ))}
              </div>
            ) : null}

            {showCot && cotLive && cotLive.length > 0 && (
              <div
                style={{
                  alignSelf: 'flex-start',
                  fontSize: 11,
                  color: 'var(--text3)',
                  padding: '8px 12px',
                  borderRadius: 10,
                  background: 'var(--bg-subtle)',
                  border: '1px dashed var(--border)',
                }}
              >
                <strong>Sedang bekerja…</strong>
                <ol style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                  {cotLive.map((c, j) => (
                    <li key={j}>{c}</li>
                  ))}
                </ol>
              </div>
            )}
          </div>

          <div className="ida-footer">
            <div className="ida-composer">
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,.xls"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFile(f);
                  e.target.value = '';
                }}
              />
              <button type="button" className="ida-attach-button" aria-label="Unggah file Excel" title="Unggah Excel" disabled={busy || typing} onClick={() => fileRef.current?.click()}>
                📎
              </button>
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void send();
                  }
                }}
                rows={1}
                aria-label="Pesan untuk IDA"
                placeholder="Tanyakan payroll, BPJS, invoice, atau data…"
                disabled={busy || typing}
              />
              <button
                type="button"
                className="ida-send-button"
                aria-label="Kirim pesan"
                onClick={() => void send()}
                disabled={busy || typing || !input.trim()}
              >
                ➤
              </button>
            </div>
            <div className="ida-input-hint">Enter untuk kirim · Shift+Enter untuk baris baru</div>
          </div>
        </div>
      )}
    </>
  );
}
