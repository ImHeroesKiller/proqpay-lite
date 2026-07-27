'use client';

import { useEffect, useState } from 'react';
import { currentUser, loadSettings, onSettingsChange, type AppUser } from '@/lib/app-settings';

export default function AppHeader({
  period,
  onHelp,
}: {
  period: string;
  onHelp: () => void;
}) {
  const [user, setUser] = useState<AppUser | null>(null);
  const [accessAuthenticated, setAccessAuthenticated] = useState(false);
  const [menu, setMenu] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);

  useEffect(() => {
    let accessUser: AppUser | null = null;
    const sync = () => setUser(accessUser || currentUser(loadSettings()));
    sync();
    const controller = new AbortController();
    fetch('/api/me', {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) return;
        const data = await response.json();
        if (!data.authenticated || !data.user?.email || !data.user?.role) return;
        const email = String(data.user.email);
        accessUser = {
          id: String(data.user.id || email),
          name: email.split('@')[0],
          email,
          role: data.user.role as AppUser['role'],
          active: true,
        };
        setAccessAuthenticated(true);
        setUser(accessUser);
      })
      .catch(() => {
        // Profil lokal tetap digunakan jika endpoint identitas tidak tersedia.
      });
    const unsubscribe = onSettingsChange(sync);
    return () => {
      controller.abort();
      unsubscribe();
    };
  }, []);

  function logout() {
    setMenu(false);
    if (typeof window !== 'undefined') {
      localStorage.removeItem('proqpay_session_ok');
      window.location.assign(accessAuthenticated ? '/cdn-cgi/access/logout' : '/');
    }
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
          <div style={{ fontWeight: 720, fontSize: 16 }}>
            ProQPay <span style={{ color: 'var(--orange)' }}>Lite</span>
          </div>
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
              <button type="button" style={itemStyle} onClick={logout}>
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
