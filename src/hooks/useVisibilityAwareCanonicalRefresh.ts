'use client';

import { useEffect } from 'react';
import { loadDatabase, saveDatabase } from '@/lib/database';
import { syncDatabaseFromCloudflare } from '@/lib/cloudflare-sync';
import { writeSystemLog } from '@/lib/system-log';

export function useVisibilityAwareCanonicalRefresh(
  minutes:number,
  onDatabase:(db:unknown)=>void,
) {
  useEffect(() => {
    if (!minutes) return;
    const intervalMs = minutes * 60_000;
    let lastRunAt = Date.now();

    const refreshWhenVisible = () => {
      if (document.visibilityState !== 'visible') return;
      lastRunAt = Date.now();
      const current = loadDatabase();
      void syncDatabaseFromCloudflare(current)
        .then(({ db:canonical }) => {
          saveDatabase(canonical);
          onDatabase(canonical);
        })
        .catch(() => writeSystemLog('WARN','DATABASE','AUTO_REFRESH_FAILED','Refresh otomatis gagal'));
    };

    const timer = window.setInterval(refreshWhenVisible, intervalMs);
    const onVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastRunAt >= intervalMs) refreshWhenVisible();
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [minutes, onDatabase]);
}
