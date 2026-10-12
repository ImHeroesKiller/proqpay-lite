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
let volatileLogs:SystemLogEntry[]=[];
function purgeLegacyLogs(){if(typeof window==='undefined')return;try{window.localStorage.removeItem(KEY);}catch{/* storage unavailable */}}

export function loadSystemLogs(): SystemLogEntry[] {
  purgeLegacyLogs();
  if(typeof window==='undefined')return [];
  return [...volatileLogs];
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
  volatileLogs=next;
  purgeLegacyLogs();
  window.dispatchEvent(new CustomEvent(EVENT, { detail: entry }));
}

export function clearSystemLogs() {
  if (typeof window === 'undefined') return;
  volatileLogs=[];
  purgeLegacyLogs();
  window.dispatchEvent(new CustomEvent(EVENT));
}

export function onSystemLogChange(callback: () => void) {
  const handler = () => callback();
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}
