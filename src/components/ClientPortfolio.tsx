'use client';

import { useMemo, useState } from 'react';

export default function ClientPortfolio({ companies, employees, projects, pageSize = 5, onOpenDirectory }: {
  companies: any[];
  employees: any[];
  projects: any[];
  pageSize?: number;
  onOpenDirectory: () => void;
}) {
  const [page, setPage] = useState(1);
  const rows = useMemo(() => companies.map((company) => ({
    ...company,
    employeeCount: employees.filter((employee) => employee.company === company.name).length,
    projectCount: projects.filter((project) => project.company === company.name || project.client_id === company.id).length,
  })).sort((a, b) => String(a.name).localeCompare(String(b.name), 'id-ID')), [companies, employees, projects]);
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const visible = rows.slice((safePage - 1) * pageSize, safePage * pageSize);

  return (
    <div className="card dashboard-client-card">
      <div className="panel-heading">
        <div><span className="panel-eyebrow">Portofolio</span><h3>Klien aktif</h3></div>
        <button type="button" onClick={onOpenDirectory}>Lihat semua →</button>
      </div>
      <div className="dashboard-client-list">
        {visible.map((company) => (
          <button type="button" key={company.id} className="dashboard-client-row" onClick={onOpenDirectory}>
            <span className="dashboard-client-mark">{String(company.name || '?').slice(0, 2).toUpperCase()}</span>
            <span><strong>{company.name}</strong><small>{company.code || company.id}</small></span>
            <span><strong>{company.employeeCount}</strong><small>Karyawan</small></span>
            <span><strong>{company.projectCount}</strong><small>Project</small></span>
            <i>→</i>
          </button>
        ))}
        {!visible.length ? <div className="directory-empty">Belum ada klien dalam scope ini.</div> : null}
      </div>
      <div className="dashboard-list-pagination">
        <span>{rows.length ? `${(safePage - 1) * pageSize + 1}–${Math.min(safePage * pageSize, rows.length)} dari ${rows.length}` : '0 data'}</span>
        <div><button type="button" aria-label="Halaman sebelumnya" disabled={safePage === 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>←</button><span>{safePage}/{pageCount}</span><button type="button" aria-label="Halaman berikutnya" disabled={safePage === pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))}>→</button></div>
      </div>
    </div>
  );
}
