'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getIntegrationMonitor, type IntegrationMonitorResponse, type MonitorFilters } from '@/lib/integration-monitor-api';

export function useIntegrationMonitor(filters: MonitorFilters, empty: IntegrationMonitorResponse) {
  const [data, setData] = useState<IntegrationMonitorResponse>(empty);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [retryCount, setRetryCount] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const initializedRef = useRef(false);

  const load = useCallback(async (mode: 'initial' | 'refresh' | 'retry' = 'refresh') => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    if (mode === 'initial') setLoading(true);
    else setRefreshing(true);
    setError('');
    try {
      const next = await getIntegrationMonitor(filters, controller.signal);
      setData(next);
      setRetryCount(0);
      initializedRef.current = true;
    } catch (cause) {
      if (controller.signal.aborted) return;
      setRetryCount((value) => value + 1);
      setError(cause instanceof Error ? cause.message : 'Monitoring endpoint gagal dimuat');
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [filters]);

  useEffect(() => {
    void load(initializedRef.current ? 'refresh' : 'initial');
    return () => abortRef.current?.abort();
  }, [load]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'visible' && initializedRef.current && !error) void load('refresh');
    };
    document.addEventListener('visibilitychange', onVisibility);
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible' && !error) void load('refresh');
    }, 30_000);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [load, error]);

  return { data, loading, refreshing, error, retryCount, load, setError };
}
