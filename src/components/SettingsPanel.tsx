'use client';

import { useEffect, useId, useRef, useState } from 'react';

const KEY = 'proqpay_settings_v1';

export type AppSettings = {
  orgName: string;
  defaultPeriod: string;
  serviceFeePerEmp: number;
  showDemoBanner: boolean;
};

const DEFAULTS: AppSettings = {
  orgName: 'ProQPay Demo Corp',
  defaultPeriod: '2025-07',
  serviceFeePerEmp: 1500000,
  showDemoBanner: true,
};

export function loadSettings(): AppSettings {
  if (typeof window === 'undefined') return DEFAULTS;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULTS;
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return DEFAULTS;
  }
}

export function saveSettings(s: AppSettings) {
  localStorage.setItem(KEY, JSON.stringify(s));
}

export default function SettingsPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [s, setS] = useState<AppSettings>(DEFAULTS);
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setS(loadSettings());
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => panelRef.current?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener('keydown', onKeyDown);
      previousFocus?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  function persist() {
    saveSettings(s);
    onClose();
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15,23,42,0.35)',
        zIndex: 80,
        display: 'flex',
        justifyContent: 'flex-end',
      }}
      onClick={onClose}
    >
      <div
        ref={panelRef}
        className="card"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        style={{
          width: '360px',
          maxWidth: '100%',
          height: '100%',
          borderRadius: 0,
          padding: '24px',
          overflowY: 'auto',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px' }}>
          <h3 id={titleId} style={{ margin: 0, fontSize: '16px', fontWeight: 700 }}>Settings</h3>
          <button type="button" aria-label="Tutup pengaturan" onClick={onClose} style={{ border: 'none', background: 'transparent', cursor: 'pointer' }}>
            ✕
          </button>
        </div>

        <label style={fieldLabel}>Nama Org</label>
        <input
          aria-label="Nama organisasi"
          value={s.orgName}
          onChange={(e) => setS({ ...s, orgName: e.target.value })}
          style={inputStyle}
        />

        <label style={fieldLabel}>Periode default</label>
        <input
          aria-label="Periode default"
          value={s.defaultPeriod}
          onChange={(e) => setS({ ...s, defaultPeriod: e.target.value })}
          style={inputStyle}
          placeholder="YYYY-MM"
        />

        <label style={fieldLabel}>Service fee / karyawan (IDR)</label>
        <input
          aria-label="Service fee per karyawan"
          type="number"
          value={s.serviceFeePerEmp}
          onChange={(e) => setS({ ...s, serviceFeePerEmp: Number(e.target.value) || 0 })}
          style={inputStyle}
        />

        <label style={{ ...fieldLabel, display: 'flex', alignItems: 'center', gap: '8px' }}>
          <input
            type="checkbox"
            checked={s.showDemoBanner}
            onChange={(e) => setS({ ...s, showDemoBanner: e.target.checked })}
          />
          Tampilkan banner demo
        </label>

        <button
          type="button"
          onClick={persist}
          style={{
            marginTop: '20px',
            width: '100%',
            padding: '12px',
            border: 'none',
            borderRadius: '12px',
            background: 'linear-gradient(135deg, var(--accent), var(--accent2))',
            color: 'var(--accent-contrast)',
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          Simpan
        </button>
      </div>
    </div>
  );
}

const fieldLabel: React.CSSProperties = {
  display: 'block',
  fontSize: '12px',
  fontWeight: 650,
  color: 'var(--text2)',
  marginTop: '14px',
  marginBottom: '6px',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  borderRadius: '10px',
  border: '1px solid var(--border)',
  background: 'var(--bg-subtle)',
  fontSize: '13px',
  fontFamily: 'inherit',
};
