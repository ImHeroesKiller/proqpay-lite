'use client';

import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { formatIDR } from '@/lib/format';
import {WorkspaceTitle} from '@/components/layout/WorkspacePrimitives';
import EmployeeDetailDrawer from '@/components/EmployeeDetailDrawer';
import { EmptyState as UiEmptyState, Pagination as UiPagination } from '@/components/ui/UnifiedSystem';
import {
  employeeInitials,
  employeeEssStatus,
  employeeEssLabel,
  employeeEssTone,
  type EmployeeEssStatus,
  employeeStatusTone,
  employeeText,
  type EmployeeActor,
  type EmployeeRecord,
} from '@/lib/employee-ui';

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
  const [essFilter,setEssFilter]=useState('ALL');
  const [essUpdates,setEssUpdates]=useState<Record<string,{source:EmployeeRecord;status:EmployeeEssStatus}>>({});
  const [filtersOpen,setFiltersOpen]=useState(false);
  const [page,setPage]=useState(1);
  const [selected,setSelected]=useState<EmployeeRecord|null>(null);
  const deferredQuery=useDeferredValue(query.trim().toLocaleLowerCase('id-ID'));

  const options=useMemo(()=>({
    clients:[...new Set(employees.map((employee)=>employeeText(employee.company)).filter(Boolean))].sort(),
    regions:[...new Set(employees.map((employee)=>employeeText(employee.region||employee.province)).filter(Boolean))].sort(),
  }),[employees]);

  const scopedEmployees=useMemo(()=>employees.map(employee=>{const update=essUpdates[employee.id];return update?.source===employee?{...employee,essStatus:update.status}:employee;}),[employees,essUpdates]);
  const summary=useMemo(()=>({
    total:scopedEmployees.length,
    active:scopedEmployees.filter(employee=>employee.isActive===true).length,
    issued:scopedEmployees.filter(employee=>['ACTIVE','LOCKED','PASSWORD_CHANGE_REQUIRED'].includes(employeeEssStatus(employee))).length,
    pending:scopedEmployees.filter(employee=>employeeEssStatus(employee)==='NOT_ISSUED').length,
  }),[scopedEmployees]);

  const filtered=useMemo(()=>scopedEmployees.filter((employee)=>{
    const haystack=[employee.id,employee.name,employee.company,employee.project,employee.position,employee.region]
      .map(employeeText).join(' ').toLocaleLowerCase('id-ID');
    if(deferredQuery&&!haystack.includes(deferredQuery)) return false;
    if(client!=='ALL'&&employeeText(employee.company)!==client) return false;
    if(region!=='ALL'&&employeeText(employee.region||employee.province)!==region) return false;
    if(essFilter!=='ALL'&&employeeEssStatus(employee)!==essFilter)return false;
    return true;
  }).sort((a,b)=>employeeText(a.name).localeCompare(employeeText(b.name),'id-ID')),[scopedEmployees,deferredQuery,client,region,essFilter]);

  const activeFilterCount=[client!=='ALL',region!=='ALL',essFilter!=='ALL'].filter(Boolean).length;
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
    setEssFilter('ALL');
    setPage(1);
  }

  return(
    <section className="employee-directory">
      <div className="page-heading employee-page-heading">
        <WorkspaceTitle eyebrow="People operations" title="Data Karyawan" description="Telusuri identitas, penempatan, rekening, payroll, dan status ESS karyawan." />
        <div className="employee-page-actions">
          <span className="role-access-chip">Akses: {actor?.role?.replaceAll('_',' ')||'CLIENT USER'}</span>
        </div>
      </div>

      <div className="employee-summary-grid">
        <div><span>Total karyawan</span><strong>{summary.total}</strong><small>record dalam scope Anda</small></div>
        <div><span>Status aktif</span><strong>{summary.active}</strong><small>sesuai lifecycle payroll/ESS</small></div>
        <div><span>Akun ESS dibuat</span><strong>{summary.issued}</strong><small>credential ESS sudah diterbitkan</small></div>
        <div><span>ESS belum dibuat</span><strong>{summary.pending}</strong><small>karyawan aktif tanpa credential ESS</small></div>
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
          <label><span>Status ESS</span><select aria-label="Status ESS" value={essFilter} onChange={(event)=>updateFilter(setEssFilter,event.target.value)}><option value="ALL">Semua status ESS</option>{(['NOT_ISSUED','PASSWORD_CHANGE_REQUIRED','ACTIVE','LOCKED','INACTIVE','UNKNOWN'] as EmployeeEssStatus[]).map(status=><option key={status} value={status}>{employeeEssLabel(status)}</option>)}</select></label>
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
              <col className="employee-col-ess"/>
              <col className="employee-col-salary"/>
              <col className="employee-col-action"/>
            </colgroup>
            <thead><tr><th>Karyawan</th><th>Penempatan</th><th>Status</th><th>Status ESS</th><th>Gaji pokok</th><th scope="col"><span className="visually-hidden">Aksi</span></th></tr></thead>
            <tbody>{visible.map((employee)=>{
              const ess=employeeEssStatus(employee);
              return <tr key={employee.id} onClick={()=>setSelected(employee)} tabIndex={0} onKeyDown={(event)=>{if(event.key==='Enter'||event.key===' ') {event.preventDefault();setSelected(employee);}}}>
                <td><div className="employee-identity"><span>{employeeInitials(employee.name)}</span><div><strong>{employee.name}</strong><small>{employee.employeeCode||employee.id} · NRK {employee.id} · {employee.position||'Posisi belum diisi'}</small></div></div></td>
                <td><strong className="cell-primary">{employee.company||'-'}</strong><small>{employee.project||employee.region||'-'}</small></td>
                <td><span className={`status-pill status-${employeeStatusTone(employee.status)}`}>{employee.status||'Belum diisi'}</span></td>
                <td><span className={`status-pill status-${employeeEssTone(ess)}`}>{employeeEssLabel(ess)}</span></td>
                <td><strong className="cell-primary">{formatIDR(Number(employee.salaryGross||0))}</strong><small>{employee.bankName||'Bank belum diisi'}</small></td>
                <td><button type="button" aria-label={`Lihat detail ${employee.name||employee.id}`} onClick={(event)=>{event.stopPropagation();setSelected(employee);}}>→</button></td>
              </tr>;
            })}</tbody>
          </table>
          <div className="employee-mobile-list">
            {visible.map((employee)=>{
              const ess=employeeEssStatus(employee);
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
                  <div><span>Status ESS</span><strong>{employeeEssLabel(ess)}</strong></div>
                  <div><span>Gaji pokok</span><strong>{formatIDR(Number(employee.salaryGross||0))}</strong></div>
                </div>
                <span className="employee-mobile-open">Lihat detail →</span>
              </button>;
            })}
          </div>
          {!visible.length?<UiEmptyState title="Data tidak ditemukan" body="Coba ubah kata pencarian atau filter." />:null}
        </div>
        <UiPagination
          page={safePage}
          pageCount={pageCount}
          previousDisabled={safePage<=1}
          nextDisabled={safePage>=pageCount}
          onPrevious={()=>setPage((value)=>Math.max(1,value-1))}
          onNext={()=>setPage((value)=>Math.min(pageCount,value+1))}
        />
      </div>

      {selected?<EmployeeDetailDrawer employee={selected} actor={actor} maskSensitiveData={maskSensitiveData} onEssGenerated={()=>{const source=employees.find(employee=>employee.id===selected.id);if(source)setEssUpdates(current=>({...current,[selected.id]:{source,status:'PASSWORD_CHANGE_REQUIRED'}}));}} onClose={()=>setSelected(null)} onSaved={async()=>{setSelected(null);await onChanged?.();}}/>:null}
    </section>
  );
}
