'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Image from 'next/image';
import { bindE2PaySubAccountCredential, composeE2PayRegistrationToken, confirmE2PaySubAccount, getE2PaySubAccounts, registerE2PaySubAccount, syncE2PaySubAccountBalance, type E2PaySubAccount } from '@/lib/e2pay-api';
import {
  DataTableState as UiDataTableState,
  FilterBar as UiFilterBar,
  MetricCard as UiMetricCard,
  MetricGrid as UiMetricGrid,
  Notice as UiNotice,
  Pagination as UiPagination,
  SectionCard as UiSectionCard,
  StatusBadge as UiStatusBadge,
  Tabs as UiTabs,
} from '@/components/ui/UnifiedSystem';

type Actor = { role: string; permissions: string[] };
type Client = {
  id: string; code: string; name: string; website?: string; industry?: string; contact_name?: string;
  contact_email?: string; contact_phone?: string; logo_url?: string; status?: string;
  npwp?: string; nitku?: string; billing_address?: string; billing_email?: string; payment_terms_days?: number;
  tax_status?: string; purchase_order?: string; billing_method?: string; billing_rate?: number; billing_admin_fee?: number; billing_tax_rate?: number;
  employee_count?: number; project_count?: number; assigned_user_count?: number;
};
type Project = {
  id: string; code: string; name: string; client_id: string; client_name?: string; description?: string;
  service_type?: string; status?: string; start_date?: string; end_date?: string; assigned_user_count?: number;
  tier?: string; contract_reference?: string; tier_effective_from?: string; tier_effective_until?: string;
};

const EMPTY_FORM = {
  name: '', clientId: '', status: 'ACTIVE', startDate: '', endDate: '', website: '', industry: '',
  contactName: '', contactEmail: '', contactPhone: '', description: '', serviceType: 'Payroll Management',
  npwp:'',nitku:'',billingAddress:'',billingEmail:'',paymentTermsDays:'30',taxStatus:'NON_PKP',purchaseOrder:'',billingMethod:'PER_EMPLOYEE',billingRate:'0',billingAdminFee:'0',billingTaxRate:'0',tier:'TIER_1_PAYMENT_PROCESSING',tierEffectiveFrom:new Date().toISOString().slice(0,10),tierEffectiveUntil:'',contractReference:'',
};

function automaticCode(name: string, fallback: string) {
  const words = name.toUpperCase().replace(/\b(PT|CV|TBK|PERSERO)\b/g, ' ')
    .replace(/[^A-Z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  const compact = words.length > 3 ? words.map((word) => word[0]).join('') : words.join('-');
  return (compact || fallback).slice(0, 26);
}

function ClientIcon({ client }: { client: Client }) {
  const [failed, setFailed] = useState(false);
  const initials = client.name.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]).join('').toUpperCase();
  return client.logo_url && !failed
    ? <Image unoptimized width={40} height={40} className="directory-icon" src={`/api/client-logo?id=${encodeURIComponent(client.id)}`} alt="" onError={() => setFailed(true)} />
    : <span className="directory-icon directory-icon-fallback" aria-hidden="true">{initials || 'CL'}</span>;
}

export default function DirectoryManager({ actor, onChanged, existingClients = [], existingProjects = [] }: {
  actor: Actor | null;
  onChanged: () => Promise<void>;
  existingClients?: Array<{ id: string; name: string; code?: string }>;
  existingProjects?: Array<{ id: string; name: string; company?: string; status?: string }>;
}) {
  const [clients, setClients] = useState<Client[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [mode, setMode] = useState<'client' | 'project' | null>(null);
  const [editingId, setEditingId] = useState('');
  const [form, setForm] = useState(EMPTY_FORM);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [messageTone,setMessageTone] = useState<'info'|'success'|'error'>('info');
  const [query,setQuery] = useState('');
  const [statusFilter,setStatusFilter] = useState('ALL');
  const [projectClientFilter,setProjectClientFilter] = useState('ALL');
  const [clientPage,setClientPage] = useState(1);
  const [projectPage,setProjectPage] = useState(1);
  const [activeDirectoryTab,setActiveDirectoryTab] = useState<'clients'|'projects'>('clients');
  const [projectsTruncated,setProjectsTruncated] = useState(false);
  const [originalProjectClientId,setOriginalProjectClientId] = useState('');
  const [detail,setDetail] = useState<{type:'client'|'project';item:Client|Project}|null>(null);
  const [e2payAccounts,setE2PayAccounts]=useState<E2PaySubAccount[]>([]);
  const [e2payPhone,setE2PayPhone]=useState('');
  const [e2payEmail,setE2PayEmail]=useState('');
  const [e2payBusy,setE2PayBusy]=useState(false);
  const [e2payChallenge,setE2PayChallenge]=useState<{id:string;username:string;tokenPrefix:string;merchantRegistrationId?:string|null;accountGroupId?:string|null}|null>(null);
  const [e2payConfirmPassword,setE2PayConfirmPassword]=useState('');
  const [e2payOtp,setE2PayOtp]=useState('');
  const [e2payMerchantUsername,setE2PayMerchantUsername]=useState('');
  const [e2payMerchantPassword,setE2PayMerchantPassword]=useState('');
  const dialogRef = useRef<HTMLDivElement>(null);
  const detailDialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement|null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/client-projects', { headers: { Accept: 'application/json' } });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      setClients(data.clients || []);
      setProjects(data.projects || []);
      setProjectsTruncated(Boolean(data.meta?.projectsTruncated));
      setMessageTone('info');
    } catch (error) {
      setMessageTone('error');
      setMessage(error instanceof Error ? error.message : 'Gagal memuat master data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  const loadE2Pay=useCallback(async()=>{try{const result=await getE2PaySubAccounts('UAT');setE2PayAccounts(result.accounts);}catch{/* payment integration may be unavailable while master data remains usable */}},[]);
  useEffect(()=>{void loadE2Pay();},[loadE2Pay]);

  async function submit() {
    if (!mode) return;
    setSaving(true);
    setMessage('');
    try {
      const payload = mode === 'client'
        ? {
          action: editingId ? 'UPDATE_CLIENT' : 'CREATE_CLIENT', id: editingId || undefined, name: form.name,
          website: form.website || undefined, industry: form.industry || undefined, contactName: form.contactName || undefined,
          contactEmail: form.contactEmail || undefined, contactPhone: form.contactPhone || undefined, status: form.status,
          npwp:form.npwp||undefined,nitku:form.nitku||undefined,billingAddress:form.billingAddress||undefined,billingEmail:form.billingEmail||undefined,paymentTermsDays:Number(form.paymentTermsDays),taxStatus:form.taxStatus,purchaseOrder:form.purchaseOrder||undefined,billingMethod:form.billingMethod,billingRate:Number(form.billingRate),billingAdminFee:Number(form.billingAdminFee),billingTaxRate:form.taxStatus==='PKP'?Number(form.billingTaxRate):0,
        }
        : {
          action: editingId ? 'UPDATE_PROJECT' : 'CREATE_PROJECT', id: editingId || undefined, name: form.name,
          clientId: form.clientId, description: form.description || undefined, serviceType: form.serviceType || undefined,
          status: form.status, startDate: form.startDate || undefined, endDate: form.endDate || undefined,
          tier:form.tier,tierEffectiveFrom:form.tierEffectiveFrom,tierEffectiveUntil:form.tierEffectiveUntil||undefined,contractReference:form.contractReference||undefined,
        };
      const response = await fetch('/api/client-projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      setMessageTone('success');
      setMessage(`${mode === 'client' ? 'Klien' : 'Project'} berhasil ${editingId ? 'diperbarui' : 'ditambahkan'}.`);
      setMode(null);
      setEditingId('');
      setForm(EMPTY_FORM);
      await Promise.all([load(), onChanged()]);
    } catch (error) {
      setMessageTone('error');
      setMessage(error instanceof Error ? error.message : 'Gagal menyimpan');
    } finally {
      setSaving(false);
    }
  }

  const canCreateClient = actor?.permissions.includes('client:write') || false;
  const canManageE2Pay = actor?.role==='SUPER_ADMIN'||actor?.role==='PAYROLL_PROCESSOR';
  async function registerClientE2Pay(client:Client,project?:Project){
    if(!e2payPhone.trim()) return;
    setE2PayBusy(true);setMessage('');
    try{
      const result=await registerE2PaySubAccount({clientId:client.id,projectId:project?.id,environment:'UAT',phone:e2payPhone.trim(),email:e2payEmail.trim()||client.contact_email});
      if(result.registration.state==='PENDING_CONFIRMATION'){
        if(!result.registration.username||!result.registration.tokenPrefix) throw new Error('E2Pay tidak mengembalikan challenge konfirmasi yang lengkap.');
        setE2PayChallenge({
          id:result.account.id,
          username:result.registration.username,
          tokenPrefix:result.registration.tokenPrefix,
          merchantRegistrationId:result.registration.merchantRegistrationId,
          accountGroupId:result.registration.accountGroupId,
        });
        setE2PayConfirmPassword('');
        setE2PayOtp('');
        setMessageTone('success');
        setMessage(`Registration request ${client.name} diterima. Pairing ke ${project?'project '+project.name:'client '+client.name} sudah dibuat sebagai DRAFT; selesaikan OTP untuk aktivasi.`);
      }else{
        setE2PayChallenge(null);
        setMessageTone('success');
        setMessage(project?`Sub-merchant E2Pay aktif dan ter-pair ke project ${project.name}.`:`Sub-merchant E2Pay aktif dan ter-pair ke client ${client.name}.`);
      }
      setE2PayPhone('');setE2PayEmail('');await loadE2Pay();
    }catch(error){setMessageTone('error');setMessage(error instanceof Error?error.message:'Registrasi E2Pay gagal');}
    finally{setE2PayBusy(false);}
  }

  async function confirmClientE2Pay(account:E2PaySubAccount){
    if(!e2payChallenge||e2payChallenge.id!==account.id) return;
    if(!e2payConfirmPassword||!e2payOtp.trim()) return;
    setE2PayBusy(true);setMessage('');
    try{
      await confirmE2PaySubAccount({
        id:account.id,
        username:e2payChallenge.username,
        password:e2payConfirmPassword,
        token:e2payOtp.trim().toUpperCase().startsWith(e2payChallenge.tokenPrefix.toUpperCase()) ? e2payOtp.trim() : composeE2PayRegistrationToken(e2payChallenge.tokenPrefix,e2payOtp),
      });
      setE2PayChallenge(null);
      setE2PayConfirmPassword('');
      setE2PayOtp('');
      setMessageTone('success');
      setMessage(`Sub-merchant E2Pay berhasil dikonfirmasi dan pairing ${account.projectId?'project override':'client'} sudah ACTIVE.`);
      await loadE2Pay();
    }catch(error){setMessageTone('error');setMessage(error instanceof Error?error.message:'Konfirmasi E2Pay gagal');}
    finally{setE2PayBusy(false);}
  }

  async function bindClientE2PayCredential(account:E2PaySubAccount){
    if(!e2payMerchantUsername.trim()||!e2payMerchantPassword) return;
    setE2PayBusy(true);setMessage('');
    try{
      await bindE2PaySubAccountCredential({
        id:account.id,
        username:e2payMerchantUsername.trim(),
        password:e2payMerchantPassword,
      });
      setE2PayMerchantUsername('');
      setE2PayMerchantPassword('');
      setMessageTone('success');
      setMessage('Credential merchant sub-client berhasil divalidasi, dienkripsi, dan saldo awal tersinkron.');
      await loadE2Pay();
    }catch(error){setMessageTone('error');setMessage(error instanceof Error?error.message:'Validasi credential sub-client gagal');}
    finally{setE2PayBusy(false);}
  }

  async function syncClientE2PayBalance(account:E2PaySubAccount){
    setE2PayBusy(true);setMessage('');
    try{
      const result=await syncE2PaySubAccountBalance(account.id);
      setMessageTone('success');
      setMessage(`Saldo E2Pay sub-client tersinkron: Rp ${Number(result.account.availableBalance||0).toLocaleString('id-ID')}.`);
      await loadE2Pay();
    }catch(error){setMessageTone('error');setMessage(error instanceof Error?error.message:'Sync balance E2Pay gagal');}
    finally{setE2PayBusy(false);}
  }

  function renderE2PayMerchantCredential(account:E2PaySubAccount){
    if(account.status!=='ACTIVE'||account.provisioningState!=='PROVISIONED') return null;
    if(account.merchantCredential?.ready){
      return <div className="directory-inline-actions">
        <UiNotice tone="info" title="Merchant credential scoped aktif">Credential sub-client tersimpan terenkripsi dan digunakan khusus untuk account {account.providerSubAccountIdMasked||'ini'}.</UiNotice>
        <button type="button" className="btn" disabled={e2payBusy} onClick={()=>void syncClientE2PayBalance(account)}>{e2payBusy?'Menyinkronkan…':'Sync Balance'}</button>
      </div>;
    }
    if(!canManageE2Pay) return <UiNotice tone="warning" title="Merchant credential belum terhubung">Hubungi Super Admin atau Payroll Processor untuk memvalidasi merchant login sub-client sebelum payment.</UiNotice>;
    return <><UiNotice tone="warning" title="Hubungkan merchant login sub-client">Sub-client sudah ACTIVE tetapi merchant credential scoped belum tersimpan. Masukkan credential merchant yang dibuat saat aktivasi; ProQPay akan memvalidasi account dan menyimpan hash credential secara terenkripsi.</UiNotice>
      <div className="directory-form-grid">
        <label>Username E2Pay<input value={e2payMerchantUsername} autoComplete="username" onChange={(event)=>setE2PayMerchantUsername(event.target.value)} /></label>
        <label>Password merchant<input type="password" autoComplete="current-password" value={e2payMerchantPassword} onChange={(event)=>setE2PayMerchantPassword(event.target.value)} /></label>
      </div>
      <button type="button" className="btn btn-primary" disabled={e2payBusy||!e2payMerchantUsername.trim()||!e2payMerchantPassword} onClick={()=>void bindClientE2PayCredential(account)}>{e2payBusy?'Memvalidasi…':'Validasi & Simpan Credential'}</button>
    </>;
  }
  function renderE2PayRegistrationForm(client:Client,project?:Project,label?:string){
    if(!canManageE2Pay) return null;
    return <><UiNotice tone="info" title="Registrasi sub-merchant E2Pay">Host credential MSG digunakan untuk registrasi. Setelah request diterima, ProQPay otomatis membuat pairing ke {project?'project ini':'client ini'}; aktivasi final dilakukan setelah OTP.</UiNotice><div className="directory-form-grid">
      <label>Nomor HP {project?'override':'sub-client'}<input type="tel" value={e2payPhone} maxLength={40} placeholder="+62..." onChange={(event)=>setE2PayPhone(event.target.value)}/></label>
      <label>Email {project?'override':'sub-client'}<input type="email" value={e2payEmail} maxLength={254} placeholder={client.contact_email||'ops@client.com'} onChange={(event)=>setE2PayEmail(event.target.value)}/></label>
    </div><button type="button" className="btn btn-primary" disabled={e2payBusy||!e2payPhone.trim()} onClick={()=>void registerClientE2Pay(client,project)}>{e2payBusy?'Mendaftarkan…':label||(project?'Register Project Override':'Register E2Pay Sub-Client')}</button></>;
  }

  function renderE2PayPendingConfirmation(account:E2PaySubAccount,client:Client,project?:Project){
    if(!canManageE2Pay) return <UiNotice tone="warning" title="Menunggu konfirmasi E2Pay">Registration request sudah diterima. Hubungi Super Admin atau Payroll Processor untuk menyelesaikan aktivasi.</UiNotice>;
    const challenge=e2payChallenge?.id===account.id?e2payChallenge:null;
    if(!challenge) return <><UiNotice tone="warning" title="Challenge konfirmasi tidak tersedia">Registration request sebelumnya masih pending, tetapi challenge hanya tersedia pada sesi registrasi aktif. Masukkan kembali nomor HP untuk meminta challenge baru.</UiNotice>{renderE2PayRegistrationForm(client,project,'Kirim ulang registration request')}</>;
    return <><UiNotice tone="warning" title="Selesaikan konfirmasi E2Pay">OTP dikirim ke username <strong>{challenge.username}</strong>. Token konfirmasi menggunakan prefix <strong>{challenge.tokenPrefix}</strong> + OTP.</UiNotice>
      <div className="directory-form-grid">
        <label>Username E2Pay<input value={challenge.username} readOnly /></label>
        <label>Token prefix<input value={challenge.tokenPrefix} readOnly /></label>
        <label>Password baru<input type="password" autoComplete="new-password" value={e2payConfirmPassword} minLength={6} maxLength={12} placeholder="6-12 karakter" onChange={(event)=>setE2PayConfirmPassword(event.target.value)}/></label>
        <label>OTP<input inputMode="numeric" autoComplete="one-time-code" value={e2payOtp} maxLength={20} placeholder="OTP dari E2Pay" onChange={(event)=>setE2PayOtp(event.target.value)}/></label>
      </div>
      <p className="directory-hint">Password wajib memiliki huruf besar, huruf kecil, angka, dan karakter khusus. Password plaintext tidak disimpan; setelah merchant login tervalidasi, ProQPay menyimpan credential hash secara terenkripsi untuk sub-client tersebut.</p>
      <button type="button" className="btn btn-primary" disabled={e2payBusy||!e2payConfirmPassword||!e2payOtp.trim()} onClick={()=>void confirmClientE2Pay(account)}>{e2payBusy?'Mengonfirmasi…':'Konfirmasi & Aktifkan E2Pay'}</button>
    </>;
  }

  const canCreateProject = actor?.permissions.includes('project:write') || false;
  function editClient(client: Client) {
    setEditingId(client.id); setMode('client');
    setForm({ ...EMPTY_FORM,name:client.name,website:client.website||'',industry:client.industry||'',contactName:client.contact_name||'',contactEmail:client.contact_email||'',contactPhone:client.contact_phone||'',status:client.status||'ACTIVE',npwp:client.npwp||'',nitku:client.nitku||'',billingAddress:client.billing_address||'',billingEmail:client.billing_email||'',paymentTermsDays:String(client.payment_terms_days??30),taxStatus:client.tax_status||'NON_PKP',purchaseOrder:client.purchase_order||'',billingMethod:client.billing_method||'PER_EMPLOYEE',billingRate:String(client.billing_rate??0),billingAdminFee:String(client.billing_admin_fee??0),billingTaxRate:String(client.billing_tax_rate??0) });
  }
  function editProject(project: Project) {
    setOriginalProjectClientId(project.client_id);
    setEditingId(project.id); setMode('project');
    setForm({ ...EMPTY_FORM,name:project.name,clientId:project.client_id,description:project.description||'',serviceType:project.service_type||'Payroll Management',status:project.status||'ACTIVE',startDate:project.start_date?.slice(0,10)||'',endDate:project.end_date?.slice(0,10)||'',tier:project.tier||'TIER_1_PAYMENT_PROCESSING',tierEffectiveFrom:project.tier_effective_from?.slice(0,10)||project.start_date?.slice(0,10)||new Date().toISOString().slice(0,10),tierEffectiveUntil:project.tier_effective_until?.slice(0,10)||'',contractReference:project.contract_reference||'' });
  }
  const clientIds = new Set(clients.map((client) => client.id));
  const visibleClients: Client[] = [...clients, ...existingClients.filter((client) => !clientIds.has(client.id)).map((client) => ({ ...client, code: client.code || client.id }))];
  const projectIds = new Set(projects.map((project) => project.id));
  const visibleProjects: Project[] = [...projects, ...existingProjects.filter((project) => !projectIds.has(project.id)).map((project) => ({ ...project, code: project.id, client_id: '', client_name: project.company }))];
  const normalizedQuery=query.trim().toLocaleLowerCase('id-ID');
  const filteredClients=useMemo(()=>visibleClients.filter((client)=>{
    const haystack=[client.name,client.code,client.industry,client.contact_name,client.npwp].join(' ').toLocaleLowerCase('id-ID');
    return (!normalizedQuery||haystack.includes(normalizedQuery))&&(statusFilter==='ALL'||String(client.status||'ACTIVE')===statusFilter);
  }),[visibleClients,normalizedQuery,statusFilter]);
  const filteredProjects=useMemo(()=>visibleProjects.filter((project)=>{
    const haystack=[project.name,project.code,project.client_name,project.service_type,project.description,project.tier].join(' ').toLocaleLowerCase('id-ID');
    return (!normalizedQuery||haystack.includes(normalizedQuery))
      &&(statusFilter==='ALL'||String(project.status||'ACTIVE')===statusFilter)
      &&(projectClientFilter==='ALL'||project.client_id===projectClientFilter);
  }),[visibleProjects,normalizedQuery,statusFilter,projectClientFilter]);
  const PAGE_SIZE=8;
  const clientPageCount=Math.max(1,Math.ceil(filteredClients.length/PAGE_SIZE));
  const projectPageCount=Math.max(1,Math.ceil(filteredProjects.length/PAGE_SIZE));
  const clientPageRows=filteredClients.slice((clientPage-1)*PAGE_SIZE,clientPage*PAGE_SIZE);
  const projectPageRows=filteredProjects.slice((projectPage-1)*PAGE_SIZE,projectPage*PAGE_SIZE);
  useEffect(()=>{setClientPage(1);setProjectPage(1);},[query,statusFilter,projectClientFilter]);
  useEffect(()=>setClientPage((value)=>Math.min(value,clientPageCount)),[clientPageCount]);
  useEffect(()=>setProjectPage((value)=>Math.min(value,projectPageCount)),[projectPageCount]);

  useEffect(()=>{
    if(!mode&&!detail) return;
    previousFocusRef.current=document.activeElement instanceof HTMLElement?document.activeElement:null;
    const originalOverflow=document.body.style.overflow;
    document.body.style.overflow='hidden';
    const activeDialog=()=>mode?dialogRef.current:detailDialogRef.current;
    const frame=requestAnimationFrame(()=>activeDialog()?.querySelector<HTMLElement>('input,select,textarea,button')?.focus());
    const handleKey=(event:KeyboardEvent)=>{
      if(event.key==='Escape'){event.preventDefault();if(mode)setMode(null);else setDetail(null);return;}
      const dialog=activeDialog();
      if(event.key!=='Tab'||!dialog) return;
      const focusable=[...dialog.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')];
      if(!focusable.length) return;
      const first=focusable[0],last=focusable[focusable.length-1];
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
    };
    document.addEventListener('keydown',handleKey);
    return()=>{
      cancelAnimationFrame(frame);
      document.removeEventListener('keydown',handleKey);
      document.body.style.overflow=originalOverflow;
      previousFocusRef.current?.focus();
    };
  },[mode,detail]);

  const statusTone=(status?:string):'success'|'warning'|'danger'|'neutral' => {
    const value=String(status||'ACTIVE');
    if(value==='ACTIVE'||value==='COMPLETED') return 'success';
    if(value==='ON_HOLD') return 'warning';
    if(value==='INACTIVE') return 'danger';
    return 'neutral';
  };
  const activeClients=visibleClients.filter((client)=>String(client.status||'ACTIVE')==='ACTIVE').length;
  const activeProjects=visibleProjects.filter((project)=>String(project.status||'ACTIVE')==='ACTIVE').length;
  const totalEmployees=visibleClients.reduce((sum,client)=>sum+Number(client.employee_count||0),0);
  const assignedAccounts=visibleClients.reduce((sum,client)=>sum+Number(client.assigned_user_count||0),0);

  return (
    <section className="directory-workspace">
      <div className="directory-header">
        <div>
          <h2>Klien & Project</h2>
          <p>Identitas, relasi akun, dan konteks layanan dalam satu master data.</p>
        </div>
        <div className="directory-header-actions">
          {canCreateClient ? <button type="button" className="btn" onClick={() => { setEditingId(''); setForm(EMPTY_FORM); setMode('client'); }}>+ Tambah Klien</button> : null}
          {canCreateProject ? <button type="button" className="btn btn-primary" onClick={() => { setEditingId(''); setForm(EMPTY_FORM); setMode('project'); }}>+ Tambah Project</button> : null}
        </div>
      </div>

      <UiMetricGrid>
        <UiMetricCard label="Klien aktif" value={activeClients} note={`${visibleClients.length} total klien`} tone="accent" />
        <UiMetricCard label="Project aktif" value={activeProjects} note={`${visibleProjects.length} total project`} />
        <UiMetricCard label="Karyawan terhubung" value={totalEmployees.toLocaleString('id-ID')} note="berdasarkan master klien" />
        <UiMetricCard label="Akun klien" value={assignedAccounts} note="scope akun terpasang" />
      </UiMetricGrid>

      {message ? <UiNotice tone={messageTone} title={messageTone==='error'?'Master data bermasalah':messageTone==='success'?'Perubahan tersimpan':'Informasi'}>{message}</UiNotice> : null}
      {projectsTruncated ? <UiNotice tone="warning" title="Daftar project dibatasi">API mengembalikan maksimal 500 project. Gunakan filter klien atau pencarian untuk mempersempit data.</UiNotice> : null}

      <UiFilterBar
        title="Cari & filter master data"
        detail={activeDirectoryTab==='clients'?'Filter berlaku pada daftar klien aktif.':'Filter berlaku pada daftar project aktif.'}
        action={<button type="button" className="btn" disabled={!query&&statusFilter==='ALL'&&projectClientFilter==='ALL'} onClick={()=>{setQuery('');setStatusFilter('ALL');setProjectClientFilter('ALL');}}>Reset filter</button>}
        className="directory-filter-bar"
      >
        <label>
          <span>Cari</span>
          <input type="search" value={query} onChange={(event)=>setQuery(event.target.value)} placeholder={activeDirectoryTab==='clients'?'Nama klien, PIC, industri, NPWP…':'Nama project, klien, layanan, tier…'} />
        </label>
        <label>
          <span>Status</span>
          <select value={statusFilter} onChange={(event)=>setStatusFilter(event.target.value)}>
            <option value="ALL">Semua status</option>
            <option value="ACTIVE">Aktif</option>
            <option value="ON_HOLD">Ditunda</option>
            <option value="COMPLETED">Selesai</option>
            <option value="INACTIVE">Nonaktif</option>
          </select>
        </label>
        {activeDirectoryTab==='projects' ? <label>
          <span>Klien</span>
          <select value={projectClientFilter} onChange={(event)=>setProjectClientFilter(event.target.value)}>
            <option value="ALL">Semua klien</option>
            {visibleClients.map((client)=><option key={client.id} value={client.id}>{client.name}</option>)}
          </select>
        </label> : <div className="directory-filter-context"><span>Mode</span><strong>Master Klien</strong><small>{filteredClients.length} data sesuai filter</small></div>}
      </UiFilterBar>

      <UiSectionCard
        className="directory-master-card"
        title="Master Data"
        detail="Kelola profil klien dan project dalam satu workspace dengan konteks yang tetap jelas."
        action={<UiTabs ariaLabel="Jenis master data" value={activeDirectoryTab} onChange={(value)=>setActiveDirectoryTab(value as 'clients'|'projects')} items={[
          {value:'clients',label:`Klien · ${filteredClients.length}`},
          {value:'projects',label:`Project · ${filteredProjects.length}`},
        ]} />}
      >
        <UiDataTableState
          loading={loading}
          empty={!loading && (activeDirectoryTab==='clients' ? filteredClients.length===0 : filteredProjects.length===0)}
          error={messageTone==='error' ? message : undefined}
          onRetry={()=>void load()}
          loadingTitle="Memuat master data…"
          loadingBody="Mengambil klien, project, scope akun, dan ringkasan operasional."
          emptyTitle={activeDirectoryTab==='clients'?'Tidak ada klien sesuai filter':'Tidak ada project sesuai filter'}
          emptyBody="Ubah kata pencarian atau reset filter untuk menampilkan data lain."
        />

        {!loading && messageTone!=='error' && activeDirectoryTab==='clients' && filteredClients.length ? <>
          <div className="directory-list directory-client-list">
            {clientPageRows.map((client) => <article className="directory-entity-card" key={client.id}>
              <div className="directory-entity-main">
                <ClientIcon client={client} />
                <div className="directory-entity-copy">
                  <div className="directory-entity-title-row">
                    <strong>{client.name}</strong>
                    <UiStatusBadge tone={statusTone(client.status)}>{client.status || 'ACTIVE'}</UiStatusBadge>
                  </div>
                  <span>{client.code} · {client.industry || 'Industri belum diisi'}</span>
                  <small>{client.contact_name ? `PIC ${client.contact_name}` : 'PIC belum diisi'}{client.website ? ` · ${client.website.replace(/^https?:\/\//, '')}` : ''}</small>
                  <div className="directory-entity-meta">
                    <span>{client.tax_status==='PKP'?'PKP':'Non-PKP'}</span>
                    <span>{client.project_count || 0} project</span>
                    <span>{client.employee_count || 0} karyawan</span>
                    <span>{client.assigned_user_count || 0} akun</span>
                  </div>
                </div>
              </div>
              <div className="directory-entity-actions">
                <button type="button" className="btn" onClick={() => setDetail({type:'client',item:client})}>Lihat detail</button>
                {canCreateClient ? <button type="button" className="btn btn-primary directory-manage-btn" onClick={() => editClient(client)}>Kelola</button> : null}
              </div>
            </article>)}
          </div>
          <UiPagination
            page={clientPage}
            pageCount={clientPageCount}
            previousDisabled={clientPage<=1}
            nextDisabled={clientPage>=clientPageCount}
            onPrevious={()=>setClientPage((value)=>Math.max(1,value-1))}
            onNext={()=>setClientPage((value)=>Math.min(clientPageCount,value+1))}
          />
        </> : null}

        {!loading && messageTone!=='error' && activeDirectoryTab==='projects' && filteredProjects.length ? <>
          <div className="directory-list directory-project-list">
            {projectPageRows.map((project) => <article className="directory-entity-card directory-project-card" key={project.id}>
              <div className="directory-entity-main">
                <div className="directory-project-mark" aria-hidden="true">{project.name.slice(0,1).toUpperCase() || 'P'}</div>
                <div className="directory-entity-copy">
                  <div className="directory-entity-title-row">
                    <strong>{project.name}</strong>
                    <UiStatusBadge tone={statusTone(project.status)}>{project.status || 'ACTIVE'}</UiStatusBadge>
                  </div>
                  <span>{project.code} · {project.client_name || project.client_id || 'Klien belum terhubung'}</span>
                  <small>{project.service_type || 'Layanan belum diisi'}{project.description ? ` · ${project.description}` : ''}</small>
                  <div className="directory-entity-meta">
                    <span>{project.tier?String(project.tier).replaceAll('_',' '):'Tier belum ditetapkan'}</span>
                    <span>{project.assigned_user_count || 0} akun</span>
                    <span>{project.start_date ? new Date(project.start_date).toLocaleDateString('id-ID') : 'Tanpa tanggal mulai'}</span>
                  </div>
                </div>
              </div>
              <div className="directory-entity-actions">
                <button type="button" className="btn" onClick={() => setDetail({type:'project',item:project})}>Lihat detail</button>
                {canCreateProject && project.client_id ? <button type="button" className="btn btn-primary directory-manage-btn" onClick={() => editProject(project)}>Kelola</button> : null}
              </div>
            </article>)}
          </div>
          <UiPagination
            page={projectPage}
            pageCount={projectPageCount}
            previousDisabled={projectPage<=1}
            nextDisabled={projectPage>=projectPageCount}
            onPrevious={()=>setProjectPage((value)=>Math.max(1,value-1))}
            onNext={()=>setProjectPage((value)=>Math.min(projectPageCount,value+1))}
          />
        </> : null}
      </UiSectionCard>
      {mode ? createPortal(<div className="directory-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setMode(null); }}>
        <div ref={dialogRef} className="directory-modal" role="dialog" aria-modal="true" aria-label={`${editingId ? 'Kelola' : 'Tambah'} ${mode}`}>
          <div className="directory-modal-title"><div><span>MASTER DATA</span><h3>{editingId ? 'Kelola' : 'Tambah'} {mode === 'client' ? 'Klien' : 'Project'}</h3></div><button type="button" aria-label="Tutup" onClick={() => setMode(null)}>✕</button></div>
          <label>Nama<input value={form.name} maxLength={160} placeholder={mode === 'client' ? 'Nama perusahaan' : 'Nama project'} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
          <div className="directory-code-field" aria-label="Kode otomatis"><span>Kode otomatis</span><code>{automaticCode(form.name, mode === 'client' ? 'CLIENT' : 'PROJECT')}</code><small>Dibentuk otomatis dari nama dan dijaga unik oleh sistem.</small></div>
          {mode === 'client' ? <>
            <section className="directory-form-card"><div className="directory-form-card-title"><span>01</span><div><strong>Profil & Kontak</strong><small>Identitas perusahaan dan PIC utama.</small></div></div>
            <div className="directory-form-grid"><label>Website<input type="url" value={form.website} maxLength={300} placeholder="https://perusahaan.com" onChange={(event) => setForm({ ...form, website: event.target.value })} /></label><label>Industri<input value={form.industry} maxLength={120} placeholder="Contoh: Retail" onChange={(event) => setForm({ ...form, industry: event.target.value })} /></label></div>
            <label>Nama PIC<input value={form.contactName} maxLength={120} placeholder="Kontak utama klien" onChange={(event) => setForm({ ...form, contactName: event.target.value })} /></label>
            <div className="directory-form-grid"><label>Email PIC<input type="email" value={form.contactEmail} maxLength={254} placeholder="pic@perusahaan.com" onChange={(event) => setForm({ ...form, contactEmail: event.target.value })} /></label><label>Telepon PIC<input type="tel" value={form.contactPhone} maxLength={40} placeholder="+62..." onChange={(event) => setForm({ ...form, contactPhone: event.target.value })} /></label></div>
            </section><section className="directory-form-card"><div className="directory-form-card-title"><span>02</span><div><strong>Legal & Tax</strong><small>Data administrasi dan perpajakan klien.</small></div></div><div className="directory-form-grid"><label>NPWP<input value={form.npwp} maxLength={40} onChange={(event)=>setForm({...form,npwp:event.target.value})}/></label><label>NITKU<input value={form.nitku} maxLength={40} onChange={(event)=>setForm({...form,nitku:event.target.value})}/></label><label>Status pajak<select value={form.taxStatus} onChange={(event)=>setForm({...form,taxStatus:event.target.value,billingTaxRate:event.target.value==='PKP'?form.billingTaxRate:'0'})}><option value="NON_PKP">Non-PKP</option><option value="PKP">PKP</option></select></label><label>Purchase order<input value={form.purchaseOrder} maxLength={120} onChange={(event)=>setForm({...form,purchaseOrder:event.target.value})}/></label></div>
            </section><section className="directory-form-card"><div className="directory-form-card-title"><span>03</span><div><strong>Billing & Financial</strong><small>Termin, metode billing, fee, dan pajak.</small></div></div><label>Alamat penagihan<textarea rows={2} maxLength={1000} value={form.billingAddress} onChange={(event)=>setForm({...form,billingAddress:event.target.value})}/></label><div className="directory-form-grid"><label>Email billing<input type="email" maxLength={254} value={form.billingEmail} onChange={(event)=>setForm({...form,billingEmail:event.target.value})}/></label><label>Termin (hari)<input type="number" min="0" max="365" value={form.paymentTermsDays} onChange={(event)=>setForm({...form,paymentTermsDays:event.target.value})}/></label><label>Metode billing<select value={form.billingMethod} onChange={(event)=>setForm({...form,billingMethod:event.target.value})}><option value="PER_EMPLOYEE">Per employee</option><option value="FIXED">Fixed fee</option><option value="PERCENTAGE_OF_PAYROLL">% payroll</option></select></label><label>Rate<input type="number" min="0" max={form.billingMethod==='PERCENTAGE_OF_PAYROLL'?'100':undefined} value={form.billingRate} onChange={(event)=>setForm({...form,billingRate:event.target.value})}/></label><label>Admin fee<input type="number" min="0" value={form.billingAdminFee} onChange={(event)=>setForm({...form,billingAdminFee:event.target.value})}/></label><label>Pajak (%)<input type="number" min="0" max="100" step="0.01" value={form.billingTaxRate} disabled={form.taxStatus!=='PKP'} onChange={(event)=>setForm({...form,billingTaxRate:event.target.value})}/></label></div>
            <p className="directory-hint">Ikon diambil otomatis dari PWA manifest atau favicon website. Jika tidak tersedia, sistem memakai inisial klien.</p></section>
          </> : <>
            <section className="directory-form-card"><div className="directory-form-card-title"><span>01</span><div><strong>Project Profile</strong><small>Klien, layanan, dan ruang lingkup project.</small></div></div>
            <label>Klien<select value={form.clientId} onChange={(event) => setForm({ ...form, clientId: event.target.value })}><option value="">Pilih klien</option>{visibleClients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select></label>
            {editingId&&originalProjectClientId&&form.clientId!==originalProjectClientId ? <div className="directory-transfer-warning" role="alert"><strong>Project akan dipindahkan ke klien lain.</strong><span>Periksa kembali scope akun, tier layanan, payroll, dan billing yang terkait sebelum menyimpan.</span></div> : null}
            <label>Jenis layanan<input value={form.serviceType} maxLength={120} placeholder="Contoh: Payroll Management" onChange={(event) => setForm({ ...form, serviceType: event.target.value })} /></label>
            </section><section className="directory-form-card"><div className="directory-form-card-title"><span>02</span><div><strong>Service Tier</strong><small>Tier layanan, efektivitas, dan referensi kontrak.</small></div></div><label>Tier layanan<select value={form.tier} onChange={(event)=>setForm({...form,tier:event.target.value})}><option value="TIER_1_PAYMENT_PROCESSING">Tier 1 · Payment Processing</option><option value="TIER_2_MANAGED_PAYROLL">Tier 2 · Managed Payroll</option><option value="TIER_3_INTEGRATED_AUTOMATION">Tier 3 · Integrated Automation</option></select></label><div className="directory-form-grid"><label>Efektif mulai<input type="date" value={form.tierEffectiveFrom} onChange={(event)=>setForm({...form,tierEffectiveFrom:event.target.value})}/></label><label>Efektif sampai<input type="date" value={form.tierEffectiveUntil} onChange={(event)=>setForm({...form,tierEffectiveUntil:event.target.value})}/></label></div><label>Referensi kontrak<input value={form.contractReference} maxLength={120} onChange={(event)=>setForm({...form,contractReference:event.target.value})}/></label>
            </section><section className="directory-form-card"><div className="directory-form-card-title"><span>03</span><div><strong>Periode & Scope</strong><small>Deskripsi pekerjaan dan periode project.</small></div></div><label>Deskripsi<textarea value={form.description} maxLength={1000} rows={3} placeholder="Ruang lingkup singkat project" onChange={(event) => setForm({ ...form, description: event.target.value })} /></label>
            <p className="directory-hint">Project tidak dibatasi regional; lokasi karyawan dapat berbeda dalam satu project.</p>
            <div className="directory-form-grid"><label>Mulai<input type="date" max={form.endDate||undefined} value={form.startDate} onChange={(event) => setForm({ ...form, startDate: event.target.value })} /></label><label>Selesai<input type="date" min={form.startDate||undefined} value={form.endDate} onChange={(event) => setForm({ ...form, endDate: event.target.value })} /></label></div></section>
          </>}
          <label>Status<select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })}><option value="ACTIVE">Aktif</option>{mode === 'project' ? <><option value="ON_HOLD">Ditunda</option><option value="COMPLETED">Selesai</option></> : null}<option value="INACTIVE">Nonaktif</option></select></label>
          <div className="directory-modal-actions"><button type="button" className="btn" onClick={() => setMode(null)}>Batal</button><button type="button" className="btn btn-primary" disabled={saving || !form.name || (mode === 'project' && !form.clientId)} onClick={() => void submit()}>{saving ? 'Menyimpan…' : editingId ? 'Simpan perubahan' : 'Simpan'}</button></div>
        </div>
      </div>, document.body) : null}
      {detail ? createPortal(<div className="directory-modal-backdrop" role="presentation" onMouseDown={(event)=>{if(event.target===event.currentTarget)setDetail(null);}}><div ref={detailDialogRef} className="directory-modal directory-detail-modal" role="dialog" aria-modal="true" aria-label={`Detail ${detail.type}`}><div className="directory-modal-title"><div><span>MASTER DATA</span><h3>{detail.item.name}</h3></div><button type="button" aria-label="Tutup detail" onClick={()=>setDetail(null)}>✕</button></div><DirectoryDetail detail={detail} />
      {detail.type==='client'?<section className="directory-form-card"><div className="directory-form-card-title"><span>PAY</span><div><strong>Payment & Disbursement</strong><small>E2Pay sub-client mengikuti master klien dan digunakan sebagai sumber routing pembayaran.</small></div></div>
        {(()=>{const client=detail.item as Client;const account=e2payAccounts.find((row)=>row.clientId===client.id&&!row.projectId);if(!account)return canManageE2Pay?renderE2PayRegistrationForm(client):<p className="directory-hint">Sub-client E2Pay belum terdaftar. Hubungi Super Admin atau Payroll Processor.</p>;return <><div className="directory-detail-grid"><div><span>Gateway</span><strong>E2Pay</strong></div><div><span>Status</span><strong>{account.status}</strong></div><div><span>Provisioning</span><strong>{account.provisioningState||'NOT_STARTED'}</strong></div><div><span>Readiness</span><strong>{account.readiness?.ready?'Ready':'Blocked'}</strong></div><div><span>Sub-client</span><strong>{account.providerSubAccountIdMasked||'Menunggu provisioning'}</strong></div><div><span>Environment</span><strong>{account.environment}</strong></div><div><span>Merchant credential</span><strong>{account.merchantCredential?.ready?'Scoped & encrypted':'Belum terhubung'}</strong></div><div><span>Parent E2Pay</span><strong>{account.parentSourceId||'Belum tervalidasi'}</strong></div><div><span>Available balance</span><strong>{account.availableBalance===null?'Belum sync':`Rp ${Number(account.availableBalance).toLocaleString('id-ID')}`}</strong></div></div>{account.provisioningState==='FAILED'?<><UiNotice tone="error" title="Provisioning gagal">{account.lastProvisioningErrorMessage||'Registrasi belum berhasil.'}</UiNotice>{renderE2PayRegistrationForm(client,undefined,'Coba registrasi ulang')}</>:account.provisioningState==='PENDING_CONFIRMATION'?renderE2PayPendingConfirmation(account,client):renderE2PayMerchantCredential(account)}</>;})()}
      </section>:null}
      {detail.type==='project'?<section className="directory-form-card"><div className="directory-form-card-title"><span>PAY</span><div><strong>Payment & Disbursement</strong><small>Project mewarisi E2Pay sub-client milik Client. Override hanya dibuat bila project membutuhkan account terpisah.</small></div></div>
        {(()=>{const project=detail.item as Project;const override=e2payAccounts.find((row)=>row.projectId===project.id);const inherited=e2payAccounts.find((row)=>row.clientId===project.client_id&&!row.projectId);const account=override||inherited;const client=clients.find((row)=>row.id===project.client_id);if(!account)return canManageE2Pay&&client?<><p className="directory-hint">Client belum memiliki E2Pay account. Daftarkan di Client terlebih dahulu; project akan mewarisinya otomatis.</p></>:<p className="directory-hint">Belum ada routing pembayaran aktif.</p>;return <><div className="directory-detail-grid"><div><span>Routing</span><strong>{override?'Project Override':'Inherited from Client'}</strong></div><div><span>Status</span><strong>{account.status}</strong></div><div><span>Provisioning</span><strong>{account.provisioningState||'NOT_STARTED'}</strong></div><div><span>Readiness</span><strong>{account.readiness?.ready?'Ready':'Blocked'}</strong></div><div><span>Sub-client</span><strong>{account.providerSubAccountIdMasked||'Menunggu provisioning'}</strong></div><div><span>Environment</span><strong>{account.environment}</strong></div><div><span>Merchant credential</span><strong>{account.merchantCredential?.ready?'Scoped & encrypted':'Belum terhubung'}</strong></div><div><span>Available balance</span><strong>{account.availableBalance===null?'Belum sync':`Rp ${Number(account.availableBalance).toLocaleString('id-ID')}`}</strong></div></div>{override&&client&&account.provisioningState==='FAILED'?<><UiNotice tone="error" title="Provisioning override gagal">{account.lastProvisioningErrorMessage||'Registrasi override belum berhasil.'}</UiNotice>{renderE2PayRegistrationForm(client,project,'Coba registrasi override ulang')}</>:override&&client&&account.provisioningState==='PENDING_CONFIRMATION'?renderE2PayPendingConfirmation(account,client,project):override?renderE2PayMerchantCredential(account):!override&&canManageE2Pay&&client?<><details><summary>Buat Project Override</summary>{renderE2PayRegistrationForm(client,project)}</details>{renderE2PayMerchantCredential(account)}</>:renderE2PayMerchantCredential(account)}</>;})()}
      </section>:null}
      <div className="directory-modal-actions"><button type="button" className="btn" onClick={()=>setDetail(null)}>Tutup</button>{detail.type==='client'&&canCreateClient?<button type="button" className="btn btn-primary" onClick={()=>{setDetail(null);editClient(detail.item as Client);}}>Kelola</button>:detail.type==='project'&&canCreateProject&&(detail.item as Project).client_id?<button type="button" className="btn btn-primary" onClick={()=>{setDetail(null);editProject(detail.item as Project);}}>Kelola</button>:null}</div></div></div>,document.body):null}
    </section>
  );
}


function DirectoryDetail({detail}:{detail:{type:'client'|'project';item:Client|Project}}) {
  if(detail.type==='client') {
    const item=detail.item as Client;
    return <><div className="directory-detail-hero"><span>CLIENT PROFILE</span><strong>{item.name}</strong><small>{item.industry||'Industri belum diisi'} · {item.project_count||0} project · {item.employee_count||0} karyawan</small></div><div className="directory-detail-grid"><div><span>Kode</span><strong>{item.code}</strong></div><div><span>Status</span><strong>{item.status||'ACTIVE'}</strong></div><div><span>Industri</span><strong>{item.industry||'-'}</strong></div><div><span>PIC</span><strong>{item.contact_name||'-'}</strong></div><div><span>Email</span><strong>{item.contact_email||'-'}</strong></div><div><span>Telepon</span><strong>{item.contact_phone||'-'}</strong></div><div><span>NPWP</span><strong>{item.npwp||'-'}</strong></div><div><span>Status pajak</span><strong>{item.tax_status||'NON_PKP'}</strong></div><div><span>Project</span><strong>{item.project_count||0}</strong></div><div><span>Karyawan</span><strong>{item.employee_count||0}</strong></div></div></>;
  }
  const item=detail.item as Project;
  return <><div className="directory-detail-hero"><span>PROJECT PROFILE</span><strong>{item.name}</strong><small>{item.client_name||item.client_id||'Klien belum terhubung'} · {item.service_type||'Layanan belum diisi'}</small></div><div className="directory-detail-grid"><div><span>Kode</span><strong>{item.code}</strong></div><div><span>Status</span><strong>{item.status||'ACTIVE'}</strong></div><div><span>Klien</span><strong>{item.client_name||item.client_id||'-'}</strong></div><div><span>Layanan</span><strong>{item.service_type||'-'}</strong></div><div><span>Tier</span><strong>{item.tier?item.tier.replaceAll('_',' '):'-'}</strong></div><div><span>Kontrak</span><strong>{item.contract_reference||'-'}</strong></div><div><span>Mulai</span><strong>{item.start_date?new Date(item.start_date).toLocaleDateString('id-ID'):'-'}</strong></div><div><span>Selesai</span><strong>{item.end_date?new Date(item.end_date).toLocaleDateString('id-ID'):'-'}</strong></div><div className="wide"><span>Deskripsi</span><strong>{item.description||'-'}</strong></div></div></>;
}
