'use client';

interface DashFiltersProps {
  period: string;
  onPeriodChange?: (period: string) => void;
}

export default function DashFilters({ period, onPeriodChange }: DashFiltersProps) {
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
          <option value="2025-07">2025-07</option>
          <option value="2025-06">2025-06</option>
          <option value="2025-05">2025-05</option>
        </select>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <label style={{ fontSize: '10px', fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          Date Range
        </label>
        <input
          type="text"
          defaultValue="2025-01-01 → 2025-07-31"
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
