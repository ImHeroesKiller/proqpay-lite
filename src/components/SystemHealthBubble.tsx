'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

type ServiceCheck = { key:string; label:string; status:'ok'|'warning'|'error'; message:string; action?:string };
type Health = { status?:string; ready?:boolean; checks?:ServiceCheck[] };

export default function SystemHealthBubble() {
  const [health, setHealth] = useState<Health | null>(null);
  const [checking, setChecking] = useState(false);
  const [dismissedSignature, setDismissedSignature] = useState('');

  const refresh = useCallback(async () => {
    setChecking(true);
    try {
      const response = await fetch('/api/health', { headers:{ Accept:'application/json' }, cache:'no-store' });
      const result = await response.json().catch(() => ({}));
      setHealth(result);
    } catch {
      setHealth({ status:'error', ready:false, checks:[{ key:'network', label:'Koneksi layanan', status:'error', message:'Health-check tidak dapat dihubungi.', action:'Periksa koneksi internet atau deployment Cloudflare Pages.' }] });
    } finally { setChecking(false); }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 300000);
    const visible = () => { if (document.visibilityState === 'visible') void refresh(); };
    document.addEventListener('visibilitychange', visible);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', visible); };
  }, [refresh]);

  const issues = useMemo(() => (health?.checks || []).filter((item) => item.status !== 'ok'), [health]);
  const signature = issues.map((item) => `${item.key}:${item.status}`).join('|');
  if (!issues.length || signature === dismissedSignature) return null;
  const hasError = issues.some((item) => item.status === 'error');

  return <aside className={`system-health-bubble ${hasError ? '' : 'system-health-warning'}`} role={hasError ? 'alert' : 'status'} aria-live="polite">
    <button type="button" aria-label="Tutup status layanan" onClick={() => setDismissedSignature(signature)}>✕</button>
    <h3>{hasError ? 'Layanan perlu dikonfigurasi' : 'Peringatan konfigurasi'}</h3>
    <ul>{issues.map((item) => <li key={item.key}><strong>{item.label}</strong><span>{item.message}</span>{item.action ? <small>{item.action}</small> : null}</li>)}</ul>
    <div className="system-health-actions"><button type="button" disabled={checking} onClick={() => void refresh()}>{checking ? 'Memeriksa…' : 'Cek ulang'}</button></div>
  </aside>;
}
