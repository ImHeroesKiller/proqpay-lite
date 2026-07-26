'use client';

import { useState, useEffect } from 'react';

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

export default function SettingsModal({ open, onClose }: SettingsModalProps) {
  const [orgName, setOrgName] = useState('ProQPay Demo Corp');
  const [period, setPeriod] = useState('2025-07');
  const [role, setRole] = useState('SUPER_ADMIN');

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 100,
        background: 'rgba(15, 23, 42, 0.45)',
        backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '20px',
      }}
    >
      <div style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--r-xl)',
        boxShadow: 'var(--shadow-lg)',
        width: '100%', maxWidth: '420px',
        overflow: 'hidden',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '16px 20px', borderBottom: '1px solid var(--border)'
        }}>
          <h3 style={{ fontSize: '16px', fontWeight: 700 }}>Settings</h3>
          <button onClick={onClose} style={{
            width: '32px', height: '32px', borderRadius: 'var(--r-sm)',
            border: '1px solid var(--border)', background: 'var(--bg-surface)',
            color: 'var(--text2)', cursor: 'pointer', fontSize: '14px'
          }}>✕</button>
        </div>

        <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div>
            <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text2)', display: 'block', marginBottom: '6px' }}>
              Organization Name
            </label>
            <input
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
              style={{
                width: '100%', padding: '10px 12px',
                background: 'var(--bg-subtle)', border: '1px solid var(--border)',
                borderRadius: 'var(--r-sm)', fontSize: '13px',
                fontFamily: 'inherit', color: 'var(--text)', outline: 'none'
              }}
            />
          </div>

          <div>
            <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text2)', display: 'block', marginBottom: '6px' }}>
              Current Period
            </label>
            <input
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              placeholder="YYYY-MM"
              style={{
                width: '100%', padding: '10px 12px',
                background: 'var(--bg-subtle)', border: '1px solid var(--border)',
                borderRadius: 'var(--r-sm)', fontSize: '13px',
                fontFamily: 'inherit', color: 'var(--text)', outline: 'none'
              }}
            />
          </div>

          <div>
            <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text2)', display: 'block', marginBottom: '6px' }}>
              Active Role
            </label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              style={{
                width: '100%', padding: '10px 12px',
                background: 'var(--bg-subtle)', border: '1px solid var(--border)',
                borderRadius: 'var(--r-sm)', fontSize: '13px',
                fontFamily: 'inherit', color: 'var(--text)', outline: 'none'
              }}
            >
              <option value="SUPER_ADMIN">Super Admin</option>
              <option value="PAYROLL">Payroll</option>
              <option value="HR">HR</option>
              <option value="FINANCE">Finance</option>
              <option value="DIRECTOR">Director</option>
              <option value="VIEWER">Viewer</option>
            </select>
          </div>

          <div style={{
            padding: '12px 14px', background: 'var(--bg-subtle)',
            borderRadius: 'var(--r-md)', border: '1px solid var(--border-soft)',
            fontSize: '12px', color: 'var(--text2)', lineHeight: 1.5
          }}>
            Settings disimpan di local state untuk demo. Full persistence akan ditambahkan nanti.
          </div>
        </div>

        <div style={{
          padding: '14px 20px', borderTop: '1px solid var(--border)',
          display: 'flex', justifyContent: 'flex-end', gap: '10px'
        }}>
          <button onClick={onClose} className="btn">Cancel</button>
          <button onClick={onClose} className="btn btn-primary">Save</button>
        </div>
      </div>
    </div>
  );
}
