const KEY = 'proqpay_ida_session';

export function getIdaSessionId(): string {
  if (typeof window === 'undefined') return 'server';
  try {
    let id = localStorage.getItem(KEY);
    if (!id) {
      const randomPart = typeof crypto?.randomUUID === 'function'
        ? crypto.randomUUID()
        : Array.from(crypto.getRandomValues(new Uint8Array(16)), (value) => value.toString(16).padStart(2, '0')).join('');
      id = `sess-${randomPart}`;
      localStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    return 'sess-tmp-unavailable';
  }
}
