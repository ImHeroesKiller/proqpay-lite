'use client';

import { useMemo, useState } from 'react';
import { serviceState, serviceStateLabel, useServiceHealth } from '@/lib/service-health';

export default function SystemHealthBubble() {
  const { health, refresh } = useServiceHealth();
  const [checking, setChecking] = useState(false);
  const [dismissedSignature, setDismissedSignature] = useState('');

  const issues = useMemo(() => (health?.checks || []).filter((item) => item.status !== 'ok'), [health]);
  const operationalState = serviceState(health);
  const operationalLabel = serviceStateLabel(health);
  const signature = issues.map((item) => `${item.key}:${item.status}`).join('|');
  if (!issues.length || signature === dismissedSignature) return null;
  const hasError = operationalState === 'DOWN';

  return <aside className={`system-health-bubble ${hasError ? '' : 'system-health-warning'}`} role={hasError ? 'alert' : 'status'} aria-live="polite">
    <button type="button" aria-label="Tutup status layanan" onClick={() => setDismissedSignature(signature)}>✕</button>
    <h3>System health: {operationalLabel}</h3>
    <ul>{issues.map((item) => <li key={item.key}><strong>{item.label}</strong><span>{item.message}</span>{item.action ? <small>{item.action}</small> : null}</li>)}</ul>
    <div className="system-health-actions"><button type="button" disabled={checking} onClick={() => {
      setChecking(true);
      void refresh(true).finally(() => setChecking(false));
    }}>{checking ? 'Memeriksa…' : 'Cek ulang'}</button></div>
  </aside>;
}
