'use client';

import { useCallback, useEffect, useState } from 'react';

type Actor = { role: string; permissions: string[] };
type Client = { id: string; code: string; name: string; employee_count?: number; project_count?: number };
type Project = { id: string; code: string; name: string; client_id: string; client_name?: string; status?: string; province?: string };

const EMPTY_FORM = { code: '', name: '', clientId: '', province: '', startDate: '', endDate: '' };

export default function DirectoryManager({ actor, onChanged, existingClients = [], existingProjects = [] }: {
  actor: Actor | null;
  onChanged: () => Promise<void>;
  existingClients?: Array<{ id: string; name: string; code?: string }>;
  existingProjects?: Array<{ id: string; name: string; company?: string; region?: string; status?: string }>;
}) {
  const [clients, setClients] = useState<Client[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [mode, setMode] = useState<'client' | 'project' | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

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
        ? { action: 'CREATE_CLIENT', code: form.code, name: form.name }
        : { action: 'CREATE_PROJECT', code: form.code, name: form.name, clientId: form.clientId, province: form.province, startDate: form.startDate || undefined, endDate: form.endDate || undefined };
      const response = await fetch('/api/client-projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      setMessage(`${mode === 'client' ? 'Klien' : 'Project'} berhasil ditambahkan.`);
      setMode(null);
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
  const clientNames = new Set(clients.map((client) => client.name.toLocaleLowerCase('id-ID')));
  const visibleClients: Client[] = [
    ...clients,
    ...existingClients
      .filter((client) => !clientNames.has(client.name.toLocaleLowerCase('id-ID')))
      .map((client) => ({ ...client, code: client.code || client.id })),
  ];
  const projectNames = new Set(projects.map((project) => project.name.toLocaleLowerCase('id-ID')));
  const visibleProjects: Project[] = [
    ...projects,
    ...existingProjects
      .filter((project) => !projectNames.has(project.name.toLocaleLowerCase('id-ID')))
      .map((project) => ({
        ...project,
        code: project.id,
        client_id: '',
        client_name: project.company,
        province: project.region,
      })),
  ];

  return (
    <section>
      <div className="directory-header">
        <div><h2>Klien & Project</h2><p>Master data operasional yang dapat dikelola tanpa melalui chat IDA.</p></div>
        <div>
          {canCreateClient ? <button type="button" className="btn" onClick={() => setMode('client')}>+ Tambah Klien</button> : null}
          {canCreateProject ? <button type="button" className="btn btn-primary" onClick={() => setMode('project')}>+ Tambah Project</button> : null}
        </div>
      </div>
      {message ? <div className="directory-message" role="status">{message}</div> : null}
      {loading ? <div className="card directory-empty">Memuat master data…</div> : (
        <div className="directory-grid">
          <div className="card directory-section">
            <h3>Klien <span>{visibleClients.length}</span></h3>
            {visibleClients.map((client) => <div className="directory-row" key={client.id}><div><b>{client.name}</b><small>{client.code} · {client.id}</small></div><div><strong>{client.employee_count || 0}</strong><small>Karyawan · {client.project_count || 0} project</small></div></div>)}
            {!visibleClients.length ? <p className="directory-empty">Belum ada klien.</p> : null}
          </div>
          <div className="card directory-section">
            <h3>Project <span>{visibleProjects.length}</span></h3>
            {visibleProjects.map((project) => <div className="directory-row" key={project.id}><div><b>{project.name}</b><small>{project.code} · {project.client_name || project.client_id}</small></div><div><span className="directory-badge">{project.status || 'ACTIVE'}</span><small>{project.province || 'Wilayah belum diisi'}</small></div></div>)}
            {!visibleProjects.length ? <p className="directory-empty">Belum ada project.</p> : null}
          </div>
        </div>
      )}
      {mode ? <div className="directory-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setMode(null); }}>
        <div className="directory-modal" role="dialog" aria-modal="true" aria-label={`Tambah ${mode}`}>
          <div className="directory-modal-title"><div><span>MASTER DATA</span><h3>Tambah {mode === 'client' ? 'Klien' : 'Project'}</h3></div><button type="button" aria-label="Tutup" onClick={() => setMode(null)}>✕</button></div>
          <label>Kode<input value={form.code} maxLength={30} placeholder={mode === 'client' ? 'Contoh: IAP' : 'Contoh: IAP-SUMUT'} onChange={(event) => setForm({ ...form, code: event.target.value.toUpperCase() })} /></label>
          <label>Nama<input value={form.name} maxLength={160} placeholder={mode === 'client' ? 'Nama perusahaan' : 'Nama project'} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
          {mode === 'project' ? <>
            <label>Klien<select value={form.clientId} onChange={(event) => setForm({ ...form, clientId: event.target.value })}><option value="">Pilih klien</option>{visibleClients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select></label>
            <label>Provinsi<input value={form.province} placeholder="Contoh: Sumatera Utara" onChange={(event) => setForm({ ...form, province: event.target.value })} /></label>
            <div className="directory-form-grid"><label>Mulai<input type="date" value={form.startDate} onChange={(event) => setForm({ ...form, startDate: event.target.value })} /></label><label>Selesai<input type="date" value={form.endDate} onChange={(event) => setForm({ ...form, endDate: event.target.value })} /></label></div>
          </> : null}
          <div className="directory-modal-actions"><button type="button" className="btn" onClick={() => setMode(null)}>Batal</button><button type="button" className="btn btn-primary" disabled={saving || !form.code || !form.name || (mode === 'project' && !form.clientId)} onClick={() => void submit()}>{saving ? 'Menyimpan…' : 'Simpan'}</button></div>
        </div>
      </div> : null}
    </section>
  );
}
