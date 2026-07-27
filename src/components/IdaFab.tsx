'use client';

import { useState, useEffect, useRef } from 'react';
import { loadDatabase, saveDatabase } from '@/lib/database';
import { handleIdaIntent } from '@/lib/ida-simple';
import { emitDbChange } from '@/lib/events';
import { renderMarkdown } from '@/lib/markdown';
import { calcMargin } from '@/lib/margin';
import { formatIDR } from '@/lib/format';
import { getIdaSessionId } from '@/lib/session';
import { parseIapWorkbook, type ParsedEmployee } from '@/lib/excel-iap';
import { validatePayrollIndonesia, formatValidationMarkdown } from '@/lib/payroll-validate';
import { loadSettings, onSettingsChange } from '@/lib/app-settings';
import { persistBusinessState, syncDatabaseFromNeon } from '@/lib/neon-sync';

const IDA_AVATAR = 'https://user.uploads.dev/file/bf193782176dd9739d8c52e33f3b1378.jpg';

type Msg = { role: 'ida' | 'user'; text: string; cot?: string[]; html?: boolean };

function cleanCot(list?: string[] | null) {
  if (!list) return undefined;
  const x = list.map((s) => String(s || '').trim()).filter(Boolean);
  return x.length ? x : undefined;
}

function looksLikeLocalAction(text: string) {
  const t = text.toLowerCase();
  return (
    /\b(margin|laba|profit|bpjs|iuran|jht|jkk|jkm|jkn|provinsi|wilayah)\b/.test(t) ||
    /\b(hitung payroll|ajukan approval|payment instruction|buat invoice|invoice|tandai paid|unduh payment)\b/.test(t) ||
    /\b(help|bantuan|next|status|ringkasan|validasi|import|upload|audit|umr|daftar)\b/.test(t) ||
    /^(iya|yes|ok|oke|ya|generate|kirim|proses)\b/.test(t)
  );
}

function mapConfirmToAction(text: string, lastUserHint?: string) {
  const t = text.toLowerCase().trim();
  if (/^(iya|yes|ok|oke|ya|generate|kirim|proses)\b/.test(t)) {
    return lastUserHint && /invoice/.test(lastUserHint) ? 'buat invoice' : 'buat invoice';
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
  const [cotLive, setCotLive] = useState<string[] | null>(null);
  const [showCot, setShowCot] = useState(true);
  const [typingMs, setTypingMs] = useState(28);
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
    syncDatabaseFromNeon(localDb, { signal: controller.signal })
      .then((result) => {
        if (!result.synced) return;
        saveDatabase(result.db);
        setDb(result.db);
        emitDbChange();
      })
      .catch(() => {
        // Tetap gunakan mirror lokal saat Neon tidak dapat dijangkau.
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
      setPendingRows(parsed.rows);
      const sample = parsed.rows
        .slice(0, 3)
        .map((r) => `- **${r.name}** → **${r.province}**`)
        .join('\n');
      await pushIda(
        `File terbaca: **${parsed.rows.length}** baris.\n\n${sample}\n\nKetik **import sekarang** untuk menyimpan.`,
        true,
        ['File dibaca', `${parsed.rows.length} baris siap`]
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
      let inserted = 0,
        updated = 0,
        errors = 0;
      for (let i = 0; i < pendingRows.length; i += 40) {
        const chunk = pendingRows.slice(i, i + 40);
        const res = await fetch('/api/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rows: chunk }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || data.message || `HTTP ${res.status}`);
        inserted += data.inserted || 0;
        updated += data.updated || 0;
        errors += data.errors || 0;
      }
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
      const report = validatePayrollIndonesia(newDb);
      await pushIda(
        `Data tersimpan (**${inserted} baru, ${updated} diperbarui, ${errors} gagal**). Dashboard tersinkron **${synced.count} karyawan**.\n\n` +
          formatValidationMarkdown(report),
        true,
        ['Data disimpan', 'Pemeriksaan selesai']
      );
    } catch (e: any) {
      await pushIda(`Gagal menyimpan: **${e?.message || e}**`, true, ['Gagal menyimpan']);
    } finally {
      setCotLive(null);
      setBusy(false);
    }
  }

  async function send() {
    if (!input.trim() || !db || busy || typing) return;
    const userMsg = input.trim();
    setMessages((prev) => [...prev, { role: 'user', text: userMsg }]);
    setInput('');
    setBusy(true);
    setCotLive(['Memahami permintaan…']);

    if (/invoice|payroll|upload|bpjs|validasi/.test(userMsg.toLowerCase())) lastTopicRef.current = userMsg.toLowerCase();

    try {
      async function applyResult(result: ReturnType<typeof handleIdaIntent>) {
        let reply = result.reply;
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

      const mapped = mapConfirmToAction(userMsg, lastTopicRef.current);
      if (looksLikeLocalAction(userMsg) || mapped !== userMsg) {
        setCotLive(['Menyiapkan jawaban…', `Menjalankan: ${mapped}`]);
        const result = handleIdaIntent(mapped, db);
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
      if (data.ok && data.reply) {
        const cot =
          cleanCot(data.cot?.lines) ||
          cleanCot([
            data.cot?.webTriggers?.length ? 'Memeriksa aturan terkait' : '',
            'Menyusun jawaban',
          ]);
        await pushIda(data.reply, true, cot);
        return;
      }
      const result = handleIdaIntent(userMsg, db);
      await pushIda(await applyResult(result), false, ['Selesai']);
    } catch {
      const result = handleIdaIntent(userMsg, db);
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
