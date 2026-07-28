'use client';

import { useState, useEffect, useRef } from 'react';
import { loadDatabase, saveDatabase } from '@/lib/database';
import {
  handleIdaIntent,
  type PendingApprovalPreview,
  type PendingPayrollPreview,
} from '@/lib/ida-simple';
import { emitDbChange } from '@/lib/events';
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

type Msg = { role: 'ida' | 'user'; text: string; cot?: string[]; html?: boolean };

function cleanCot(list?: string[] | null) {
  if (!list) return undefined;
  const x = list.map((s) => String(s || '').trim()).filter(Boolean);
  return x.length ? x : undefined;
}

type ImportIssue = { row?: number; field?: string; message?: string };

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
    /\b(help|bantuan|next|status|ringkasan|validasi|cek data|kelengkapan|siap|ready|bersihkan|perbaiki|koreksi|rincian|perincian|breakdown|komponen|detail|tabel|terendah|tertinggi|paling kecil|paling besar|resign|nonaktif|import|upload|audit|umr|daftar)\b/.test(t) ||
    /^(iya|iy|yes|ok|oke|ya|y|generate|kirim|buatkan|proses|eksekusi)\b/.test(t)
  );
}

function mapConfirmToAction(text: string, lastUserHint?: string) {
  const t = text.toLowerCase().trim();
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
  const [messages, setMessages] = useState<Msg[]>([
    {
      role: 'ida',
      text: renderMarkdown('Hai, aku **IDA**. Bisa bantu payroll, BPJS, invoice, atau unggah data lewat 📎.'),
      html: true,
    },
  ]);
  const [input, setInput] = useState('');
  const [db, setDb] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [typing, setTyping] = useState(false);
  const [pendingRows, setPendingRows] = useState<ParsedEmployee[] | null>(null);
  const [lastImportFailure, setLastImportFailure] = useState('');
  const [pendingFullReset, setPendingFullReset] = useState(false);
  const [pendingClientDelete, setPendingClientDelete] = useState<{ id: string; name: string; employees: number } | null>(null);
  const [cotLive, setCotLive] = useState<string[] | null>(null);
  const [showCot, setShowCot] = useState(true);
  const [typingMs, setTypingMs] = useState(28);
  const [actorContext, setActorContext] = useState<Partial<SharedContext>>({
    currentUser: { email: 'unknown@local' },
    currentRole: 'VIEWER',
    permissions: [],
  });
  const [pendingPayrollPreview, setPendingPayrollPreview] = useState<PendingPayrollPreview | null>(null);
  const [pendingApprovalPreview, setPendingApprovalPreview] = useState<PendingApprovalPreview | null>(null);
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
    const controller = new AbortController();
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
          writeSystemLog('WARN', 'SECURITY', 'IDA_CONTEXT_FALLBACK', 'Identitas IDA menggunakan role VIEWER', {
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
    });
    return () => {
      controller.abort();
      unsubscribe();
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
      writeSystemLog('INFO', 'IDA', 'FILE_PARSED', `${file.name}: ${parsed.rows.length} baris terbaca`, {
        fileName: file.name,
        rows: parsed.rows.length,
        skipped: parsed.skipped,
      });
      setPendingRows(parsed.rows);
      setLastImportFailure('');
      const review = inspectParsedRows(parsed.rows);
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
      await pushIda(
        `File terbaca: **${parsed.rows.length}** baris; **${parsed.skipped}** baris dilewati karena NRK/nama kosong.\n\n${sample}${validationText}\n\n` +
          (review.issues.length ? 'Ketik **perbaiki otomatis** untuk koreksi aman, atau unggah ulang jika data wajib yang salah.' : 'Ketik **import sekarang** untuk menyimpan.'),
        true,
        ['Membaca struktur file', 'Memeriksa data wajib', review.issues.length ? 'Perlu perbaikan' : 'Siap diimpor']
      );
    } catch (e: any) {
      await pushIda(`Gagal membaca file: ${e?.message || e}`, true, ['Gagal membaca']);
      setPendingRows(null);
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
    setBusy(true);
    setCotLive(['Menyimpan data…', 'Memperbarui ringkasan…']);
    try {
      const res = await fetch('/api/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: pendingRows }),
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
        meta: {
          ...synced.db.meta,
          lastImportAt: Date.now(),
        },
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
      const report = validatePayrollIndonesia(newDb);
      await pushIda(
        `Data tersimpan (**${inserted} baru, ${updated} diperbarui, ${errors} gagal**). Dashboard tersinkron **${synced.count} karyawan**.\n\n` +
          formatValidationMarkdown(report),
        true,
        ['Data disimpan', 'Pemeriksaan selesai']
      );
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

  async function send() {
    if (!input.trim() || !db || busy || typing) return;
    const userMsg = input.trim();
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
      if (/\b(kenapa|mengapa|apa penyebab).*(gagal|error)|\b(gagal|error).*(kenapa|mengapa|penyebab)\b/.test(low) && lastImportFailure) {
        await pushIda(
          `Import terakhir gagal karena:\n\n${lastImportFailure}\n\nTidak terkait database yang masih kosong. Silakan perbaiki baris tersebut lalu unggah ulang.`,
          true,
          ['Membaca hasil validasi terakhir']
        );
        return;
      }
      if (/\b(import sekarang|simpan import)\b/.test(low)) {
        await runImport();
        return;
      }
      if (/\b(batal import)\b/.test(low)) {
        setPendingRows(null);
        await pushIda('Antrian dibatalkan.');
        return;
      }
      if (/\b(upload|import|excel|lampir)\b/.test(low) && !pendingRows?.length) {
        await pushIda('Gunakan tombol **📎** di bawah, lalu ketik **import sekarang**.', true, ['Arahkan unggah file']);
        return;
      }

      const mapped = mapConfirmToAction(userMsg, previousTopic);
      if (/invoice|payroll|gaji|approval|approve|approved|setuju|payment|pembayaran|upload|bpjs|validasi|ready|siap|tabel|per karyawan|terendah|tertinggi|paling kecil|paling besar/.test(incomingTopic)) {
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
        body: JSON.stringify({ message: userMsg, context: buildContext(db), sessionId }),
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
    } catch {
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

  const panelStyle: React.CSSProperties = expanded
    ? { position: 'fixed', top: 0, right: 0, width: '50vw', minWidth: 320, height: '100vh', borderRadius: 0, zIndex: 90 }
    : {
        position: 'fixed',
        bottom: 90,
        right: 26,
        width: 400,
        maxWidth: 'calc(100vw - 52px)',
        height: 540,
        maxHeight: 'calc(100vh - 140px)',
        borderRadius: 'var(--r-xl)',
        zIndex: 90,
      };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(!open)}
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', borderBottom: '1px solid var(--border)' }}>
            <img src={IDA_AVATAR} alt="IDA" style={{ width: 40, height: 40, borderRadius: '50%', objectFit: 'cover' }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 15, fontWeight: 700 }}>IDA</div>
              <div style={{ fontSize: 12, color: 'var(--text2)' }}>
                {busy || typing ? 'Mengetik…' : pendingRows ? `${pendingRows.length} file siap` : 'Online'}
              </div>
            </div>
            <button type="button" className="btn" style={{ width: 30, height: 30, padding: 0 }} onClick={() => setExpanded((e) => !e)}>
              {expanded ? '⛶' : '⤢'}
            </button>
            <button
              type="button"
              className="btn"
              style={{ width: 30, height: 30, padding: 0 }}
              onClick={() => {
                setOpen(false);
                setExpanded(false);
              }}
            >
              ✕
            </button>
          </div>

          <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            {messages.map((m, i) => (
              <div key={i} style={{ maxWidth: '92%', alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
                {showCot && m.role === 'ida' && m.cot && m.cot.length > 0 && (
                  <details style={{ marginBottom: 6, fontSize: 11, color: 'var(--text3)' }}>
                    <summary style={{ cursor: 'pointer', fontWeight: 650 }}>Alur berpikir</summary>
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
                  {...(m.html || m.role === 'ida'
                    ? { dangerouslySetInnerHTML: { __html: m.role === 'user' ? m.text.replace(/</g, '<') : m.text } }
                    : { children: m.text })}
                />
              </div>
            ))}

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

          <div style={{ padding: '12px 16px 16px', borderTop: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', background: 'var(--bg-subtle)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', padding: 6 }}>
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
              <button type="button" disabled={busy || typing} onClick={() => fileRef.current?.click()} style={{ width: 34, height: 34, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-surface)', cursor: 'pointer' }}>
                📎
              </button>
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && send()}
                placeholder="Tulis pesan…"
                disabled={busy || typing}
                style={{ flex: 1, border: 'none', background: 'transparent', outline: 'none', fontSize: 13, fontFamily: 'inherit' }}
              />
              <button
                type="button"
                onClick={send}
                disabled={busy || typing}
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 8,
                  border: 'none',
                  background: 'linear-gradient(135deg, var(--accent), var(--accent2))',
                  color: '#fff',
                  cursor: 'pointer',
                }}
              >
                ➤
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
