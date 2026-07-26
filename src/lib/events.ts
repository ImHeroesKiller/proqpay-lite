// Simple event bus for cross-component communication

type Listener = () => void;

const listeners = new Set<Listener>();

export function onDbChange(fn: Listener) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function emitDbChange() {
  listeners.forEach(fn => fn());
}
