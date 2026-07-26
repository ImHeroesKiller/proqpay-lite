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

const IDA_AVATAR = 'https://user.uploads.dev/file/bf193782176dd9739d8c52e33f3b1378.jpg';

type Msg = {
  role: 'ida' | 'user';
  text: string;
  cot?: string[];
};

function looksLikeLocalAction(text: string) {
  const t = text.toLowerCase();
  return (
    /\b(margin|laba|profit|keuntungan|potensi margin)\b/.test(t) ||
    /\b(provinsi|wilayah|daerah)\b/.test(t) ||
    /\b(hitung payroll|buat payroll|ajukan approval|approve payroll|payment instruction|instruksi pembayaran)\b/.test(
      t
    ) ||
    /\b(buat invoice|generate invoice|terbit invoice|invoice|kirim invoice)\b/.test(t) ||
    /\b(unduh payment|download payment|csv payment|tandai paid|mark paid)\b/.test(t) ||
    /\b(help|bantuan|alur|proses|next|lanjut|status|ringkasan|daftar karyawan|daftar client|outstanding|umr|audit|validasi|import|upload)\b/.test(
      t
    ) ||
    /^(iya|yes|ok|oke|ya|generate|kirim|proses)\b/.test(t)
  );
}

function mapConfirmToAction(text: string, lastUserHint?: string) {
  const t = text.toLowerCase().trim();
  if (/^(iya|yes|ok|oke|ya|generate|kirim|proses)\b/.test(t)) {
    if (lastUserHint && /invoice/.test(lastUserHint)) return 'buat invoice';
    if (/invoice|tagihan/.test(t)) return 'buat invoice';
    return 'buat invoice';
  }
  if (/\b(generate|buat|terbit|kirim)\b.*\binvoice\b/.test(t) || /\binvoice\b/.test(t)) {
    return 'buat invoice';
  }
  return text;
}

function parsedToLocalEmployees(rows: ParsedEmployee[]) {
  return rows.map((r) => ({
    id: r.nrk,
    name: r.name,
    nik: r.ktp || '',
    npwp: r.npwp || '',
    status: r.statusAktif || r.contractStatus || 'KONTRAK',
    joinDate: r.joinDate || '',
    company: r.client || r.company || 'Client',
    project: r.unitKerja || r.lokasi || '',
    position: r.position || '',
    region: r.province || r.kotaUmk || '',
    province: r.province,
    bankAccount: r.accountNo ? `${r.bank || 'BANK'}-${r.accountNo}` : '',
    bankName: r.bank || '',
    salaryGross: r.basicSalary || 0,
    allowanceTransport: 0,
    allowanceMeal: 0,
    bpjsKesehatan: Boolean(r.bpjsKes),
    bpjsKetenagakerjaan: Boolean(r.jamsostek),
    pph21: true,
    email: r.email || '',
  }));
}

export default function IdaFab() {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [sessionId, setSessionId] = useState('default');
  const [messages, setMessages] = useState<Msg[]>([
    {
      role: 'ida',
      text: renderMarkdown(
        'Halo! Aku **IDA**.\n\nDashboard **read-only** — semua aksi di chat ini.\n\n' +
          '- 📎 Lampirkan Excel HRIS di sini\n' +
          '- **help** · **validasi** · **hitung payroll** · **buat invoice** · **margin**'
      ),
      cot: ['Siaga', 'Mode conversation-first', 'Upload hanya via 📎'],
    },
  ]);
  const [input, setInput] = useState('');
  const [db, setDb] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [pendingRows, setPendingRows] = useState<ParsedEmployee[] | null>(null);
  const [cotLive, setCotLive] = useState<string[] | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const lastTopicRef = useRef<string>('');

  useEffect(() => {
    setDb(loadDatabase());
    setSessionId(getIdaSessionId());
  }, []);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, cotLive, expanded]);

  function pushIda(text: string, isMarkdown = true, cot?: string[]) {
    setMessages((prev) => [
      ...prev,
      { role: 'ida', text: isMarkdown ? renderMarkdown(text) : text, cot },
    ]);
  }

  function buildContext(database: any) {
    const period = database.meta?.currentPeriod;
    const payroll = (database.payrolls || []).find((p: any) => p.period === period);
    const m = calcMargin(database);
    return {
      org: database.meta?.orgName,
      period,
      employees: database.employees?.length,
      clients: database.companies?.length,
      clientNames: (database.companies || []).map((c: any) => c.name),
      payrollNet: payroll?.summary?.totalNet ?? null,
      payrollStatus: payroll?.status ?? null,
      margin: m.margin,
      marginPct: Number(m.marginPct.toFixed(1)),
      revenueFormatted: formatIDR(m.revenue),
      costFormatted: formatIDR(m.cost),
      marginFormatted: formatIDR(m.margin),
      pendingImport: pendingRows?.length || 0,
    };
  }

  async function handleFile(file: File) {
    setBusy(true);
    setCotLive(['Baca file…', 'Parse kolom IAP…', 'Map provinsi…']);
    setMessages((prev) => [...prev, { role: 'user', text: `📎 ${file.name}` }]);
    try {
      const buf = await file.arrayBuffer();
      const parsed = parseIapWorkbook(buf);
      setPendingRows(parsed.rows);

      const byProv: Record<string, number> = {};
      parsed.rows.forEach((r) => {
        byProv[r.province] = (byProv[r.province] || 0) + 1;
      });
      const provLine = Object.entries(byProv)
        .slice(0, 6)
        .map(([k, v]) => `${k} (${v})`)
        .join(' · ');

      const sample = parsed.rows
        .slice(0, 3)
        .map((r) => `- **${r.name}** · ${r.lokasi || r.branch} → **${r.province}**`)
        .join('\n');

      pushIda(
        renderMarkdown(
          `File terbaca ✅\n\n` +
            `- Sheet: **${parsed.sheetName}**\n` +
            `- Valid: **${parsed.rows.length}** · skip ${parsed.skipped}\n` +
            `- Provinsi: ${provLine || '-'}\n\n` +
            `**Contoh**\n${sample}\n\n` +
            `Ketik **import sekarang** untuk simpan.`
        ),
        false,
        ['Parse OK', `Rows ${parsed.rows.length}`, 'Menunggu konfirmasi import']
      );
    } catch (e: any) {
      pushIda(renderMarkdown(`Gagal parse: ${e?.message || e}`), false, ['Error parse']);
      setPendingRows(null);
    } finally {
      setCotLive(null);
      setBusy(false);
    }
  }

  async function runImport() {
    if (!pendingRows?.length || !db) {
      pushIda(renderMarkdown('Belum ada file. Lampirkan .xlsx lewat 📎.'), false);
      return;
    }
    setBusy(true);
    setCotLive(['Upload ke Neon…', 'Mirror ke dashboard…', 'Validasi regulasi…']);
    try {
      const chunkSize = 40;
      let inserted = 0;
      let updated = 0;
      let errors = 0;
      for (let i = 0; i < pendingRows.length; i += chunkSize) {
        const chunk = pendingRows.slice(i, i + chunkSize);
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

      const localEmps = parsedToLocalEmployees(pendingRows);
      const clientNames = Array.from(new Set(localEmps.map((e) => e.company)));
      const companies = clientNames.map((name, i) => ({
        id: `CMP-IMP-${i + 1}`,
        name,
        npwp: '',
        address: '',
        pic: '',
        phone: '',
        payrollType: 'BULANAN',
        payrollSetup: {
          type: 'BULANAN',
          umrRegion: localEmps.find((e) => e.company === name)?.region || 'DKI Jakarta',
          umrYear: 2025,
          bpjsKesehatan: true,
          bpjsKetenagakerjaan: true,
          pph21: true,
        },
      }));

      const newDb = {
        ...db,
        employees: localEmps,
        companies,
        meta: { ...db.meta, lastImportAt: Date.now() },
        imports: [...(db.imports || []), { at: Date.now(), count: localEmps.length, source: 'IDA chat' }],
      };
      saveDatabase(newDb);
      setDb(newDb);
      emitDbChange();
      setPendingRows(null);

      const report = validatePayrollIndonesia(newDb);
      pushIda(
        renderMarkdown(
          `**Import selesai**\n\n- Neon: +${inserted} / upd ${updated} / err ${errors}\n` +
            `- Dashboard: **${localEmps.length}** karyawan\n\n` +
            formatValidationMarkdown(report)
        ),
        false,
        ['Import Neon OK', 'Local mirror OK', `Validasi ${report.errorCount}E/${report.warningCount}W`]
      );
    } catch (e: any) {
      pushIda(renderMarkdown(`Import gagal: **${e?.message || e}**`), false, ['Import error']);
    } finally {
      setCotLive(null);
      setBusy(false);
    }
  }

  async function send() {
    if (!input.trim() || !db || busy) return;
    const userMsg = input.trim();
    setMessages((prev) => [...prev, { role: 'user', text: userMsg }]);
    setInput('');
    setBusy(true);
    setCotLive(['Pahami intent…']);

    if (/invoice|payroll|upload|import|margin|validasi/.test(userMsg.toLowerCase())) {
      lastTopicRef.current = userMsg.toLowerCase();
    }

    try {
      const low = userMsg.toLowerCase();

      if (/\b(import sekarang|simpan import|proses import)\b/.test(low)) {
        await runImport();
        return;
      }
      if (/\b(batal import|cancel import)\b/.test(low)) {
        setPendingRows(null);
        pushIda(renderMarkdown('Antrian import dibatalkan.'), false, ['Batal import']);
        return;
      }
      if (/\b(upload|import|excel|lampir)\b/.test(low) && !pendingRows?.length) {
        pushIda(
          renderMarkdown(
            'Upload **hanya di chat** ini — klik tombol **📎** di bawah, pilih `.xlsx`, lalu ketik **import sekarang**.\n\nDashboard tidak menerima input file.'
          ),
          false,
          ['Arahkan ke 📎', 'Dashboard read-only']
        );
        return;
      }

      const mapped = mapConfirmToAction(userMsg, lastTopicRef.current);
      if (looksLikeLocalAction(userMsg) || mapped !== userMsg) {
        setCotLive(['Intent lokal', `Aksi: ${mapped}`, 'Eksekusi engine…']);
        const result = handleIdaIntent(mapped, db);
        if (result.dbChanged && result.newDb) {
          setDb(result.newDb);
          emitDbChange();
        }
        pushIda(result.reply, false, ['Local engine', `Cmd: ${mapped}`, 'Selesai']);
        return;
      }

      setCotLive(['RAG + memory…', 'Cek trigger web…', 'Generate jawaban…']);
      const context = buildContext(db);
      const res = await fetch('/api/ida', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userMsg, context, sessionId }),
      });
      const data = await res.json();

      if (data.ok && data.reply) {
        const cot: string[] = [];
        if (data.cot?.ragSources?.length) cot.push(`RAG: ${data.cot.ragSources.slice(0, 4).join(', ')}`);
        if (data.cot?.webTriggers?.length) cot.push(`Web: ${data.cot.webTriggers.join(', ')}`);
        if (data.cot?.memoryTurns != null) cot.push(`Memory: ${data.cot.memoryTurns} turns`);
        if (data.model) cot.push(`Model: ${data.model}`);
        pushIda(data.reply.replace(/\n?\{\s*"intent"[\s\S]*\}\s*$/, '').trim(), true, cot);
        return;
      }

      setCotLive(['Fallback lokal…']);
      const result = handleIdaIntent(userMsg, db);
      if (result.dbChanged && result.newDb) {
        setDb(result.newDb);
        emitDbChange();
      }
      pushIda(result.reply, false, ['Fallback local engine']);
    } catch {
      const result = handleIdaIntent(userMsg, db);
      if (result.dbChanged && result.newDb) {
        setDb(result.newDb);
        emitDbChange();
      }
      pushIda(result.reply, false, ['Error path → local']);
    } finally {
      setCotLive(null);
      setBusy(false);
    }
  }

  const panelStyle: React.CSSProperties = expanded
    ? {
        position: 'fixed',
        top: 0,
        right: 0,
        width: '50vw',
        minWidth: '320px',
        maxWidth: '100vw',
        height: '100vh',
        bottom: 'auto',
        borderRadius: 0,
        zIndex: 70,
      }
    : {
        position: 'fixed',
        bottom: '90px',
        right: '26px',
        width: '400px',
        maxWidth: 'calc(100vw - 52px)',
        height: '540px',
        maxHeight: 'calc(100vh - 140px)',
        borderRadius: 'var(--r-xl)',
        zIndex: 60,
      };

  return (
    <>
      <button
        onClick={() => setOpen(!open)}
        style={{
          position: 'fixed',
          bottom: '26px',
          right: '26px',
          zIndex: 50,
          display: expanded && open ? 'none' : 'flex',
          alignItems: 'center',
          gap: '11px',
          padding: '6px 20px 6px 6px',
          background: 'var(--bg-surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--r-pill)',
          boxShadow: 'var(--shadow-fab)',
          cursor: 'pointer',
        }}
      >
        <img
          src={IDA_AVATAR}
          alt="IDA"
          style={{
            width: '42px',
            height: '42px',
            borderRadius: '50%',
            objectFit: 'cover',
            border: '2px solid var(--bg-surface)',
            boxShadow: '0 0 0 2px var(--accent-soft2)',
          }}
        />
        <div style={{ textAlign: 'left' }}>
          <div style={{ fontSize: '14px', fontWeight: 700 }}>Ask IDA</div>
          <div style={{ fontSize: '10.5px', color: 'var(--text2)' }}>Chat · Upload · CoT</div>
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
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              padding: '14px 16px',
              borderBottom: '1px solid var(--border)',
            }}
          >
            <img
              src={IDA_AVATAR}
              alt="IDA"
              style={{
                width: '40px',
                height: '40px',
                borderRadius: '50%',
                objectFit: 'cover',
                border: '2px solid var(--accent-soft2)',
              }}
            />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '15px', fontWeight: 700 }}>IDA</div>
              <div style={{ fontSize: '12px', color: 'var(--text2)' }}>
                {busy ? 'Berpikir…' : pendingRows ? `Antrian: ${pendingRows.length} baris` : 'Siap'}
              </div>
            </div>
            <button
              type="button"
              title={expanded ? 'Kecilkan' : 'Perbesar ½ layar'}
              onClick={() => setExpanded((e) => !e)}
              style={{
                width: '30px',
                height: '30px',
                borderRadius: 'var(--r-sm)',
                border: '1px solid var(--border)',
                background: 'var(--bg-surface)',
                cursor: 'pointer',
                fontSize: '12px',
              }}
            >
              {expanded ? '⛶' : '⤢'}
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setExpanded(false);
              }}
              style={{
                width: '30px',
                height: '30px',
                borderRadius: 'var(--r-sm)',
                border: '1px solid var(--border)',
                background: 'var(--bg-surface)',
                cursor: 'pointer',
              }}
            >
              ✕
            </button>
          </div>

          <div
            ref={scrollRef}
            style={{
              flex: 1,
              overflowY: 'auto',
              padding: '16px 18px',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
            }}
          >
            {messages.map((m, i) => (
              <div
                key={i}
                style={{
                  maxWidth: expanded ? '85%' : '92%',
                  alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
                }}
              >
                {m.role === 'ida' && m.cot && m.cot.length > 0 && (
                  <details
                    style={{
                      marginBottom: '6px',
                      fontSize: '11px',
                      color: 'var(--text3)',
                    }}
                  >
                    <summary style={{ cursor: 'pointer', fontWeight: 650 }}>Chain of thought</summary>
                    <ol style={{ margin: '6px 0 0', paddingLeft: '18px' }}>
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
                    fontSize: '13px',
                    lineHeight: 1.55,
                    background:
                      m.role === 'user'
                        ? 'linear-gradient(135deg, var(--accent), var(--accent2))'
                        : 'var(--bg-subtle)',
                    color: m.role === 'user' ? '#fff' : 'var(--text)',
                    border: m.role === 'ida' ? '1px solid var(--border-soft)' : 'none',
                  }}
                  dangerouslySetInnerHTML={{
                    __html: m.role === 'user' ? m.text.replace(/</g, '<') : m.text,
                  }}
                />
              </div>
            ))}

            {cotLive && (
              <div
                style={{
                  alignSelf: 'flex-start',
                  fontSize: '11px',
                  color: 'var(--text3)',
                  padding: '8px 12px',
                  borderRadius: '10px',
                  background: 'var(--bg-subtle)',
                  border: '1px dashed var(--border)',
                }}
              >
                <strong>Berpikir…</strong>
                <ol style={{ margin: '4px 0 0', paddingLeft: '18px' }}>
                  {cotLive.map((c, j) => (
                    <li key={j}>{c}</li>
                  ))}
                </ol>
              </div>
            )}
          </div>

          <div style={{ padding: '12px 16px 16px', borderTop: '1px solid var(--border)' }}>
            {pendingRows && (
              <div style={{ fontSize: '11px', color: 'var(--amber)', marginBottom: '8px', fontWeight: 650 }}>
                {pendingRows.length} baris siap · ketik "import sekarang"
              </div>
            )}
            <div
              style={{
                display: 'flex',
                gap: '8px',
                alignItems: 'center',
                background: 'var(--bg-subtle)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--r-lg)',
                padding: '6px',
              }}
            >
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
              <button
                type="button"
                title="Lampirkan Excel"
                disabled={busy}
                onClick={() => fileRef.current?.click()}
                style={{
                  width: '34px',
                  height: '34px',
                  borderRadius: 'var(--r-sm)',
                  border: '1px solid var(--border)',
                  background: 'var(--bg-surface)',
                  cursor: busy ? 'wait' : 'pointer',
                  fontSize: '16px',
                }}
              >
                📎
              </button>
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && send()}
                placeholder={busy ? 'Sebentar…' : 'Tanya IDA…'}
                disabled={busy}
                style={{
                  flex: 1,
                  border: 'none',
                  background: 'transparent',
                  outline: 'none',
                  fontSize: '13px',
                  fontFamily: 'inherit',
                  color: 'var(--text)',
                }}
              />
              <button
                onClick={send}
                disabled={busy}
                style={{
                  width: '34px',
                  height: '34px',
                  borderRadius: 'var(--r-sm)',
                  border: 'none',
                  background: 'linear-gradient(135deg, var(--accent), var(--accent2))',
                  color: '#fff',
                  cursor: busy ? 'wait' : 'pointer',
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
