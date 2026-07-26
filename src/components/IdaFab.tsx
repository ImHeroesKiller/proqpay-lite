'use client';

import { useState, useEffect, useRef } from 'react';
import { loadDatabase } from '@/lib/database';
import { handleIdaIntent } from '@/lib/ida-simple';
import { emitDbChange } from '@/lib/events';
import { renderMarkdown } from '@/lib/markdown';
import { calcMargin } from '@/lib/margin';
import { formatIDR } from '@/lib/format';

const IDA_AVATAR = 'https://user.uploads.dev/file/bf193782176dd9739d8c52e33f3b1378.jpg';

function looksLikeLocalAction(text: string) {
  const t = text.toLowerCase();
  return (
    /\b(margin|laba|profit|keuntungan|potensi margin)\b/.test(t) ||
    /\b(provinsi|wilayah|daerah)\b/.test(t) ||
    /\b(hitung payroll|buat payroll|ajukan approval|approve payroll|payment instruction|instruksi pembayaran)\b/.test(
      t
    ) ||
    /\b(help|bantuan|status|ringkasan|daftar karyawan|daftar client|outstanding|umr)\b/.test(t)
  );
}

export default function IdaFab() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<{ role: 'ida' | 'user'; text: string }[]>([
    {
      role: 'ida',
      text: renderMarkdown(
        'Halo! Aku **IDA**, asisten payroll kamu. Tanya aja bebas — **help**, **margin**, **provinsi Kabanjahe**, atau **hitung payroll**.'
      ),
    },
  ]);
  const [input, setInput] = useState('');
  const [db, setDb] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setDb(loadDatabase());
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  function pushIda(text: string, isMarkdown = true) {
    setMessages((prev) => [
      ...prev,
      { role: 'ida', text: isMarkdown ? renderMarkdown(text) : text },
    ]);
  }

  function buildContext(database: any) {
    const period = database.meta?.currentPeriod;
    const payroll = (database.payrolls || []).find((p: any) => p.period === period);
    const m = calcMargin(database);
    const invoices = (database.invoices || []).map((inv: any) => ({
      id: inv.id,
      company: inv.company,
      period: inv.period,
      total: inv.totalAmount,
      status: inv.status,
    }));

    return {
      org: database.meta?.orgName,
      period,
      employees: database.employees?.length,
      clients: database.companies?.length,
      payrollNet: payroll?.summary?.totalNet ?? null,
      payrollGross: payroll?.summary?.totalGross ?? null,
      payrollStatus: payroll?.status ?? null,
      margin: m.margin,
      marginPct: Number(m.marginPct.toFixed(1)),
      revenue: m.revenue,
      cost: m.cost,
      marginEstimated: m.estimated,
      invoices,
      revenueFormatted: formatIDR(m.revenue),
      costFormatted: formatIDR(m.cost),
      marginFormatted: formatIDR(m.margin),
    };
  }

  async function send() {
    if (!input.trim() || !db || busy) return;
    const userMsg = input.trim();
    setMessages((prev) => [...prev, { role: 'user', text: userMsg }]);
    setInput('');
    setBusy(true);

    try {
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
        body: JSON.stringify({ message: userMsg, context }),
      });

      const data = await res.json();

      if (data.ok && data.reply) {
        let reply = data.reply.replace(/\n?\{\s*"intent"[\s\S]*\}\s*$/, '').trim();
        pushIda(reply, true);

        const intentMatch = data.reply.match(/\{\s*"intent"\s*:\s*"([^"]+)"[\s\S]*\}/);
        if (intentMatch) {
          const intent = intentMatch[1];
          const map: Record<string, string> = {
            calculate_payroll: 'hitung payroll',
            approve_payroll: 'ajukan approval',
            payment_instruction: 'buat payment instruction',
            summary: 'status',
          };
          if (map[intent]) {
            const local = handleIdaIntent(map[intent], db);
            if (local.dbChanged && local.newDb) {
              setDb(local.newDb);
              emitDbChange();
            }
            if (['calculate_payroll', 'approve_payroll', 'payment_instruction'].includes(intent)) {
              pushIda(local.reply, false);
            }
          }
        }
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
          transition: 'transform 0.25s ease, box-shadow 0.25s ease',
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLElement).style.transform = 'translateY(-3px)';
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLElement).style.transform = 'translateY(0)';
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
          <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text)' }}>Ask IDA</div>
          <div style={{ fontSize: '10.5px', fontWeight: 500, color: 'var(--text2)' }}>AI Payroll Manager</div>
        </div>
        <span
          style={{
            position: 'absolute',
            top: '4px',
            right: '4px',
            width: '10px',
            height: '10px',
            borderRadius: '50%',
            background: 'var(--success)',
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
            width: '360px',
            maxWidth: 'calc(100vw - 52px)',
            height: '480px',
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
              <div
                style={{
                  fontSize: '12px',
                  color: 'var(--text2)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px',
                }}
              >
                <span
                  style={{
                    width: '8px',
                    height: '8px',
                    borderRadius: '50%',
                    background: busy ? 'var(--amber)' : 'var(--success)',
                  }}
                />
                {busy ? 'Thinking…' : 'Siap bantu'}
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
                color: 'var(--text2)',
                cursor: 'pointer',
                fontSize: '13px',
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
                  maxWidth: '88%',
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
                    borderTopLeftRadius: m.role === 'ida' ? '4px' : undefined,
                    borderTopRightRadius: m.role === 'user' ? '4px' : undefined,
                  }}
                  dangerouslySetInnerHTML={{
                    __html: m.role === 'user' ? m.text.replace(/</g, '<') : m.text,
                  }}
                />
              </div>
            ))}
          </div>

          <div style={{ padding: '14px 18px 16px', borderTop: '1px solid var(--border)' }}>
            <div
              style={{
                display: 'flex',
                gap: '8px',
                background: 'var(--bg-subtle)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--r-lg)',
                padding: '6px 6px 6px 14px',
              }}
            >
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && send()}
                placeholder={busy ? 'Sebentar ya…' : 'Coba: provinsi Medan, margin, help'}
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
                  fontSize: '14px',
                  flexShrink: 0,
                  opacity: busy ? 0.7 : 1,
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
