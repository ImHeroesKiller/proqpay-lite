'use client';

import { useId, useState } from 'react';
import { ModalShell } from '@/components/ui/UnifiedSystem';
import { parseApiResponse } from '@/lib/api-client';
import { formatIDR } from '@/lib/format';
import {
  canManageEmployees,
  employeeIntakePayroll,
  employeeInitials,
  employeeEssStatus,
  employeeEssLabel,
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
  onEssGenerated,
}: {
  employee: EmployeeRecord;
  actor: EmployeeActor | null;
  maskSensitiveData: boolean;
  onClose: () => void;
  onSaved: () => Promise<void>;
  onEssGenerated?: () => void;
}) {
  const tabId=useId();
  const tabs=[['identity','Identitas & Penempatan'],['bank','Rekening Pembayaran'],['payroll','Payroll per Periode']] as const;
  const [editing,setEditing]=useState(false);
  const [activeTab,setActiveTab]=useState<'identity'|'bank'|'payroll'>('identity');
  const [selectedPeriod,setSelectedPeriod]=useState(String(employee.payrollSourcePeriod||''));
  const payroll=employeeIntakePayroll(employee,selectedPeriod);
  const [saving,setSaving]=useState(false);
  const [resetting,setResetting]=useState(false);
  const [message,setMessage]=useState('');
  const [portalPassword,setPortalPassword]=useState('');
  const [essState,setEssState]=useState(()=>employeeEssStatus(employee));
  const [resetConfirm,setResetConfirm]=useState(false);
  const [discardConfirm,setDiscardConfirm]=useState(false);
  const [discardTarget,setDiscardTarget]=useState<'close'|'cancel'|'identity'|'bank'|'payroll'>('close');
  const [copyMessage,setCopyMessage]=useState('');
  const initialForm:EmployeeAdminForm={
    bankName:employeeText(employee.bankName),
    accountNo:employeeText(employee.accountNo),
  };
  const [form,setForm]=useState<EmployeeAdminForm>(initialForm);
  const dirty=editing && (form.bankName!==initialForm.bankName||form.accountNo!==initialForm.accountNo);
  const canEdit=canManageEmployees(actor);
  const canResetPortal=canManageEmployees(actor);

  function requestClose(){
    if(saving||resetting)return;
    if(dirty){setDiscardTarget('close');setDiscardConfirm(true);return;}
    onClose();
  }

  function cancelEditing(){
    if(saving||resetting)return;
    if(dirty){setDiscardTarget('cancel');setDiscardConfirm(true);return;}
    setEditing(false);setForm(initialForm);setMessage('');
  }

  function switchTab(value:string){
    if(saving||resetting)return false;
    const tab=value as typeof activeTab;
    if(tab===activeTab)return true;
    if(dirty){setDiscardTarget(tab);setDiscardConfirm(true);return false;}
    setEditing(false);setForm(initialForm);setMessage('');setActiveTab(tab);return true;
  }

  function discardChanges(){
    setDiscardConfirm(false);setEditing(false);setForm(initialForm);setMessage('');
    // Let the nested confirmation restore its focus/scroll lock before closing the profile.
    if(discardTarget==='close')requestAnimationFrame(onClose);
    else if(discardTarget!=='cancel')setActiveTab(discardTarget);
  }

  async function copyPassword(){
    try{await navigator.clipboard.writeText(portalPassword);setCopyMessage('Password berhasil disalin.');}
    catch{setCopyMessage('Tidak dapat menyalin. Silakan salin password secara manual.');}
  }

  async function save(){
    if(!canEdit||saving||resetting||!dirty)return;
    setSaving(true);setMessage('');
    try{
      const response=await fetch('/api/employees',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({action:'UPDATE_ADMIN',id:employee.id,bankName:form.bankName,accountNo:form.accountNo}),
      });
      await parseApiResponse(response);
      await onSaved();
    }catch(error){setMessage(error instanceof Error?error.message:'Gagal menyimpan');}
    finally{setSaving(false);}
  }

  async function resetPortalPassword(){
    if(!canResetPortal||resetting||saving) return;
    setResetting(true);setMessage('');setPortalPassword('');setCopyMessage('');
    try{
      const response=await fetch('/api/employee-credentials',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({action:'RESET',employeeId:employee.id}),
      });
      const result=await parseApiResponse<{employee?:{password?:string}}>(response);
      if(!result.employee?.password)throw new Error('Password ESS tidak diterima. Coba generate kembali.');
      setPortalPassword(result.employee.password);
      setEssState('PASSWORD_CHANGE_REQUIRED');
      onEssGenerated?.();
      setResetConfirm(false);
    }catch(error){setMessage(error instanceof Error?error.message:'Gagal mereset password portal');}
    finally{setResetting(false);}
  }

  const groups=[
    {title:'Identitas & Penempatan',fields:[['NRK',employee.employeeCode||employee.id],['Nama Karyawan',employee.name],['Kode Client',employee.clientId],['Nama Client',employee.company],['Nama Cabang',employee.branchName||employee.branch],['Lokasi',employee.locationName||employee.region||employee.province],['Jabatan',employee.position],['Status Karyawan',employee.status]]},
    {title:'Rekening Pembayaran',fields:[['Nama Bank',employee.bankName],['No Rek',employeeMasked(employee.accountNo||employee.bankAccount,maskSensitiveData)]]},
  ];

  return(
    <ModalShell title="Profil Karyawan" onClose={requestClose} className="employee-profile-modal">
        <header className="employee-profile-summary">
          <div className="employee-avatar-lg" aria-hidden="true">{employeeInitials(employee.name)}</div>
          <div><h3 id="employee-detail-title">{employee.name}</h3><p>{employee.position||'Posisi belum diisi'} · {employee.company||'-'}</p><small>{employee.employeeCode||employee.id}</small></div>
          <span className={`status-pill status-${employeeStatusTone(employee.status)}`}>{employee.status||'Belum diisi'}</span>
        </header>
        <div className="employee-profile-body" aria-busy={saving||resetting}>
          <div className="ui-tabs" role="tablist" aria-label="Detail Data Intake">
            {tabs.map(([id,label],index)=><button key={id} id={`${tabId}-${id}`} aria-controls={`${tabId}-panel`} type="button" role="tab" aria-selected={activeTab===id} tabIndex={activeTab===id?0:-1} className={activeTab===id?'active':''} onClick={()=>switchTab(id)} onKeyDown={event=>{
              let next=-1;
              if(event.key==='ArrowRight')next=(index+1)%tabs.length;
              if(event.key==='ArrowLeft')next=(index+tabs.length-1)%tabs.length;
              if(event.key==='Home')next=0;
              if(event.key==='End')next=tabs.length-1;
              if(next<0)return;
              event.preventDefault();
              if(switchTab(tabs[next][0]))document.getElementById(`${tabId}-${tabs[next][0]}`)?.focus();
            }}>{label}</button>)}
          </div>
          {message&&!resetConfirm?<p className="employee-profile-error" role="alert">{message}</p>:null}
          {activeTab==='bank'&&canEdit?<div className="employee-drawer-actions">
            {canEdit&&activeTab==='bank'?<button className="btn" type="button" disabled={saving||resetting} onClick={()=>editing?cancelEditing():setEditing(true)}>{editing?'Batal edit':'Edit rekening'}</button>:null}
          </div>:null}

          {discardConfirm?<ModalShell title="Perubahan belum disimpan" onClose={()=>setDiscardConfirm(false)} className="employee-profile-confirm">
            <p>Buang perubahan rekening yang belum disimpan untuk melanjutkan?</p>
            <div><button type="button" className="btn" onClick={()=>setDiscardConfirm(false)}>Lanjut edit</button><button type="button" className="btn btn-danger" onClick={discardChanges}>Buang perubahan</button></div>
          </ModalShell>:null}

          {resetConfirm?<ModalShell title="Generate password ESS?" onClose={()=>{if(!resetting)setResetConfirm(false);}} className="employee-profile-confirm">
            <p>Password sementara akan dibuat untuk login awal atau reset ESS karyawan ini. Jika sudah ada, password lama dan sesi ESS akan dinonaktifkan. Karyawan wajib menggantinya saat login.</p>
            {message?<p className="employee-profile-error" role="alert">{message}</p>:null}
            <div><button type="button" className="btn" disabled={resetting} onClick={()=>setResetConfirm(false)}>Batal</button><button type="button" className="btn btn-primary" disabled={resetting} onClick={()=>void resetPortalPassword()}>{resetting?'Menerbitkan…':'Ya, generate password'}</button></div>
          </ModalShell>:null}

          {canResetPortal?<section className="employee-ess-access" aria-label="Akses ESS karyawan">
            <div><h3>Akses ESS</h3><span role="status">Status ESS: {employeeEssLabel(essState)}</span></div>
            <button className="btn" type="button" disabled={saving||resetting||dirty||essState==='INACTIVE'} onClick={()=>{setMessage('');setResetConfirm(true);}}>{resetting?'Menerbitkan…':'Generate password ESS'}</button>
            <label>Password ESS<input type="text" value={portalPassword} readOnly autoComplete="off" spellCheck={false} placeholder="Belum ada password baru pada sesi ini"/></label>
            {portalPassword?<button type="button" className="btn" onClick={()=>void copyPassword()}>Salin password</button>:null}
            <p>{essState==='INACTIVE'?'Akses ESS karyawan nonaktif tidak dapat diterbitkan.':'Untuk login awal dan reset. Password hanya tampil setelah generate sampai detail ditutup; password tersimpan tidak dapat dibaca kembali.'}</p>
          </section>:null}

          {copyMessage?<p role="status">{copyMessage}</p>:null}
          {editing&&activeTab==='bank'?<div className="employee-edit-shell">
            <div className="employee-edit-heading">
              <div><span>ADMINISTRASI</span><strong>Lengkapi data utama</strong></div>
              {dirty?<small>Perubahan belum disimpan</small>:<small>Belum ada perubahan</small>}
            </div>
            <div className="employee-admin-form">
              {(Object.entries({bankName:'Nama bank',accountNo:'Nomor rekening'}) as Array<[keyof EmployeeAdminForm,string]>).map(([key,label])=><label key={key}>{label}<input value={form[key]} disabled={saving} autoComplete="off" onChange={(event)=>setForm({...form,[key]:event.target.value})}/></label>)}
            </div>
            <div className="employee-edit-footer">
              <button type="button" className="btn" disabled={saving} onClick={cancelEditing}>Batal</button>
              <button className="btn btn-primary" type="button" disabled={saving||!dirty} onClick={()=>void save()}>{saving?'Menyimpan…':'Simpan perubahan'}</button>
            </div>
          </div>:null}

          <div role="tabpanel" id={`${tabId}-panel`} aria-labelledby={`${tabId}-${activeTab}`} aria-label={activeTab==='identity'?'Identitas & Penempatan':activeTab==='bank'?'Rekening Pembayaran':'Payroll per Periode'} className="employee-profile-groups">
            {activeTab==='identity'||activeTab==='bank'?groups.filter(group=>activeTab==='identity'?group.title==='Identitas & Penempatan':group.title==='Rekening Pembayaran').map(group=><section key={group.title}><h3>{group.title}</h3><dl>{group.fields.map(([label,value])=><div key={String(label)}><dt>{String(label)}</dt><dd>{employeeText(value)||'-'}</dd></div>)}</dl></section>):null}
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
        <footer className="employee-profile-footer"><span>{dirty?'Ada perubahan rekening yang belum disimpan.':`Profil ${employee.employeeCode||employee.id}`}</span><button type="button" className="btn" disabled={saving||resetting} onClick={requestClose}>Tutup profil</button></footer>
    </ModalShell>
  );
}
