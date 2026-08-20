'use client';

interface DashFiltersProps {
  period: string;
  availablePeriods?: string[];
  onPeriodChange?: (period: string) => void;
}

const MONTH_FORMAT = /^\d{4}-(0[1-9]|1[0-2])$/;

function periodLabel(period: string) {
  const [year, month] = period.split('-').map(Number);
  return new Intl.DateTimeFormat('id-ID', { month: 'long', year: 'numeric' }).format(new Date(year, month - 1, 1));
}

export default function DashFilters({ period, availablePeriods = [], onPeriodChange }: DashFiltersProps) {
  const options = [...new Set([period, ...availablePeriods].filter((item) => MONTH_FORMAT.test(item)))]
    .sort((a, b) => b.localeCompare(a));

  return (
    <div className="dashboard-period-control" aria-label="Kontrol periode payroll">
      <div>
        <span>Periode aktif</span>
        <strong>{periodLabel(period)}</strong>
        <small>{options.length} periode payroll tersedia</small>
      </div>
      <label>
        <span>Pilih histori</span>
        <select value={period} onChange={(event) => onPeriodChange?.(event.target.value)}>
          {options.map((item) => <option key={item} value={item}>{periodLabel(item)}</option>)}
        </select>
      </label>
      <label>
        <span>Buka periode lain</span>
        <input type="month" value={period} onChange={(event) => { if (MONTH_FORMAT.test(event.target.value)) onPeriodChange?.(event.target.value); }} />
      </label>
    </div>
  );
}
