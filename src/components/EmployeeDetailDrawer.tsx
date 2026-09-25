'use client';

import { useEffect, useRef, useState } from 'react';
import { formatIDR } from '@/lib/format';
import {
  canManageEmployees,
  employeeDateLabel,
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
  const dirty=editing && JSON.stringify(form)!==JSON.stringify(initialForm);
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
        body:JSON.stringify({action:'UPDATE_ADMIN',id:employee.id,...form}),
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
    {title:'Pekerjaan',fields:[['Kode karyawan',employee.employeeCode||employee.id],['NRK',employee.id],['Klien',employee.company],['Project',employee.project],['Posisi',employee.position],['Status',employee.status],['Tipe kerja',employee.employmentType]]},
    {title:'Kontrak',fields:[['Tanggal bergabung',employeeDateLabel(employee.joinDate)],['Mulai kontrak',employeeDateLabel(employee.contractStart)],['Akhir kontrak',employeeDateLabel(employee.contractEnd)],['Tanggal resign',employeeDateLabel(employee.resignDate)],['Alasan resign',employee.resignReason]]},
    {title:'Administrasi',fields:[['NIK',employeeMasked(employee.nik,maskSensitiveData)],['NPWP',employeeMasked(employee.npwp,maskSensitiveData)],['Rekening',employeeMasked(employee.accountNo,maskSensitiveData)],['Bank',employee.bankName],['BPJS Kesehatan',employeeMasked(employee.bpjsKesehatanNo,maskSensitiveData)],['BPJS TK',employeeMasked(employee.jamsostekNo,maskSensitiveData)]]},
    {title:'Kontak',fields:[['Email',employee.email],['Telepon',employee.phone||employee.mobile],['Alamat',employee.address],['Wilayah',employee.region||employee.province]]},
  ];

  return(
    <div className="employee-drawer-backdrop" onMouseDown={(event)=>{if(event.target===event.currentTarget)requestClose();}}>
      <aside className="employee-drawer" role="dialog" aria-modal="true" aria-labelledby="employee-detail-title">
        <div className="employee-drawer-header">
          <div className="employee-avatar-lg">{employeeInitials(employee.name)}</div>
          <div><span>PROFIL KARYAWAN</span><h2 id="employee-detail-title">{employee.name}</h2><p>{employee.position||'Posisi belum diisi'} · {employee.company||'-'}</p></div>
          <button ref={closeRef} type="button" onClick={requestClose} aria-label="Tutup detail">✕</button>
        </div>
        {canEdit||canResetPortal?<div className="employee-drawer-actions">
          {canResetPortal?<button className="btn" type="button" disabled={resetting} onClick={()=>setResetConfirm(true)}>{resetting?'Menerbitkan…':'Reset password portal'}</button>:null}
          {canEdit?<button className="btn" type="button" onClick={()=>editing?cancelEditing():setEditing(true)}>{editing?'Batal edit':'Edit data kurang'}</button>:null}
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

        {editing?<div className="card employee-admin-form">
          {(Object.entries({nik:'NIK (16 digit)',email:'Email',bankName:'Nama bank',accountNo:'Nomor rekening',bpjsKesehatanNo:'BPJS Kesehatan',jamsostekNo:'BPJS Ketenagakerjaan'}) as Array<[keyof EmployeeAdminForm,string]>).map(([key,label])=><label key={key}>{label}<input value={form[key]} onChange={(event)=>setForm({...form,[key]:event.target.value})}/></label>)}
          {message?<p className="employee-form-error">{message}</p>:null}
          <button className="btn btn-primary" type="button" disabled={saving} onClick={()=>void save()}>{saving?'Menyimpan…':'Simpan perubahan'}</button>
        </div>:null}

        <div className="employee-drawer-pay"><span>Gaji pokok</span><strong>{formatIDR(Number(employee.salaryGross||0))}</strong><em className={`status-pill status-${employeeStatusTone(employee.status)}`}>{employee.status||'Belum diisi'}</em></div>
        <div className="employee-detail-groups">{groups.map((group)=><section key={group.title}><h3>{group.title}</h3><dl>{group.fields.map(([label,value])=><div key={String(label)}><dt>{label}</dt><dd>{employeeText(value)||'-'}</dd></div>)}</dl></section>)}</div>
      </aside>
    </div>
  );
}
