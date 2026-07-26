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

function looksLikeLocalAction(text: string) {
  const t = text.toLowerCase();
  return (
    /\b(margin|laba|profit|keuntungan|potensi margin)\b/.test(t) ||
    /\b(provinsi|wilayah|daerah)\b/.test(t) ||
    /\b(hitung payroll|buat payroll|ajukan approval|approve payroll|payment instruction|instruksi pembayaran)\b/.test(
      t
    ) ||
    /\b(buat invoice|generate invoice|unduh payment|download payment|csv payment|tandai paid|mark paid)\b/.test(
      t
    ) ||
    /\b(help|bantuan|alur|proses|next|lanjut|status|ringkasan|daftar karyawan|daftar client|outstanding|umr|audit|validasi|import|upload)\b/.test(
      t
    )
  );
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
  const [sessionId, setSessionId] = useState('default');
  const [messages, setMessages] = useState<{ role: 'ida' | 'user'; text: string }[]>([
    {
      role: 'ida',
      text: renderMarkdown(
        'Halo! Aku **IDA**.\n\nDashboard hanya tampilan — semua aksi di sini.\n\n' +
          '- 📎 **Lampirkan Excel HRIS** (tombol kertas)\n' +
          '- **help** · **validasi** · **hitung payroll** · **margin**\n' +
          '- Bilang **ingat …** untuk long memory'
      ),
    },
  ]);
  const [input, setInput] = useState('');
  const [db, setDb] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [pendingRows, setPendingRows] = useState<ParsedEmployee[] | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDb(loadDatabase());
    setSessionId(getIdaSessionId());
  }, []);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  function pushIda(text: string, isMarkdown = true) {
    setMessages((prev) => [...prev, { role: 'ida', text: isMarkdown ? renderMarkdown(text) : text }]);
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
        .map((r) => `- **${r.name}** · ${r.lokasi || r.branch} → **${r.province}** · ${r.basicSalary.toLocaleString('id-ID')}`)
        .join('\n');

      pushIda(
        renderMarkdown(
          `File terbaca ✅\n\n` +
            `- Sheet: **${parsed.sheetName}**\n` +
            `- Baris mentah: ${parsed.totalRaw} · valid: **${parsed.rows.length}** · skip: ${parsed.skipped}\n` +
            `- Provinsi: ${provLine || '-'}\n\n` +
            `**Contoh**\n${sample}\n\n` +
            `Ketik **import sekarang** untuk simpan ke Neon + refresh data lokal.\n` +
            `Atau **batal import** untuk buang antrian.`
        ),
        false
      );
    } catch (e: any) {
      pushIda(renderMarkdown(`Gagal parse Excel: ${e?.message || e}`), false);
      setPendingRows(null);
    } finally {
      setBusy(false);
    }
  }

  async function runImport() {
    if (!pendingRows?.length || !db) {
      pushIda(renderMarkdown('Belum ada file di antrian. Lampirkan .xlsx dulu (tombol 📎).'), false);
      return;
    }
    setBusy(true);
    try {
      // 1) Neon bulk
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

      // 2) Local mirror for dashboard visualization
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
        meta: { ...db.meta, orgName: db.meta?.orgName || 'OTSINDO', lastImportAt: Date.now() },
        imports: [
          ...(db.imports || []),
          { at: Date.now(), count: localEmps.length, source: 'IDA chat Excel' },
        ],
      };
      saveDatabase(newDb);
      setDb(newDb);
      emitDbChange();
      setPendingRows(null);

      const report = validatePayrollIndonesia(newDb);
      pushIda(
        renderMarkdown(
          `**Import selesai**\n\n` +
            `- Neon: +${inserted} / update ${updated} / err ${errors}\n` +
            `- Lokal dashboard: **${localEmps.length}** karyawan · **${companies.length}** client\n\n` +
            formatValidationMarkdown(report) +
            `\n\nLanjut: **hitung payroll** atau perbaiki error dulu.`
        ),
        false
      );
    } catch (e: any) {
      pushIda(renderMarkdown(`Import gagal: **${e?.message || e}**`), false);
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    if (!input.trim() || !db || busy) return;
    const userMsg = input.trim();
    setMessages((prev) => [...prev, { role: 'user', text: userMsg }]);
    setInput('');
    setBusy(true);

    try {
      const low = userMsg.toLowerCase();

      if (/\b(import sekarang|simpan import|proses import)\b/.test(low)) {
        await runImport();
        return;
      }
      if (/\b(batal import|cancel import)\b/.test(low)) {
        setPendingRows(null);
        pushIda(renderMarkdown('Antrian import dibatalkan.'), false);
        return;
      }
      if (/\b(upload|import|excel|lampir)\b/.test(low) && !pendingRows?.length) {
        pushIda(
          renderMarkdown(
            'Silakan **lampirkan file** .xlsx lewat tombol 📎 di bawah chat.\nSetelah terbaca, ketik **import sekarang**.'
          ),
          false
        );
        return;
      }

      if (looksLikeLocalAction(userMsg)) {
        const result = handleIdaIntent(userMsg, db);
        if (result.dbChanged && result.newDb) {
          setDb(result.newDb);
          emitDbChange();
        }
        pushIda(result.reply, false);
        return;
      }

      const context = buildContext(db);
      const res = await fetch('/api/ida', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userMsg, context, sessionId }),
      });
      const data = await res.json();

      if (data.ok && data.reply) {
        pushIda(data.reply.replace(/\n?\{\s*"intent"[\s\S]*\}\s*$/, '').trim(), true);
        return;
      }

      const result = handleIdaIntent(userMsg, db);
      if (result.dbChanged && result.newDb) {
        setDb(result.newDb);
        emitDbChange();
      }
      pushIda(result.reply, false);
    } catch {
      const result = handleIdaIntent(userMsg, db);
      if (result.dbChanged && result.newDb) {
        setDb(result.newDb);
        emitDbChange();
      }
      pushIda(result.reply, false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(!open)}
        style={{
          position: 'fixed',
          bottom: '26px',
          right: '26px',
          zIndex: 50,
          display: 'flex',
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
          <div style={{ fontSize: '10.5px', color: 'var(--text2)' }}>Chat · Upload · Payroll</div>
        </div>
        <span
          style={{
            position: 'absolute',
            top: '4px',
            right: '4px',
            width: '10px',
            height: '10px',
            borderRadius: '50%',
            background: pendingRows ? 'var(--amber)' : 'var(--success)',
            border: '2px solid var(--bg-surface)',
          }}
        />
      </button>

      {open && (
        <div
          style={{
            position: 'fixed',
            bottom: '90px',
            right: '26px',
            width: '400px',
            maxWidth: 'calc(100vw - 52px)',
            height: '540px',
            maxHeight: 'calc(100vh - 140px)',
            background: 'var(--bg-surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--r-xl)',
            boxShadow: 'var(--shadow-lg)',
            zIndex: 60,
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
              padding: '16px 18px',
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
                {busy ? 'Memproses…' : pendingRows ? `Antrian import: ${pendingRows.length} baris` : 'Siap · upload di chat'}
              </div>
            </div>
            <button
              onClick={() => setOpen(false)}
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
                  maxWidth: '90%',
                  alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
                }}
              >
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
          </div>

          <div style={{ padding: '12px 16px 16px', borderTop: '1px solid var(--border)' }}>
            {pendingRows && (
              <div
                style={{
                  fontSize: '11px',
                  color: 'var(--amber)',
                  marginBottom: '8px',
                  fontWeight: 650,
                }}
              >
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
                title="Lampirkan Excel HRIS"
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
                  flexShrink: 0,
                }}
              >
                📎
              </button>
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && send()}
                placeholder={busy ? 'Sebentar…' : 'Tanya atau: import sekarang'}
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
                  flexShrink: 0,
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
