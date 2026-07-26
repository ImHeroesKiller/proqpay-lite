const KEY = 'proqpay_ida_session';

export function getIdaSessionId(): string {
  if (typeof window === 'undefined') return 'server';
  try {
    let id = localStorage.getItem(KEY);
    if (!id) {
      id = `sess-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
      localStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    return `sess-tmp-${Date.now()}`;
  }
}
