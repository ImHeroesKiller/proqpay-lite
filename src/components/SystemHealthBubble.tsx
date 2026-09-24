'use client';

import { useMemo, useState } from 'react';
import { useServiceHealth } from '@/lib/service-health';

export default function SystemHealthBubble() {
  const { health, refresh } = useServiceHealth();
  const [checking, setChecking] = useState(false);
  const [dismissedSignature, setDismissedSignature] = useState('');

  const issues = useMemo(() => (health?.checks || []).filter((item) => item.status !== 'ok'), [health]);
  const signature = issues.map((item) => `${item.key}:${item.status}`).join('|');
  if (!issues.length || signature === dismissedSignature) return null;
  const hasError = issues.some((item) => item.status === 'error');

  return <aside className={`system-health-bubble ${hasError ? '' : 'system-health-warning'}`} role={hasError ? 'alert' : 'status'} aria-live="polite">
    <button type="button" aria-label="Tutup status layanan" onClick={() => setDismissedSignature(signature)}>✕</button>
    <h3>{hasError ? 'Layanan perlu dikonfigurasi' : 'Peringatan konfigurasi'}</h3>
    <ul>{issues.map((item) => <li key={item.key}><strong>{item.label}</strong><span>{item.message}</span>{item.action ? <small>{item.action}</small> : null}</li>)}</ul>
    <div className="system-health-actions"><button type="button" disabled={checking} onClick={() => {
      setChecking(true);
      void refresh().finally(() => setChecking(false));
    }}>{checking ? 'Memeriksa…' : 'Cek ulang'}</button></div>
  </aside>;
}
