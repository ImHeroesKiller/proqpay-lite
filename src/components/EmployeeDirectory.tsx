'use client';

import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { formatIDR } from '@/lib/format';
import EmployeeCredentialsPanel from '@/components/EmployeeCredentialsPanel';
import EmployeeDetailDrawer from '@/components/EmployeeDetailDrawer';
import {
  employeeDateLabel,
  employeeInitials,
  employeeIssues,
  employeeStatusTone,
  employeeText,
  type EmployeeActor,
  type EmployeeRecord,
} from '@/lib/employee-ui';

const REFERENCE_TIME = Date.now();

export default function EmployeeDirectory({
  employees,
  actor,
  pageSize = 15,
  initialRegion = 'ALL',
  maskSensitiveData = false,
  onChanged,
}: {
  employees: EmployeeRecord[];
  actor: EmployeeActor | null;
  pageSize?: number;
  initialRegion?: string;
  maskSensitiveData?: boolean;
  onChanged?: () => Promise<void>;
}) {
  const [query,setQuery]=useState(()=>typeof window==='undefined'?'':new URLSearchParams(window.location.search).get('employeeQuery')||'');
  const [client,setClient]=useState('ALL');
  const [region,setRegion]=useState(initialRegion);
  const [quality,setQuality]=useState('ALL');
  const [filtersOpen,setFiltersOpen]=useState(false);
  const [page,setPage]=useState(1);
  const [selected,setSelected]=useState<EmployeeRecord|null>(null);
  const deferredQuery=useDeferredValue(query.trim().toLocaleLowerCase('id-ID'));

  const options=useMemo(()=>({
    clients:[...new Set(employees.map((employee)=>employeeText(employee.company)).filter(Boolean))].sort(),
    regions:[...new Set(employees.map((employee)=>employeeText(employee.region||employee.province)).filter(Boolean))].sort(),
  }),[employees]);

  const summary=useMemo(()=>{
    const now=REFERENCE_TIME;
    let missing=0,expired=0,active=0;
    employees.forEach((employee)=>{
      if(employeeIssues(employee).length) missing+=1;
      const end=employee.contractEnd?Date.parse(employee.contractEnd):Number.NaN;
      if(Number.isFinite(end)&&end<now) expired+=1;
      if(employee.isActive===true) active+=1;
    });
    return{total:employees.length,active,expired,missing};
  },[employees]);

  const filtered=useMemo(()=>employees.filter((employee)=>{
    const haystack=[employee.id,employee.name,employee.company,employee.project,employee.position,employee.region]
      .map(employeeText).join(' ').toLocaleLowerCase('id-ID');
    if(deferredQuery&&!haystack.includes(deferredQuery)) return false;
    if(client!=='ALL'&&employeeText(employee.company)!==client) return false;
    if(region!=='ALL'&&employeeText(employee.region||employee.province)!==region) return false;
    if(quality==='ISSUE'&&!employeeIssues(employee).length) return false;
    if(quality==='COMPLETE'&&employeeIssues(employee).length) return false;
    return true;
  }).sort((a,b)=>employeeText(a.name).localeCompare(employeeText(b.name),'id-ID')),[employees,deferredQuery,client,region,quality]);

  const activeFilterCount=[client!=='ALL',region!=='ALL',quality!=='ALL'].filter(Boolean).length;
  const pageCount=Math.max(1,Math.ceil(filtered.length/pageSize));
  const safePage=Math.min(page,pageCount);
  const visible=filtered.slice((safePage-1)*pageSize,safePage*pageSize);

  useEffect(()=>{
    if(!query||filtered.length!==1||selected) return;
    setSelected(filtered[0]);
  },[filtered,query,selected]);

  function updateFilter(setter:(value:string)=>void,value:string){
    setter(value);
    setPage(1);
  }

  function resetFilters(){
    setClient('ALL');
    setRegion(initialRegion);
    setQuality('ALL');
    setPage(1);
  }

  return(
    <section className="employee-directory">
      <div className="page-heading employee-page-heading">
        <div>
          <span className="page-eyebrow">People operations</span>
          <h1>Data Karyawan</h1>
          <p>Telusuri profil, penempatan, kontrak, payroll, dan kelengkapan administrasi.</p>
        </div>
        <div className="employee-page-actions">
          <EmployeeCredentialsPanel actor={actor}/>
          <span className="role-access-chip">Akses: {actor?.role?.replaceAll('_',' ')||'CLIENT USER'}</span>
        </div>
      </div>

      <div className="employee-summary-grid">
        <div><span>Total karyawan</span><strong>{summary.total}</strong><small>record dalam scope Anda</small></div>
        <div><span>Status aktif</span><strong>{summary.active}</strong><small>sesuai lifecycle payroll/ESS</small></div>
        <div><span>Kontrak berakhir</span><strong>{summary.expired}</strong><small>berdasarkan tanggal akhir</small></div>
        <div><span>Perlu dilengkapi</span><strong>{summary.missing}</strong><small>NIK, BPJS, atau rekening</small></div>
      </div>

      <div className="employee-toolbar card">
        <div className="employee-toolbar-main">
          <label className="employee-search"><span aria-hidden="true">⌕</span><input value={query} onChange={(event)=>{setQuery(event.target.value);setPage(1);}} placeholder="Cari nama, NRK, klien, project…" aria-label="Cari karyawan"/></label>
          <div className="employee-filter-actions">
            <button type="button" className={`btn ${filtersOpen?'active':''}`} aria-expanded={filtersOpen} onClick={()=>setFiltersOpen((value)=>!value)}>
              Filter{activeFilterCount? ` (${activeFilterCount})`:''}
            </button>
            {(activeFilterCount>0||query)?<button type="button" className="btn" onClick={()=>{resetFilters();setQuery('');}}>Reset</button>:null}
          </div>
        </div>
        {filtersOpen?<div className="employee-filter-panel">
          <label><span>Klien</span><select value={client} onChange={(event)=>updateFilter(setClient,event.target.value)}><option value="ALL">Semua klien</option>{options.clients.map((item)=><option key={item}>{item}</option>)}</select></label>
          <label><span>Wilayah</span><select value={region} onChange={(event)=>updateFilter(setRegion,event.target.value)}><option value="ALL">Semua wilayah</option>{options.regions.map((item)=><option key={item}>{item}</option>)}</select></label>
          <label><span>Kualitas</span><select value={quality} onChange={(event)=>updateFilter(setQuality,event.target.value)}><option value="ALL">Semua data</option><option value="COMPLETE">Lengkap</option><option value="ISSUE">Perlu dilengkapi</option></select></label>
        </div>:null}
      </div>

      <div className="employee-table-card card">
        <div className="employee-table-meta"><span>Menampilkan <strong>{filtered.length}</strong> karyawan</span><small>Klik baris untuk melihat seluruh field yang diizinkan.</small></div>
        <div className="employee-table-scroll">
          <table className="employee-table">
            <colgroup>
              <col className="employee-col-person"/>
              <col className="employee-col-placement"/>
              <col className="employee-col-status"/>
              <col className="employee-col-contract"/>
              <col className="employee-col-quality"/>
              <col className="employee-col-salary"/>
              <col className="employee-col-action"/>
            </colgroup>
            <thead><tr><th>Karyawan</th><th>Penempatan</th><th>Status</th><th>Kontrak</th><th>Kelengkapan</th><th>Gaji pokok</th><th aria-label="Aksi"/></tr></thead>
            <tbody>{visible.map((employee)=>{
              const issues=employeeIssues(employee);
              return <tr key={employee.id} onClick={()=>setSelected(employee)} tabIndex={0} onKeyDown={(event)=>{if(event.key==='Enter'||event.key===' ') {event.preventDefault();setSelected(employee);}}}>
                <td><div className="employee-identity"><span>{employeeInitials(employee.name)}</span><div><strong>{employee.name}</strong><small>{employee.employeeCode||employee.id} · NRK {employee.id} · {employee.position||'Posisi belum diisi'}</small></div></div></td>
                <td><strong className="cell-primary">{employee.company||'-'}</strong><small>{employee.project||employee.region||'-'}</small></td>
                <td><span className={`status-pill status-${employeeStatusTone(employee.status)}`}>{employee.status||'Belum diisi'}</span></td>
                <td><strong className="cell-primary">{employeeDateLabel(employee.contractEnd)}</strong><small>{employee.employmentType||'Tipe belum diisi'}</small></td>
                <td>{issues.length?<span className="quality-pill quality-issue">{issues.length} isu</span>:<span className="quality-pill quality-complete">Lengkap</span>}<small>{issues.slice(0,2).join(', ')||'Data utama siap'}</small></td>
                <td><strong className="cell-primary">{formatIDR(Number(employee.salaryGross||0))}</strong><small>{employee.bankName||'Bank belum diisi'}</small></td>
                <td><button type="button" aria-label={`Lihat detail ${employee.name||employee.id}`} onClick={(event)=>{event.stopPropagation();setSelected(employee);}}>→</button></td>
              </tr>;
            })}</tbody>
          </table>
          <div className="employee-mobile-list">
            {visible.map((employee)=>{
              const issues=employeeIssues(employee);
              return <button key={employee.id} type="button" className="employee-mobile-card" onClick={()=>setSelected(employee)}>
                <div className="employee-mobile-card-head">
                  <span className="employee-mobile-avatar">{employeeInitials(employee.name)}</span>
                  <div><strong>{employee.name}</strong><small>{employee.employeeCode||employee.id} · {employee.position||'Posisi belum diisi'}</small></div>
                  <span className={`status-pill status-${employeeStatusTone(employee.status)}`}>{employee.status||'Belum diisi'}</span>
                </div>
                <div className="employee-mobile-scope">
                  <div><span>Klien</span><strong>{employee.company||'-'}</strong></div>
                  <div><span>Project</span><strong>{employee.project||employee.region||'-'}</strong></div>
                </div>
                <div className="employee-mobile-metrics">
                  <div><span>Kontrak</span><strong>{employeeDateLabel(employee.contractEnd)}</strong></div>
                  <div><span>Kelengkapan</span><strong>{issues.length?`${issues.length} isu`:'Lengkap'}</strong></div>
                  <div><span>Gaji pokok</span><strong>{formatIDR(Number(employee.salaryGross||0))}</strong></div>
                </div>
                <span className="employee-mobile-open">Lihat detail →</span>
              </button>;
            })}
          </div>
          {!visible.length?<div className="employee-empty"><strong>Data tidak ditemukan</strong><span>Coba ubah kata pencarian atau filter.</span></div>:null}
        </div>
        <div className="employee-pagination"><span>Halaman {safePage} dari {pageCount}</span><div><button type="button" disabled={safePage<=1} onClick={()=>setPage((value)=>Math.max(1,value-1))}>← Sebelumnya</button><button type="button" disabled={safePage>=pageCount} onClick={()=>setPage((value)=>Math.min(pageCount,value+1))}>Berikutnya →</button></div></div>
      </div>

      {selected?<EmployeeDetailDrawer employee={selected} actor={actor} maskSensitiveData={maskSensitiveData} onClose={()=>setSelected(null)} onSaved={async()=>{setSelected(null);await onChanged?.();}}/>:null}
    </section>
  );
}
