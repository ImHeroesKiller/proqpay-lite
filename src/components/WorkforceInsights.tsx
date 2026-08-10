'use client';

import { useMemo } from 'react';

const REFERENCE_TIME = Date.now();

function present(value: unknown) {
  return String(value ?? '').trim().length > 0;
}

function isExpired(employee: any, now: number) {
  const end = employee.contractEnd ? Date.parse(employee.contractEnd) : Number.NaN;
  return Number.isFinite(end) && end < now;
}

export default function WorkforceInsights({ employees, onOpenEmployees, showDataSourceBadge = true }: {
  employees: any[];
  onOpenEmployees?: (region?: string) => void;
  showDataSourceBadge?: boolean;
}) {
  const insight = useMemo(() => {
    const total = employees.length;
    const now = REFERENCE_TIME;
    const missingBank = employees.filter((employee) => !present(employee.accountNo || employee.bankAccount)).length;
    const missingNik = employees.filter((employee) => !present(employee.nik)).length;
    const missingBpjs = employees.filter((employee) => !present(employee.bpjsKesehatanNo) || !present(employee.jamsostekNo)).length;
    const expiredContracts = employees.filter((employee) => isExpired(employee, now)).length;
    const requiredCells = Math.max(total * 4, 1);
    const completeCells = requiredCells - missingBank - missingNik - missingBpjs - expiredContracts;
    const completeness = Math.max(0, Math.round((completeCells / requiredCells) * 100));
    const regions = new Map<string, number>();
    employees.forEach((employee) => {
      const region = employee.region || employee.province || 'Belum ditentukan';
      regions.set(region, (regions.get(region) || 0) + 1);
    });
    const topRegions = [...regions.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    return { total, missingBank, missingNik, missingBpjs, expiredContracts, completeness, topRegions };
  }, [employees]);

  const maxRegion = insight.topRegions[0]?.[1] || 1;
  const issues = [
    { label: 'Kontrak berakhir', count: insight.expiredContracts, tone: 'danger' },
    { label: 'NIK belum lengkap', count: insight.missingNik, tone: 'warning' },
    { label: 'BPJS perlu dilengkapi', count: insight.missingBpjs, tone: 'warning' },
    { label: 'Rekening belum lengkap', count: insight.missingBank, tone: 'info' },
  ];

  return (
    <div className="workforce-insights card">
      <div className="panel-heading">
        <div>
          <span className="panel-eyebrow">Kualitas data</span>
          <h3>Workforce readiness</h3>
        </div>
        {showDataSourceBadge ? <span className="live-chip"><i /> Live dari Neon</span> : null}
      </div>

      <div className="workforce-insights-body">
        <div className="readiness-score" style={{ '--score': `${insight.completeness * 3.6}deg` } as React.CSSProperties}>
          <div><strong>{insight.completeness}%</strong><span>siap proses</span></div>
        </div>
        <div className="readiness-issues">
          {issues.map((issue) => (
            <button type="button" key={issue.label} onClick={() => onOpenEmployees?.()}>
              <span className={`issue-dot issue-dot-${issue.tone}`} />
              <span>{issue.label}</span>
              <strong>{issue.count}</strong>
            </button>
          ))}
        </div>
      </div>

      <div className="region-breakdown">
        <div className="panel-subheading"><span>Sebaran teratas</span><small>{insight.total} karyawan</small></div>
        {insight.topRegions.map(([region, count]) => (
          <button type="button" className="region-bar-row" key={region} onClick={() => onOpenEmployees?.(region)}>
            <span>{region}</span>
            <div><i style={{ width: `${Math.max(8, (count / maxRegion) * 100)}%` }} /></div>
            <strong>{count}</strong>
          </button>
        ))}
      </div>
    </div>
  );
}
