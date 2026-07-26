'use client';

import { useState, useEffect, useRef } from 'react';
import { loadDatabase } from '@/lib/database';
import { formatIDR, formatIDRShort, formatDate } from '@/lib/format';

const IDA_AVATAR = 'https://user.uploads.dev/file/bf193782176dd9739d8c52e33f3b1378.jpg';

function generateReply(text: string, db: any): string {
  const t = text.toLowerCase().trim();

  if (/^(halo|hai|hi|hello|hey|pagi|siang|sore|malam)/.test(t)) {
    return `Halo! Saya <strong>IDA</strong>, AI Payroll Manager. Ada yang bisa saya bantu hari ini?`;
  }

  if (/help|bantuan|bisa apa|menu|perintah/.test(t)) {
    return `Berikut yang bisa saya bantu:<br>• <strong>Status / ringkasan</strong> — ketik "status" atau "ringkasan"<br>• <strong>Karyawan</strong> — "berapa karyawan" / "daftar karyawan"<br>• <strong>Client</strong> — "daftar client"<br>• <strong>Payroll</strong> — "status payroll" / "total payroll"<br>• <strong>Outstanding / AR</strong> — "outstanding" atau "ar"<br>• <strong>UMR</strong> — "UMR Jakarta"`;
  }

  if (/ringkasan|summary|overview|status|kondisi/.test(t)) {
    const emp = db.employees?.length || 0;
    const cli = db.companies?.length || 0;
    const prj = db.projects?.length || 0;
    const payroll = db.payrolls?.find((p: any) => p.period === db.meta?.currentPeriod);
    const ar = (db.arMonitor || []).filter((a: any) => a.status === 'OUTSTANDING');
    const totalAr = ar.reduce((s: number, a: any) => s + a.amount, 0);

    let msg = `📊 <strong>Ringkasan Kondisi Payroll</strong><br><br>`;
    msg += `• Organisasi: <strong>${db.meta?.orgName || 'ProQPay Demo'}</strong><br>`;
    msg += `• Periode aktif: <strong>${db.meta?.currentPeriod}</strong><br>`;
    msg += `• ${emp} karyawan · ${cli} client · ${prj} project<br>`;
    if (payroll) {
      msg += `<br><strong>Payroll ${payroll.period}</strong><br>`;
      msg += `• Status: <strong>${payroll.status}</strong><br>`;
      msg += `• Total Net: <strong>${formatIDR(payroll.summary?.totalNet)}</strong>`;
    } else {
      msg += `<br>Payroll periode ini belum dihitung.`;
    }
    if (ar.length > 0) {
      msg += `<br><br>⚠️ Outstanding AR: <strong>${formatIDR(totalAr)}</strong> (${ar.length} klien)`;
    }
    return msg;
  }

  if (/berapa karyawan|jumlah karyawan|total karyawan|daftar karyawan|list karyawan|karyawan/.test(t) && !/payroll/.test(t)) {
    const emp = db.employees || [];
    let msg = `👥 <strong>${emp.length} Karyawan</strong><br><br>`;
    emp.slice(0, 6).forEach((e: any) => {
      msg += `• <strong>${e.name}</strong> — ${e.company} (${e.status})<br>`;
    });
    if (emp.length > 6) msg += `<br>…dan ${emp.length - 6} lainnya.`;
    return msg;
  }

  if (/client|klien|perusahaan/.test(t)) {
    const cos = db.companies || [];
    let msg = `🏢 <strong>${cos.length} Client</strong><br><br>`;
    cos.forEach((c: any) => {
      const count = (db.employees || []).filter((e: any) => e.company === c.name).length;
      msg += `• <strong>${c.name}</strong> — ${count} karyawan · ${c.payrollType}<br>`;
    });
    return msg;
  }

  if (/payroll|gaji|penggajian/.test(t)) {
    const payrolls = db.payrolls || [];
    if (payrolls.length === 0) return `Belum ada data payroll. Ketik "hitung payroll" untuk memulai (fitur full sedang diporting).`;
    let msg = `💰 <strong>Payroll</strong><br><br>`;
    payrolls.forEach((p: any) => {
      msg += `• <strong>${p.period}</strong> — ${p.status} · Net ${formatIDRShort(p.summary?.totalNet || 0)}<br>`;
    });
    return msg;
  }

  if (/outstanding|ar |piutang|tagihan belum/.test(t)) {
    const ar = (db.arMonitor || []).filter((a: any) => a.status === 'OUTSTANDING');
    if (ar.length === 0) return `✅ Tidak ada outstanding AR saat ini.`;
    let msg = `⏳ <strong>Outstanding AR</strong><br><br>`;
    ar.forEach((a: any) => {
      msg += `• <strong>${a.company}</strong> — ${formatIDR(a.amount)} (${a.invoiceId})<br>`;
    });
    return msg;
  }

  if (/umr|umk|upah minimum/.test(t)) {
    if (/jakarta|dki/.test(t)) return `UMR DKI Jakarta 2025: <strong>Rp 5.396.761</strong>`;
    if (/barat|jabar/.test(t)) return `UMR Jawa Barat 2025: <strong>Rp 2.049.324</strong>`;
    if (/timur|jatim/.test(t)) return `UMR Jawa Timur 2025: <strong>Rp 2.246.100</strong>`;
    return `Contoh UMR 2025:<br>• DKI Jakarta: Rp 5.396.761<br>• Jawa Barat: Rp 2.049.324<br>• Jawa Timur: Rp 2.246.100<br><br>Ketik "UMR Jakarta" untuk detail.`;
  }

  if (/hitung|buat payroll|generate payroll/.test(t)) {
    return `Fitur <strong>hitung payroll</strong> sedang dalam proses porting ke Next.js. Saat ini Anda bisa melihat status dan ringkasan data yang sudah ada.`;
  }

  return `Saya belum sepenuhnya memahami "${text}". Coba ketik <strong>help</strong> untuk melihat perintah yang saya pahami, atau "status" untuk ringkasan.`;
}

export default function IdaFab() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<{ role: 'ida' | 'user'; text: string }[]>([
    { role: 'ida', text: 'Halo! Saya <strong>IDA</strong>, AI Payroll Manager. Ada yang bisa saya bantu? 😊' }
  ]);
  const [input, setInput] = useState('');
  const [db, setDb] = useState<any>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setDb(loadDatabase());
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  function send() {
    if (!input.trim() || !db) return;
    const userMsg = input.trim();
    setMessages(prev => [...prev, { role: 'user', text: userMsg }]);
    setInput('');

    setTimeout(() => {
      const reply = generateReply(userMsg, db);
      setMessages(prev => [...prev, { role: 'ida', text: reply }]);
    }, 400);
  }

  return (
    <>
      <button
        onClick={() => setOpen(!open)}
        style={{
          position: 'fixed', bottom: '26px', right: '26px', zIndex: 50,
          display: 'flex', alignItems: 'center', gap: '11px',
          padding: '6px 20px 6px 6px',
          background: 'var(--bg-surface)', border: '1px solid var(--border)',
          borderRadius: 'var(--r-pill)', boxShadow: 'var(--shadow-fab)',
          cursor: 'pointer', transition: 'transform 0.25s ease, box-shadow 0.25s ease',
        }}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.transform = 'translateY(-3px)'; }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.transform = 'translateY(0)'; }}
      >
        <img src={IDA_AVATAR} alt="IDA" style={{
          width: '42px', height: '42px', borderRadius: '50%', objectFit: 'cover',
          border: '2px solid var(--bg-surface)', boxShadow: '0 0 0 2px var(--accent-soft2)',
        }} />
        <div style={{ textAlign: 'left' }}>
          <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text)' }}>Ask IDA</div>
          <div style={{ fontSize: '10.5px', fontWeight: 500, color: 'var(--text2)' }}>AI Payroll Manager</div>
        </div>
        <span style={{
          position: 'absolute', top: '4px', right: '4px',
          width: '10px', height: '10px', borderRadius: '50%',
          background: 'var(--success)', border: '2px solid var(--bg-surface)',
        }} />
      </button>

      {open && (
        <div style={{
          position: 'fixed', bottom: '90px', right: '26px',
          width: '360px', maxWidth: 'calc(100vw - 52px)',
          height: '480px', maxHeight: 'calc(100vh - 140px)',
          background: 'var(--bg-surface)', border: '1px solid var(--border)',
          borderRadius: 'var(--r-xl)', boxShadow: 'var(--shadow-lg)',
          zIndex: 60, display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: '12px',
            padding: '16px 18px', borderBottom: '1px solid var(--border)'
          }}>
            <img src={IDA_AVATAR} alt="IDA" style={{
              width: '40px', height: '40px', borderRadius: '50%', objectFit: 'cover',
              border: '2px solid var(--accent-soft2)'
            }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '15px', fontWeight: 700 }}>IDA</div>
              <div style={{ fontSize: '12px', color: 'var(--text2)', display: 'flex', alignItems: 'center', gap: '5px' }}>
                <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--success)' }} />
                Ready
              </div>
            </div>
            <button onClick={() => setOpen(false)} style={{
              width: '30px', height: '30px', borderRadius: 'var(--r-sm)',
              border: '1px solid var(--border)', background: 'var(--bg-surface)',
              color: 'var(--text2)', cursor: 'pointer', fontSize: '13px'
            }}>✕</button>
          </div>

          <div ref={scrollRef} style={{
            flex: 1, overflowY: 'auto', padding: '16px 18px',
            display: 'flex', flexDirection: 'column', gap: '12px'
          }}>
            {messages.map((m, i) => (
              <div key={i} style={{
                maxWidth: '85%', alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
              }}>
                <div style={{
                  padding: '11px 15px', borderRadius: 'var(--r-md)', fontSize: '13px', lineHeight: 1.55,
                  background: m.role === 'user'
                    ? 'linear-gradient(135deg, var(--accent), var(--accent2))'
                    : 'var(--bg-subtle)',
                  color: m.role === 'user' ? '#fff' : 'var(--text)',
                  border: m.role === 'ida' ? '1px solid var(--border-soft)' : 'none',
                  borderTopLeftRadius: m.role === 'ida' ? '4px' : undefined,
                  borderTopRightRadius: m.role === 'user' ? '4px' : undefined,
                }} dangerouslySetInnerHTML={{ __html: m.text }} />
              </div>
            ))}
          </div>

          <div style={{ padding: '14px 18px 16px', borderTop: '1px solid var(--border)' }}>
            <div style={{
              display: 'flex', gap: '8px',
              background: 'var(--bg-subtle)', border: '1px solid var(--border)',
              borderRadius: 'var(--r-lg)', padding: '6px 6px 6px 14px'
            }}>
              <input
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && send()}
                placeholder="Ask IDA… (coba: status, help)"
                style={{
                  flex: 1, border: 'none', background: 'transparent',
                  outline: 'none', fontSize: '13px', fontFamily: 'inherit', color: 'var(--text)'
                }}
              />
              <button onClick={send} style={{
                width: '34px', height: '34px', borderRadius: 'var(--r-sm)', border: 'none',
                background: 'linear-gradient(135deg, var(--accent), var(--accent2))',
                color: '#fff', cursor: 'pointer', fontSize: '14px', flexShrink: 0
              }}>➤</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
