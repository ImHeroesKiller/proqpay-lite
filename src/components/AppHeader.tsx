'use client';

import { useState } from 'react';
import { ChangePasswordModal } from '@/components/AuthViews';

type HeaderActor = { id: string; name?: string; email: string; role: string; authMode?: string };

export default function AppHeader({
  period,
  onHelp,
  actor,
}: {
  period: string;
  onHelp: () => void;
  actor: HeaderActor;
}) {
  const [menu, setMenu] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const user = { ...actor, name: actor.name || actor.email.split('@')[0] };

  async function logout() {
    setMenu(false);
    if (actor.authMode === 'access') window.location.assign('/cdn-cgi/access/logout');
    else { await fetch('/api/logout', { method: 'POST' }).catch(() => null); window.location.assign('/'); }
  }

  return (
    <>
      <header
        style={{
          height: 58,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 24px',
          background: 'rgba(255,255,255,0.88)',
          borderBottom: '1px solid var(--border)',
          backdropFilter: 'blur(16px)',
          position: 'sticky',
          top: 0,
          zIndex: 40,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="app-header-logo" src="/assets/proqpay-logo.jpg" alt="ProQPay Lite" />
          <span
            style={{
              fontSize: 12,
              padding: '4px 10px',
              borderRadius: 999,
              background: 'var(--bg-subtle)',
              border: '1px solid var(--border)',
              color: 'var(--text2)',
            }}
          >
            {period}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, position: 'relative' }}>
          <button type="button" className="btn" onClick={onHelp} style={{ fontSize: 12, fontWeight: 650 }}>
            Bantuan
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => setMenu((m) => !m)}
            style={{ fontSize: 12, fontWeight: 650 }}
          >
            {user?.name || 'Akun'} ▾
          </button>
          {menu && (
            <div
              style={{
                position: 'absolute',
                top: 40,
                right: 0,
                width: 200,
                background: 'var(--bg-surface)',
                border: '1px solid var(--border)',
                borderRadius: 12,
                boxShadow: 'var(--shadow-lg)',
                zIndex: 50,
                overflow: 'hidden',
              }}
            >
              <button type="button" style={itemStyle} onClick={() => { setProfileOpen(true); setMenu(false); }}>
                Profil
              </button>
              {['database', 'session'].includes(actor.authMode || '') ? <button type="button" style={itemStyle} onClick={() => { setPasswordOpen(true); setMenu(false); }}>Ganti password</button> : null}
              <button type="button" style={itemStyle} onClick={() => void logout()}>
                Keluar
              </button>
            </div>
          )}
        </div>
      </header>

      {profileOpen && user && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget) setProfileOpen(false);
          }}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 320,
            background: 'rgba(15,23,42,0.45)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 20,
          }}
        >
          <div
            style={{
              background: 'var(--bg-surface)',
              borderRadius: 16,
              border: '1px solid var(--border)',
              padding: 24,
              width: '100%',
              maxWidth: 380,
            }}
          >
            <h3 style={{ marginTop: 0 }}>Profil</h3>
            <p style={{ margin: '8px 0', fontSize: 14 }}>
              <strong>{user.name}</strong>
            </p>
            <p style={{ margin: '4px 0', fontSize: 13, color: 'var(--text2)' }}>{user.email}</p>
            <p style={{ margin: '4px 0', fontSize: 13, color: 'var(--text2)' }}>Peran: {user.role}</p>
            <button type="button" className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => setProfileOpen(false)}>
              Tutup
            </button>
          </div>
        </div>
      )}
      {passwordOpen ? <ChangePasswordModal forced={false} onClose={() => setPasswordOpen(false)} /> : null}
    </>
  );
}

const itemStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  textAlign: 'left',
  padding: '12px 14px',
  border: 'none',
  background: 'transparent',
  cursor: 'pointer',
  fontSize: 13,
  fontFamily: 'inherit',
  color: 'var(--text)',
};
