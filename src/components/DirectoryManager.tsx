'use client';

import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import Image from 'next/image';

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
    ? <Image unoptimized width={40} height={40} className="directory-icon" src={client.logo_url} alt="" onError={() => setFailed(true)} />
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
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [selectedClientId, setSelectedClientId] = useState('ALL');
  const [clientPage, setClientPage] = useState(1);
  const [projectPage, setProjectPage] = useState(1);
  const pageSize = 8;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/client-projects', { headers: { Accept: 'application/json' } });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      setClients(data.clients || []);
      setProjects(data.projects || []);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Gagal memuat master data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

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
          npwp:form.npwp||undefined,nitku:form.nitku||undefined,billingAddress:form.billingAddress||undefined,billingEmail:form.billingEmail||undefined,paymentTermsDays:Number(form.paymentTermsDays),taxStatus:form.taxStatus,purchaseOrder:form.purchaseOrder||undefined,billingMethod:form.billingMethod,billingRate:Number(form.billingRate),billingAdminFee:Number(form.billingAdminFee),billingTaxRate:Number(form.billingTaxRate),
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
      setMessage(`${mode === 'client' ? 'Klien' : 'Project'} berhasil ${editingId ? 'diperbarui' : 'ditambahkan'}.`);
      setMode(null);
      setEditingId('');
      setForm(EMPTY_FORM);
      await Promise.all([load(), onChanged()]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Gagal menyimpan');
    } finally {
      setSaving(false);
    }
  }

  const canCreateClient = actor?.permissions.includes('client:write') || false;
  const canCreateProject = actor?.permissions.includes('project:write') || false;
  function editClient(client: Client) {
    setEditingId(client.id); setMode('client');
    setForm({ ...EMPTY_FORM,name:client.name,website:client.website||'',industry:client.industry||'',contactName:client.contact_name||'',contactEmail:client.contact_email||'',contactPhone:client.contact_phone||'',status:client.status||'ACTIVE',npwp:client.npwp||'',nitku:client.nitku||'',billingAddress:client.billing_address||'',billingEmail:client.billing_email||'',paymentTermsDays:String(client.payment_terms_days??30),taxStatus:client.tax_status||'NON_PKP',purchaseOrder:client.purchase_order||'',billingMethod:client.billing_method||'PER_EMPLOYEE',billingRate:String(client.billing_rate??0),billingAdminFee:String(client.billing_admin_fee??0),billingTaxRate:String(client.billing_tax_rate??0) });
  }
  function editProject(project: Project) {
    setEditingId(project.id); setMode('project');
    setForm({ ...EMPTY_FORM,name:project.name,clientId:project.client_id,description:project.description||'',serviceType:project.service_type||'Payroll Management',status:project.status||'ACTIVE',startDate:project.start_date?.slice(0,10)||'',endDate:project.end_date?.slice(0,10)||'',tier:project.tier||'TIER_1_PAYMENT_PROCESSING',tierEffectiveFrom:project.tier_effective_from?.slice(0,10)||project.start_date?.slice(0,10)||new Date().toISOString().slice(0,10),tierEffectiveUntil:project.tier_effective_until?.slice(0,10)||'',contractReference:project.contract_reference||'' });
  }
  const clientNames = new Set(clients.map((client) => client.name.toLocaleLowerCase('id-ID')));
  const visibleClients: Client[] = [...clients, ...existingClients.filter((client) => !clientNames.has(client.name.toLocaleLowerCase('id-ID'))).map((client) => ({ ...client, code: client.code || client.id }))];
  const projectNames = new Set(projects.map((project) => project.name.toLocaleLowerCase('id-ID')));
  const visibleProjects: Project[] = [...projects, ...existingProjects.filter((project) => !projectNames.has(project.name.toLocaleLowerCase('id-ID'))).map((project) => ({ ...project, code: project.id, client_id: '', client_name: project.company }))];
  const normalizedQuery = query.trim().toLocaleLowerCase('id-ID');
  const filteredClients = visibleClients.filter((client) => {
    if (statusFilter !== 'ALL' && (client.status || 'ACTIVE') !== statusFilter) return false;
    return !normalizedQuery || [client.name, client.code, client.industry, client.contact_name].some((value) => String(value || '').toLocaleLowerCase('id-ID').includes(normalizedQuery));
  });
  const filteredProjects = visibleProjects.filter((project) => {
    if (selectedClientId !== 'ALL' && project.client_id !== selectedClientId) return false;
    if (statusFilter !== 'ALL' && (project.status || 'ACTIVE') !== statusFilter) return false;
    return !normalizedQuery || [project.name, project.code, project.client_name, project.service_type].some((value) => String(value || '').toLocaleLowerCase('id-ID').includes(normalizedQuery));
  });
  const clientPages = Math.max(1, Math.ceil(filteredClients.length / pageSize));
  const projectPages = Math.max(1, Math.ceil(filteredProjects.length / pageSize));
  const pagedClients = filteredClients.slice((Math.min(clientPage, clientPages) - 1) * pageSize, Math.min(clientPage, clientPages) * pageSize);
  const pagedProjects = filteredProjects.slice((Math.min(projectPage, projectPages) - 1) * pageSize, Math.min(projectPage, projectPages) * pageSize);

  return (
    <section>
      <div className="directory-header">
        <div><h2>Klien & Project</h2><p>Identitas, relasi akun, dan konteks layanan dalam satu master data.</p></div>
        <div>
          {canCreateClient ? <button type="button" className="btn" onClick={() => { setEditingId(''); setForm(EMPTY_FORM); setMode('client'); }}>+ Tambah Klien</button> : null}
          {canCreateProject ? <button type="button" className="btn btn-primary" onClick={() => { setEditingId(''); setForm({ ...EMPTY_FORM, clientId: selectedClientId === 'ALL' ? '' : selectedClientId }); setMode('project'); }}>+ Tambah Project</button> : null}
        </div>
      </div>
      <div className="directory-kpi-grid">
        <div><span>Total klien</span><strong>{visibleClients.length}</strong></div><div><span>Total project</span><strong>{visibleProjects.length}</strong></div><div><span>Klien aktif</span><strong>{visibleClients.filter((row) => (row.status || 'ACTIVE') === 'ACTIVE').length}</strong></div><div><span>Total karyawan</span><strong>{visibleClients.reduce((sum, row) => sum + Number(row.employee_count || 0), 0)}</strong></div>
      </div>
      <div className="directory-toolbar card">
        <label className="directory-search"><span>⌕</span><input value={query} onChange={(event) => { setQuery(event.target.value); setClientPage(1); setProjectPage(1); }} placeholder="Cari klien, kode, project, layanan…" aria-label="Cari klien dan project" /></label>
        <select value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value); setClientPage(1); setProjectPage(1); }} aria-label="Filter status"><option value="ALL">Semua status</option><option value="ACTIVE">Aktif</option><option value="INACTIVE">Nonaktif</option><option value="ON_HOLD">Ditunda</option><option value="COMPLETED">Selesai</option></select>
        <select value={selectedClientId} onChange={(event) => { setSelectedClientId(event.target.value); setProjectPage(1); }} aria-label="Filter project berdasarkan klien"><option value="ALL">Semua klien</option>{visibleClients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select>
        <button type="button" className="btn" onClick={() => { setQuery(''); setStatusFilter('ALL'); setSelectedClientId('ALL'); setClientPage(1); setProjectPage(1); }}>Reset</button>
      </div>
      {message ? <div className={`app-notice-bubble ${/gagal|error|tidak|wajib|invalid/i.test(message) ? 'app-notice-error' : 'app-notice-info'}`} role="status"><strong>{/gagal|error|tidak|wajib|invalid/i.test(message) ? 'Perlu perhatian' : 'Informasi'}</strong><span>{message}</span><button type="button" aria-label="Tutup pesan" onClick={() => setMessage('')}>✕</button></div> : null}
      {loading ? <div className="card directory-empty">Memuat master data…</div> : (
        <div className="directory-grid">
          <div className="card directory-section">
            <h3>Klien <span>{filteredClients.length}</span></h3>
            {pagedClients.map((client) => <div className={`directory-row directory-selectable${selectedClientId === client.id ? ' selected' : ''}`} key={client.id} onClick={() => { setSelectedClientId(client.id); setProjectPage(1); }}>
              <ClientIcon client={client} />
              <div className="directory-row-main"><b>{client.name}</b><small>{client.code} · {client.industry || 'Industri belum diisi'}</small><small>{client.contact_name ? `PIC ${client.contact_name}` : 'PIC belum diisi'}{client.website ? ` · ${client.website.replace(/^https?:\/\//, '')}` : ''}</small><small>{client.npwp?`NPWP ${client.npwp}`:'NPWP belum diisi'} · {client.tax_status==='PKP'?'PKP':'Non-PKP'}</small></div>
              <div><span className="directory-badge">{client.status || 'ACTIVE'}</span><small>{client.employee_count || 0} karyawan · {client.project_count || 0} project</small><small>{client.assigned_user_count || 0} akun</small>{canCreateClient ? <button className="btn" style={{ marginTop: 6 }} onClick={(event) => { event.stopPropagation(); editClient(client); }}>Kelola</button> : null}</div>
            </div>)}
            {!filteredClients.length ? <p className="directory-empty">Klien tidak ditemukan.</p> : null}
            <DirectoryPager page={Math.min(clientPage, clientPages)} pages={clientPages} onPage={setClientPage} />
          </div>
          <div className="card directory-section">
            <h3>Project <span>{filteredProjects.length}</span></h3>
            {pagedProjects.map((project) => <div className="directory-row" key={project.id}>
              <div className="directory-row-main"><b>{project.name}</b><small>{project.code} · {project.client_name || project.client_id}</small><small>{project.service_type || 'Layanan belum diisi'}{project.description ? ` · ${project.description}` : ''}</small><small>{project.tier?String(project.tier).replaceAll('_',' '):'Tier belum ditetapkan'}{project.tier_effective_from?` · efektif ${new Date(project.tier_effective_from).toLocaleDateString('id-ID')}`:''}</small></div>
              <div><span className="directory-badge">{project.status || 'ACTIVE'}</span><small>{project.start_date ? new Date(project.start_date).toLocaleDateString('id-ID') : 'Tanpa batas periode'} · {project.assigned_user_count || 0} akun</small>{canCreateProject ? <button className="btn" style={{ marginTop: 6 }} onClick={() => editProject(project)}>Kelola</button> : null}</div>
            </div>)}
            {!filteredProjects.length ? <p className="directory-empty">Project tidak ditemukan.</p> : null}
            <DirectoryPager page={Math.min(projectPage, projectPages)} pages={projectPages} onPage={setProjectPage} />
          </div>
        </div>
      )}
      {mode ? createPortal(<div className="directory-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setMode(null); }}>
        <div className="directory-modal" role="dialog" aria-modal="true" aria-label={`${editingId ? 'Kelola' : 'Tambah'} ${mode}`}>
          <div className="directory-modal-title"><div><span>MASTER DATA</span><h3>{editingId ? 'Kelola' : 'Tambah'} {mode === 'client' ? 'Klien' : 'Project'}</h3></div><button type="button" aria-label="Tutup" onClick={() => setMode(null)}>✕</button></div>
          <label>Nama<input value={form.name} maxLength={160} placeholder={mode === 'client' ? 'Nama perusahaan' : 'Nama project'} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
          <label>Kode otomatis<input value={automaticCode(form.name, mode === 'client' ? 'CLIENT' : 'PROJECT')} readOnly aria-readonly="true" /></label>
          {mode === 'client' ? <>
            <div className="directory-form-grid"><label>Website<input type="url" value={form.website} maxLength={300} placeholder="https://perusahaan.com" onChange={(event) => setForm({ ...form, website: event.target.value })} /></label><label>Industri<input value={form.industry} maxLength={120} placeholder="Contoh: Retail" onChange={(event) => setForm({ ...form, industry: event.target.value })} /></label></div>
            <label>Nama PIC<input value={form.contactName} maxLength={120} placeholder="Kontak utama klien" onChange={(event) => setForm({ ...form, contactName: event.target.value })} /></label>
            <div className="directory-form-grid"><label>Email PIC<input type="email" value={form.contactEmail} maxLength={254} placeholder="pic@perusahaan.com" onChange={(event) => setForm({ ...form, contactEmail: event.target.value })} /></label><label>Telepon PIC<input type="tel" value={form.contactPhone} maxLength={40} placeholder="+62..." onChange={(event) => setForm({ ...form, contactPhone: event.target.value })} /></label></div>
            <h4 className="directory-form-section">Legal & Tax</h4><div className="directory-form-grid"><label>NPWP<input value={form.npwp} maxLength={40} onChange={(event)=>setForm({...form,npwp:event.target.value})}/></label><label>NITKU<input value={form.nitku} maxLength={40} onChange={(event)=>setForm({...form,nitku:event.target.value})}/></label><label>Status pajak<select value={form.taxStatus} onChange={(event)=>setForm({...form,taxStatus:event.target.value})}><option value="NON_PKP">Non-PKP</option><option value="PKP">PKP</option></select></label><label>Purchase order<input value={form.purchaseOrder} maxLength={120} onChange={(event)=>setForm({...form,purchaseOrder:event.target.value})}/></label></div>
            <h4 className="directory-form-section">Billing & Financial</h4><label>Alamat penagihan<textarea rows={2} maxLength={1000} value={form.billingAddress} onChange={(event)=>setForm({...form,billingAddress:event.target.value})}/></label><div className="directory-form-grid"><label>Email billing<input type="email" maxLength={254} value={form.billingEmail} onChange={(event)=>setForm({...form,billingEmail:event.target.value})}/></label><label>Termin (hari)<input type="number" min="0" max="365" value={form.paymentTermsDays} onChange={(event)=>setForm({...form,paymentTermsDays:event.target.value})}/></label><label>Metode billing<select value={form.billingMethod} onChange={(event)=>setForm({...form,billingMethod:event.target.value})}><option value="PER_EMPLOYEE">Per employee</option><option value="FIXED">Fixed fee</option><option value="PERCENTAGE_OF_PAYROLL">% payroll</option></select></label><label>Rate<input type="number" min="0" value={form.billingRate} onChange={(event)=>setForm({...form,billingRate:event.target.value})}/></label><label>Admin fee<input type="number" min="0" value={form.billingAdminFee} onChange={(event)=>setForm({...form,billingAdminFee:event.target.value})}/></label><label>Pajak (%)<input type="number" min="0" max="100" step="0.01" value={form.billingTaxRate} disabled={form.taxStatus!=='PKP'} onChange={(event)=>setForm({...form,billingTaxRate:event.target.value})}/></label></div>
            <p className="directory-hint">Ikon diambil otomatis dari PWA manifest atau favicon website. Jika tidak tersedia, sistem memakai inisial klien.</p>
          </> : <>
            <label>Klien<select value={form.clientId} onChange={(event) => setForm({ ...form, clientId: event.target.value })}><option value="">Pilih klien</option>{visibleClients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select></label>
            <label>Jenis layanan<input value={form.serviceType} maxLength={120} placeholder="Contoh: Payroll Management" onChange={(event) => setForm({ ...form, serviceType: event.target.value })} /></label>
            <h4 className="directory-form-section">Service Tier Project</h4><label>Tier layanan<select value={form.tier} onChange={(event)=>setForm({...form,tier:event.target.value})}><option value="TIER_1_PAYMENT_PROCESSING">Tier 1 · Payment Processing</option><option value="TIER_2_MANAGED_PAYROLL">Tier 2 · Managed Payroll</option><option value="TIER_3_INTEGRATED_AUTOMATION">Tier 3 · Integrated Automation</option></select></label><div className="directory-form-grid"><label>Efektif mulai<input type="date" value={form.tierEffectiveFrom} onChange={(event)=>setForm({...form,tierEffectiveFrom:event.target.value})}/></label><label>Efektif sampai<input type="date" value={form.tierEffectiveUntil} onChange={(event)=>setForm({...form,tierEffectiveUntil:event.target.value})}/></label></div><label>Referensi kontrak<input value={form.contractReference} maxLength={120} onChange={(event)=>setForm({...form,contractReference:event.target.value})}/></label>
            <label>Deskripsi<textarea value={form.description} maxLength={1000} rows={3} placeholder="Ruang lingkup singkat project" onChange={(event) => setForm({ ...form, description: event.target.value })} /></label>
            <p className="directory-hint">Project tidak dibatasi regional; lokasi karyawan dapat berbeda dalam satu project.</p>
            <div className="directory-form-grid"><label>Mulai<input type="date" value={form.startDate} onChange={(event) => setForm({ ...form, startDate: event.target.value })} /></label><label>Selesai<input type="date" value={form.endDate} onChange={(event) => setForm({ ...form, endDate: event.target.value })} /></label></div>
          </>}
          <label>Status<select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })}><option value="ACTIVE">Aktif</option>{mode === 'project' ? <><option value="ON_HOLD">Ditunda</option><option value="COMPLETED">Selesai</option></> : null}<option value="INACTIVE">Nonaktif</option></select></label>
          <div className="directory-modal-actions"><button type="button" className="btn" onClick={() => setMode(null)}>Batal</button><button type="button" className="btn btn-primary" disabled={saving || !form.name || (mode === 'project' && !form.clientId)} onClick={() => void submit()}>{saving ? 'Menyimpan…' : editingId ? 'Simpan perubahan' : 'Simpan'}</button></div>
        </div>
      </div>, document.body) : null}
    </section>
  );
}

function DirectoryPager({ page, pages, onPage }: { page: number; pages: number; onPage: (page: number) => void }) {
  if (pages <= 1) return null;
  return <div className="directory-pager"><span>Halaman {page} dari {pages}</span><div><button type="button" disabled={page <= 1} onClick={() => onPage(page - 1)}>←</button><button type="button" disabled={page >= pages} onClick={() => onPage(page + 1)}>→</button></div></div>;
}
