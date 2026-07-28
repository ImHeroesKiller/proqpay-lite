'use client';

interface DashFiltersProps {
  period: string;
  onPeriodChange?: (period: string) => void;
}

export default function DashFilters({ period, onPeriodChange }: DashFiltersProps) {
  const [year, month] = period.split('-').map(Number);
  const periods = Array.from({ length: 12 }, (_, index) => {
    const date = new Date(year, month - 1 - index, 1);
    return date.toISOString().slice(0, 7);
  });
  const startDate = `${period}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const endDate = `${period}-${String(lastDay).padStart(2, '0')}`;

  return (
    <div style={{
      display: 'flex',
      flexWrap: 'wrap',
      gap: '12px',
      marginBottom: '18px',
      padding: '12px 14px',
      background: 'var(--bg-surface)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--r-lg)',
    }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <label style={{ fontSize: '10px', fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          Periode
        </label>
        <select
          value={period}
          onChange={(e) => onPeriodChange?.(e.target.value)}
          style={{
            background: 'var(--bg-subtle)',
            border: '1px solid var(--border)',
            color: 'var(--text)',
            padding: '7px 12px',
            borderRadius: 'var(--r-sm)',
            fontSize: '13px',
            fontFamily: 'inherit',
            minWidth: '120px',
            outline: 'none',
          }}
        >
          {periods.map((item) => (
            <option key={item} value={item}>{item}</option>
          ))}
        </select>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <label style={{ fontSize: '10px', fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          Date Range
        </label>
        <input
          type="text"
          value={`${startDate} → ${endDate}`}
          readOnly
          style={{
            background: 'var(--bg-subtle)',
            border: '1px solid var(--border)',
            color: 'var(--text2)',
            padding: '7px 12px',
            borderRadius: 'var(--r-sm)',
            fontSize: '13px',
            fontFamily: 'inherit',
            minWidth: '180px',
            outline: 'none',
          }}
        />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <label style={{ fontSize: '10px', fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          Bundling
        </label>
        <select
          defaultValue="bulanan"
          style={{
            background: 'var(--bg-subtle)',
            border: '1px solid var(--border)',
            color: 'var(--text)',
            padding: '7px 12px',
            borderRadius: 'var(--r-sm)',
            fontSize: '13px',
            fontFamily: 'inherit',
            minWidth: '200px',
            outline: 'none',
          }}
        >
          <option value="bulanan">Bulanan (tgl 1 – 28/30/31)</option>
          <option value="mingguan">Mingguan (Senin – Minggu)</option>
          <option value="tahunan">Tahunan (Jan – Des)</option>
        </select>
      </div>
    </div>
  );
}
