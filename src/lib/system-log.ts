export type SystemLogLevel = 'INFO' | 'SUCCESS' | 'WARN' | 'ERROR';

export type SystemLogEntry = {
  id: string;
  timestamp: number;
  level: SystemLogLevel;
  source: string;
  event: string;
  message: string;
  meta?: Record<string, unknown>;
};

const KEY = 'proqpay_system_logs_v1';
const MAX_ENTRIES = 500;
const EVENT = 'proqpay-system-log';

export function loadSystemLogs(): SystemLogEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const value = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

export function writeSystemLog(
  level: SystemLogLevel,
  source: string,
  event: string,
  message: string,
  meta?: Record<string, unknown>
) {
  if (typeof window === 'undefined') return;
  const entry: SystemLogEntry = {
    id: crypto.randomUUID(),
    timestamp: Date.now(),
    level,
    source,
    event,
    message,
    ...(meta ? { meta } : {}),
  };
  const next = [...loadSystemLogs(), entry].slice(-MAX_ENTRIES);
  localStorage.setItem(KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent(EVENT, { detail: entry }));
}

export function clearSystemLogs() {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(KEY);
  window.dispatchEvent(new CustomEvent(EVENT));
}

export function onSystemLogChange(callback: () => void) {
  const handler = () => callback();
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}
