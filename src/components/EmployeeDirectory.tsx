'use client';

import { useDeferredValue, useMemo, useState } from 'react';
import { formatIDR } from '@/lib/format';

const PAGE_SIZE = 15;
const REFERENCE_TIME = Date.now();

function text(value: unknown) {
  return String(value ?? '').trim();
}

function dateLabel(value: unknown) {
  if (!value) return '-';
  const timestamp = Date.parse(String(value));
  if (!Number.isFinite(timestamp)) return '-';
  return new Intl.DateTimeFormat('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(timestamp));
}

function employeeIssue(employee: any) {
  const issues: string[] = [];
  if (!text(employee.accountNo || employee.bankAccount)) issues.push('Rekening');
  if (!text(employee.nik)) issues.push('NIK');
  if (!text(employee.bpjsKesehatanNo)) issues.push('BPJS Kes');
  if (!text(employee.jamsostekNo)) issues.push('BPJS TK');
  return issues;
}

function statusTone(status: unknown) {
  const value = text(status).toLowerCase();
  if (/aktif|tetap|permanent/.test(value)) return 'success';
  if (/habis|expired|resign|nonaktif|terminated/.test(value)) return 'danger';
  return 'warning';
}

function initials(name: unknown) {
  return text(name).split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || '—';
}

export default function EmployeeDirectory({ employees, actor }: { employees: any[]; actor: { role: string } | null }) {
  const [query, setQuery] = useState('');
  const [client, setClient] = useState('ALL');
  const [region, setRegion] = useState('ALL');
  const [quality, setQuality] = useState('ALL');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<any | null>(null);
  const deferredQuery = useDeferredValue(query.trim().toLocaleLowerCase('id-ID'));

  const options = useMemo(() => ({
    clients: [...new Set(employees.map((employee) => text(employee.company)).filter(Boolean))].sort(),
    regions: [...new Set(employees.map((employee) => text(employee.region || employee.province)).filter(Boolean))].sort(),
  }), [employees]);

  const summary = useMemo(() => {
    const now = REFERENCE_TIME;
    let missing = 0;
    let expired = 0;
    let active = 0;
    employees.forEach((employee) => {
      if (employeeIssue(employee).length) missing += 1;
      const end = employee.contractEnd ? Date.parse(employee.contractEnd) : Number.NaN;
      if (Number.isFinite(end) && end < now) expired += 1;
      else if (/aktif|tetap|kontrak/i.test(text(employee.status))) active += 1;
    });
    return { total: employees.length, active, expired, missing };
  }, [employees]);

  const filtered = useMemo(() => employees.filter((employee) => {
    const haystack = [employee.id, employee.name, employee.company, employee.project, employee.position, employee.region]
      .map(text).join(' ').toLocaleLowerCase('id-ID');
    if (deferredQuery && !haystack.includes(deferredQuery)) return false;
    if (client !== 'ALL' && text(employee.company) !== client) return false;
    if (region !== 'ALL' && text(employee.region || employee.province) !== region) return false;
    if (quality === 'ISSUE' && !employeeIssue(employee).length) return false;
    if (quality === 'COMPLETE' && employeeIssue(employee).length) return false;
    return true;
  }).sort((a, b) => text(a.name).localeCompare(text(b.name), 'id-ID')), [employees, deferredQuery, client, region, quality]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const visible = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  function updateFilter(setter: (value: string) => void, value: string) {
    setter(value);
    setPage(1);
  }

  return (
    <section className="employee-directory">
      <div className="page-heading employee-page-heading">
        <div>
          <span className="page-eyebrow">People operations</span>
          <h1>Data Karyawan</h1>
          <p>Telusuri profil, penempatan, kontrak, payroll, dan kelengkapan administrasi.</p>
        </div>
        <span className="role-access-chip">Akses: {actor?.role?.replaceAll('_', ' ') || 'VIEWER'}</span>
      </div>

      <div className="employee-summary-grid">
        <div><span>Total karyawan</span><strong>{summary.total}</strong><small>record dalam scope Anda</small></div>
        <div><span>Status aktif</span><strong>{summary.active}</strong><small>aktif/tetap/kontrak</small></div>
        <div><span>Kontrak berakhir</span><strong>{summary.expired}</strong><small>berdasarkan tanggal akhir</small></div>
        <div><span>Perlu dilengkapi</span><strong>{summary.missing}</strong><small>NIK, BPJS, atau rekening</small></div>
      </div>

      <div className="employee-toolbar card">
        <label className="employee-search">
          <span aria-hidden="true">⌕</span>
          <input
            value={query}
            onChange={(event) => { setQuery(event.target.value); setPage(1); }}
            placeholder="Cari nama, NRK, klien, project…"
            aria-label="Cari karyawan"
          />
        </label>
        <label><span>Klien</span><select value={client} onChange={(event) => updateFilter(setClient, event.target.value)}><option value="ALL">Semua klien</option>{options.clients.map((item) => <option key={item}>{item}</option>)}</select></label>
        <label><span>Wilayah</span><select value={region} onChange={(event) => updateFilter(setRegion, event.target.value)}><option value="ALL">Semua wilayah</option>{options.regions.map((item) => <option key={item}>{item}</option>)}</select></label>
        <label><span>Kualitas</span><select value={quality} onChange={(event) => updateFilter(setQuality, event.target.value)}><option value="ALL">Semua data</option><option value="COMPLETE">Lengkap</option><option value="ISSUE">Perlu dilengkapi</option></select></label>
      </div>

      <div className="employee-table-card card">
        <div className="employee-table-meta"><span>Menampilkan <strong>{filtered.length}</strong> karyawan</span><small>Klik baris untuk melihat seluruh field yang diizinkan.</small></div>
        <div className="employee-table-scroll">
          <table className="employee-table">
            <thead><tr><th>Karyawan</th><th>Penempatan</th><th>Status</th><th>Kontrak</th><th>Kelengkapan</th><th>Gaji pokok</th><th aria-label="Aksi" /></tr></thead>
            <tbody>
              {visible.map((employee) => {
                const issues = employeeIssue(employee);
                return (
                  <tr key={employee.id} onClick={() => setSelected(employee)} tabIndex={0} onKeyDown={(event) => { if (event.key === 'Enter') setSelected(employee); }}>
                    <td><div className="employee-identity"><span>{initials(employee.name)}</span><div><strong>{employee.name}</strong><small>{employee.id} · {employee.position || 'Posisi belum diisi'}</small></div></div></td>
                    <td><strong className="cell-primary">{employee.company || '-'}</strong><small>{employee.project || employee.region || '-'}</small></td>
                    <td><span className={`status-pill status-${statusTone(employee.status)}`}>{employee.status || 'Belum diisi'}</span></td>
                    <td><strong className="cell-primary">{dateLabel(employee.contractEnd)}</strong><small>{employee.employmentType || 'Tipe belum diisi'}</small></td>
                    <td>{issues.length ? <span className="quality-pill quality-issue">{issues.length} isu</span> : <span className="quality-pill quality-complete">Lengkap</span>}<small>{issues.slice(0, 2).join(', ') || 'Data utama siap'}</small></td>
                    <td><strong className="cell-primary">{formatIDR(employee.salaryGross || 0)}</strong><small>{employee.bankName || 'Bank belum diisi'}</small></td>
                    <td><button type="button" aria-label={`Lihat detail ${employee.name}`} onClick={(event) => { event.stopPropagation(); setSelected(employee); }}>→</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!visible.length ? <div className="employee-empty"><strong>Data tidak ditemukan</strong><span>Coba ubah kata pencarian atau filter.</span></div> : null}
        </div>
        <div className="employee-pagination"><span>Halaman {safePage} dari {pageCount}</span><div><button type="button" disabled={safePage <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>← Sebelumnya</button><button type="button" disabled={safePage >= pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))}>Berikutnya →</button></div></div>
      </div>

      {selected ? <EmployeeDetail employee={selected} onClose={() => setSelected(null)} /> : null}
    </section>
  );
}

function EmployeeDetail({ employee, onClose }: { employee: any; onClose: () => void }) {
  const groups = [
    { title: 'Pekerjaan', fields: [['NRK', employee.id], ['Klien', employee.company], ['Project', employee.project], ['Posisi', employee.position], ['Status', employee.status], ['Tipe kerja', employee.employmentType]] },
    { title: 'Kontrak', fields: [['Tanggal bergabung', dateLabel(employee.joinDate)], ['Mulai kontrak', dateLabel(employee.contractStart)], ['Akhir kontrak', dateLabel(employee.contractEnd)], ['Tanggal resign', dateLabel(employee.resignDate)], ['Alasan resign', employee.resignReason]] },
    { title: 'Administrasi', fields: [['NIK', employee.nik], ['NPWP', employee.npwp], ['Rekening', employee.accountNo], ['Bank', employee.bankName], ['BPJS Kesehatan', employee.bpjsKesehatanNo], ['BPJS TK', employee.jamsostekNo]] },
    { title: 'Kontak', fields: [['Email', employee.email], ['Telepon', employee.phone || employee.mobile], ['Alamat', employee.address], ['Wilayah', employee.region || employee.province]] },
  ];
  return (
    <div className="employee-drawer-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <aside className="employee-drawer" role="dialog" aria-modal="true" aria-label={`Detail ${employee.name}`}>
        <div className="employee-drawer-header"><div className="employee-avatar-lg">{initials(employee.name)}</div><div><span>PROFIL KARYAWAN</span><h2>{employee.name}</h2><p>{employee.position || 'Posisi belum diisi'} · {employee.company || '-'}</p></div><button type="button" onClick={onClose} aria-label="Tutup detail">✕</button></div>
        <div className="employee-drawer-pay"><span>Gaji pokok</span><strong>{formatIDR(employee.salaryGross || 0)}</strong><em className={`status-pill status-${statusTone(employee.status)}`}>{employee.status || 'Belum diisi'}</em></div>
        <div className="employee-detail-groups">{groups.map((group) => <section key={group.title}><h3>{group.title}</h3><dl>{group.fields.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{text(value) || '-'}</dd></div>)}</dl></section>)}</div>
      </aside>
    </div>
  );
}
