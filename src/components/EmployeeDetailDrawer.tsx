'use client';

import { useEffect, useRef, useState } from 'react';
import { formatIDR } from '@/lib/format';
import {
  canManageEmployees,
  employeeIntakePayroll,
  employeeInitials,
  employeeMasked,
  employeeStatusTone,
  employeeText,
  type EmployeeActor,
  type EmployeeAdminForm,
  type EmployeeRecord,
} from '@/lib/employee-ui';

export default function EmployeeDetailDrawer({
  employee,
  actor,
  maskSensitiveData,
  onClose,
  onSaved,
}: {
  employee: EmployeeRecord;
  actor: EmployeeActor | null;
  maskSensitiveData: boolean;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [editing,setEditing]=useState(false);
  const [activeTab,setActiveTab]=useState<'identity'|'bank'|'payroll'>('identity');
  const [selectedPeriod,setSelectedPeriod]=useState(String(employee.payrollSourcePeriod||''));
  const payroll=employeeIntakePayroll(employee,selectedPeriod);
  const [saving,setSaving]=useState(false);
  const [resetting,setResetting]=useState(false);
  const [message,setMessage]=useState('');
  const [portalPassword,setPortalPassword]=useState('');
  const [resetConfirm,setResetConfirm]=useState(false);
  const [discardConfirm,setDiscardConfirm]=useState(false);
  const closeRef=useRef<HTMLButtonElement>(null);
  const initialForm:EmployeeAdminForm={
    nik:employeeText(employee.nik),
    email:employeeText(employee.email),
    bankName:employeeText(employee.bankName),
    accountNo:employeeText(employee.accountNo),
    bpjsKesehatanNo:employeeText(employee.bpjsKesehatanNo),
    jamsostekNo:employeeText(employee.jamsostekNo),
  };
  const [form,setForm]=useState<EmployeeAdminForm>(initialForm);
  const dirty=editing && (form.bankName!==initialForm.bankName||form.accountNo!==initialForm.accountNo);
  const canEdit=canManageEmployees(actor);
  const canResetPortal=canManageEmployees(actor);

  function requestClose(){
    if(dirty){setDiscardConfirm(true);return;}
    onClose();
  }

  function cancelEditing(){
    if(dirty){setDiscardConfirm(true);return;}
    setEditing(false);
    setForm(initialForm);
  }

  function discardChanges(){
    setDiscardConfirm(false);
    setEditing(false);
    setForm(initialForm);
    onClose();
  }

  useEffect(()=>{
    closeRef.current?.focus();
    const onKeyDown=(event:KeyboardEvent)=>{
      if(event.key==='Escape'){
        if(discardConfirm) setDiscardConfirm(false);
        else if(resetConfirm&&!resetting) setResetConfirm(false);
        else requestClose();
      }
      if(event.key==='Tab'){
        const container=document.querySelector('.employee-drawer') as HTMLElement|null;
        if(!container) return;
        const focusable=[...container.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href]')];
        if(!focusable.length) return;
        const first=focusable[0],last=focusable[focusable.length-1];
        if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
        else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
      }
    };
    window.addEventListener('keydown',onKeyDown);
    return()=>window.removeEventListener('keydown',onKeyDown);
  },[onClose,resetConfirm,resetting,discardConfirm,dirty]);

  async function save(){
    setSaving(true);setMessage('');
    try{
      const response=await fetch('/api/employees',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({action:'UPDATE_ADMIN',id:employee.id,bankName:form.bankName,accountNo:form.accountNo}),
      });
      const result=await response.json().catch(()=>({}));
      if(!response.ok) throw new Error(result.error||result.message||`HTTP ${response.status}`);
      await onSaved();
    }catch(error){setMessage(error instanceof Error?error.message:'Gagal menyimpan');}
    finally{setSaving(false);}
  }

  async function resetPortalPassword(){
    if(!canResetPortal||resetting) return;
    setResetting(true);setMessage('');setPortalPassword('');
    try{
      const response=await fetch('/api/employee-credentials',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({action:'RESET',employeeId:employee.id}),
      });
      const result=await response.json().catch(()=>({}));
      if(!response.ok) throw new Error(result.error||result.message||`HTTP ${response.status}`);
      setPortalPassword(String(result.employee?.password||''));
      setResetConfirm(false);
    }catch(error){setMessage(error instanceof Error?error.message:'Gagal mereset password portal');}
    finally{setResetting(false);}
  }

  const groups=[
    {title:'Identitas & Penempatan',fields:[['NRK',employee.employeeCode||employee.id],['Nama Karyawan',employee.name],['Kode Client',employee.clientId],['Nama Client',employee.company],['Nama Cabang',employee.branchName||employee.branch],['Lokasi',employee.locationName||employee.region||employee.province],['Jabatan',employee.position],['Status Karyawan',employee.status]]},
    {title:'Rekening Pembayaran',fields:[['Nama Bank',employee.bankName],['No Rek',employeeMasked(employee.accountNo||employee.bankAccount,maskSensitiveData)]]},
  ];

  return(
    <div className="employee-drawer-backdrop" onMouseDown={(event)=>{if(event.target===event.currentTarget)requestClose();}}>
      <aside className="employee-drawer" role="dialog" aria-modal="true" aria-labelledby="employee-detail-title">
        <div className="employee-drawer-header">
          <div className="employee-avatar-lg">{employeeInitials(employee.name)}</div>
          <div><span>PROFIL KARYAWAN</span><h2 id="employee-detail-title">{employee.name}</h2><p>{employee.position||'Posisi belum diisi'} · {employee.company||'-'}</p></div>
          <button ref={closeRef} type="button" onClick={requestClose} aria-label="Tutup detail">✕</button>
        </div>

        <div className="employee-drawer-body">
          <div role="tablist" aria-label="Detail Data Intake" style={{display:'flex',gap:8,flexWrap:'wrap',paddingBottom:10,borderBottom:'1px solid var(--border)'}}>
            {([['identity','Identitas & Penempatan'],['bank','Rekening Pembayaran'],['payroll','Payroll per Periode']] as const).map(([id,label])=><button key={id} type="button" role="tab" aria-selected={activeTab===id} className={activeTab===id?'btn btn-primary':'btn'} onClick={()=>{setActiveTab(id);setEditing(false);}}>{label}</button>)}
          </div>

          {(activeTab==='bank'&&canEdit)||canResetPortal?<div className="employee-drawer-actions">
            {canResetPortal?<button className="btn" type="button" disabled={resetting} onClick={()=>setResetConfirm(true)}>{resetting?'Menerbitkan…':'Reset password portal'}</button>:null}
            {canEdit&&activeTab==='bank'?<button className="btn" type="button" onClick={()=>editing?cancelEditing():setEditing(true)}>{editing?'Batal edit':'Edit rekening'}</button>:null}
          </div>:null}

          {discardConfirm?<div className="employee-inline-confirm employee-discard-confirm" role="alertdialog" aria-modal="true">
            <strong>Perubahan belum disimpan</strong>
            <span>Keluar sekarang akan membuang perubahan administrasi yang belum disimpan.</span>
            <div><button type="button" className="btn" onClick={()=>setDiscardConfirm(false)}>Lanjut edit</button><button type="button" className="btn btn-danger" onClick={discardChanges}>Buang perubahan</button></div>
          </div>:null}

          {resetConfirm?<div className="employee-inline-confirm" role="alertdialog" aria-modal="true">
            <strong>Terbitkan ulang password portal?</strong>
            <span>Password lama akan langsung tidak berlaku. Password baru hanya ditampilkan sekali.</span>
            <div><button type="button" className="btn" disabled={resetting} onClick={()=>setResetConfirm(false)}>Batal</button><button type="button" className="btn btn-primary" disabled={resetting} onClick={()=>void resetPortalPassword()}>{resetting?'Menerbitkan…':'Reset password'}</button></div>
          </div>:null}

          {portalPassword?<div className="account-credential employee-portal-password" role="status"><div><strong>Password portal — hanya sekali</strong><span>{employee.employeeCode||employee.id}</span></div><code>{portalPassword}</code><button type="button" className="btn" onClick={()=>void navigator.clipboard.writeText(portalPassword)}>Salin</button></div>:null}

          {editing&&activeTab==='bank'?<div className="employee-edit-shell">
            <div className="employee-edit-heading">
              <div><span>ADMINISTRASI</span><strong>Lengkapi data utama</strong></div>
              {dirty?<small>Perubahan belum disimpan</small>:<small>Belum ada perubahan</small>}
            </div>
            <div className="employee-admin-form">
              {(Object.entries({bankName:'Nama bank',accountNo:'Nomor rekening'}) as Array<[keyof EmployeeAdminForm,string]>).map(([key,label])=><label key={key}>{label}<input value={form[key]} onChange={(event)=>setForm({...form,[key]:event.target.value})}/></label>)}
              {message?<p className="employee-form-error">{message}</p>:null}
            </div>
            <div className="employee-edit-footer">
              <button type="button" className="btn" disabled={saving} onClick={cancelEditing}>Batal</button>
              <button className="btn btn-primary" type="button" disabled={saving||!dirty} onClick={()=>void save()}>{saving?'Menyimpan…':'Simpan perubahan'}</button>
            </div>
          </div>:null}

          <div role="tabpanel" className="employee-detail-groups">
            {activeTab==='identity'||activeTab==='bank'?groups.filter(group=>activeTab==='identity'?group.title==='Identitas & Penempatan':group.title==='Rekening Pembayaran').map(group=><section key={group.title}><h3>{group.title}</h3><dl>{group.fields.map(([label,value])=><div key={String(label)}><dt>{label}</dt><dd>{employeeText(value)||'-'}</dd></div>)}</dl></section>):null}
            {activeTab==='payroll'?<section aria-label="Rincian payroll Data Intake">
              <h3>Payroll per Periode</h3>
              <label>Periode sumber data <input type="month" value={selectedPeriod} onChange={event=>setSelectedPeriod(event.target.value)}/></label>
              <p>Data payroll hanya ditampilkan untuk periode intake yang cocok. Data dari periode lain tidak digunakan.</p>
              {payroll.status==='NO_PERIOD_DATA'||payroll.status==='COMPONENTS_UNAVAILABLE'?<p role="status">Data payroll untuk periode ini belum tersedia atau rincian komponen belum lengkap.</p>:<>
                <p role="status">Pemeriksaan total: {payroll.status==='BALANCED'?'Sesuai':'Perlu rekonsiliasi'}</p>
                <h4>Pendapatan</h4><dl>{payroll.earnings.map(row=><div key={row.label}><dt>{row.label}</dt><dd>{row.amount===null?'—':formatIDR(row.amount)}</dd></div>)}</dl>
                <h4>Potongan</h4><dl>{payroll.deductions.map(row=><div key={row.label}><dt>{row.label}</dt><dd>{row.amount===null?'—':formatIDR(row.amount)}</dd></div>)}</dl>
                {payroll.totals?<dl>{([['Gross',payroll.totals.gross],['Deduct',payroll.totals.deduct],['Netto',payroll.totals.netto]] as const).map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value===null?'—':formatIDR(value)}</dd></div>)}</dl>:null}
              </>}
            </section>:null}
          </div>
        </div>
      </aside>
    </div>
  );
}
