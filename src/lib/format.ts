export function formatIDR(n: number | null | undefined): string {
  if (n == null) return 'Rp 0';
  return 'Rp ' + Math.round(n).toLocaleString('id-ID');
}

export function formatIDRShort(n: number): string {
  if (n >= 1e9) return 'Rp ' + (n / 1e9).toFixed(1) + ' M';
  if (n >= 1e6) return 'Rp ' + (n / 1e6).toFixed(1) + ' jt';
  if (n >= 1e3) return 'Rp ' + (n / 1e3).toFixed(0) + ' rb';
  return 'Rp ' + Math.round(n);
}

export function formatDate(ts: number | null | undefined): string {
  if (!ts) return '-';
  return new Date(ts).toLocaleDateString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
