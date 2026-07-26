'use client';

import { useState } from 'react';

const IDA_AVATAR = 'https://user.uploads.dev/file/bf193782176dd9739d8c52e33f3b1378.jpg';

export default function IdaFab() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<{ role: 'ida' | 'user'; text: string }[]>([
    { role: 'ida', text: 'Halo! Saya <strong>IDA</strong>, AI Payroll Manager. Ada yang bisa saya bantu?' }
  ]);
  const [input, setInput] = useState('');

  function send() {
    if (!input.trim()) return;
    const userMsg = input.trim();
    setMessages(prev => [...prev, { role: 'user', text: userMsg }]);
    setInput('');

    // Simple demo response
    setTimeout(() => {
      let reply = 'Saya mengerti. Untuk fitur lengkap IDA (hitung payroll, approval, dll) sedang dalam proses porting.';
      if (/payroll|gaji|hitung/i.test(userMsg)) reply = 'Untuk menghitung payroll, ketik <strong>"Buat payroll Juli"</strong>. Fitur ini akan segera tersedia.';
      if (/help|bantuan|bisa apa/i.test(userMsg)) reply = 'Saya bisa membantu: hitung payroll, tambah karyawan, approval, payment instruction, invoice, AR monitoring, dan laporan.';
      if (/halo|hai|hello/i.test(userMsg)) reply = 'Halo! Siap membantu mengelola payroll Anda hari ini 😊';
      setMessages(prev => [...prev, { role: 'ida', text: reply }]);
    }, 600);
  }

  return (
    <>
      {/* Floating Button */}
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
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.transform = 'translateY(-3px)'; }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.transform = 'translateY(0)'; }}
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
          <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.01em' }}>Ask IDA</div>
          <div style={{ fontSize: '10.5px', fontWeight: 500, color: 'var(--text2)' }}>AI Payroll Manager</div>
        </div>
        <span style={{
          position: 'absolute',
          top: '4px',
          right: '4px',
          width: '10px',
          height: '10px',
          borderRadius: '50%',
          background: 'var(--success)',
          border: '2px solid var(--bg-surface)',
        }} />
      </button>

      {/* Mini Chat Panel */}
      {open && (
        <div style={{
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
        }}>
          {/* Header */}
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
            <button
              onClick={() => setOpen(false)}
              style={{
                width: '30px', height: '30px', borderRadius: 'var(--r-sm)',
                border: '1px solid var(--border)', background: 'var(--bg-surface)',
                color: 'var(--text2)', cursor: 'pointer', fontSize: '13px'
              }}
            >✕</button>
          </div>

          {/* Messages */}
          <div style={{
            flex: 1, overflowY: 'auto', padding: '16px 18px',
            display: 'flex', flexDirection: 'column', gap: '12px'
          }}>
            {messages.map((m, i) => (
              <div key={i} style={{
                maxWidth: '85%',
                alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
              }}>
                <div
                  style={{
                    padding: '11px 15px',
                    borderRadius: 'var(--r-md)',
                    fontSize: '13px',
                    lineHeight: 1.55,
                    background: m.role === 'user'
                      ? 'linear-gradient(135deg, var(--accent), var(--accent2))'
                      : 'var(--bg-subtle)',
                    color: m.role === 'user' ? '#fff' : 'var(--text)',
                    border: m.role === 'ida' ? '1px solid var(--border-soft)' : 'none',
                    borderTopLeftRadius: m.role === 'ida' ? '4px' : undefined,
                    borderTopRightRadius: m.role === 'user' ? '4px' : undefined,
                  }}
                  dangerouslySetInnerHTML={{ __html: m.text }}
                />
              </div>
            ))}
          </div>

          {/* Input */}
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
                placeholder="Ask IDA…"
                style={{
                  flex: 1, border: 'none', background: 'transparent',
                  outline: 'none', fontSize: '13px', fontFamily: 'inherit', color: 'var(--text)'
                }}
              />
              <button
                onClick={send}
                style={{
                  width: '34px', height: '34px', borderRadius: 'var(--r-sm)', border: 'none',
                  background: 'linear-gradient(135deg, var(--accent), var(--accent2))',
                  color: '#fff', cursor: 'pointer', fontSize: '14px', flexShrink: 0
                }}
              >➤</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
