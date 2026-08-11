'use client';

import { useEffect, useState } from 'react';
import type { AppRole } from '@/lib/app-settings';

type AccountStatus = 'ACTIVE' | 'SUSPENDED' | 'INACTIVE';
type Account = {
  id: string;
  name: string;
  email: string;
  role: AppRole;
  status: AccountStatus;
  paymentApprover: boolean;
  mustChangePassword: boolean;
  clientIds: string[];
  lastLoginAt?: string | null;
};
type Client = { id: string; name: string };

const ROLES: Array<{ value: AppRole; label: string }> = [
  { value: 'SUPER_ADMIN', label: 'Super Admin' },
  { value: 'PAYROLL_PROCESSOR', label: 'Payroll Processor' },
  { value: 'PAYROLL_CONTROLLER', label: 'Payroll Controller' },
  { value: 'CLIENT_USER', label: 'Client User' },
];

async function accountRequest(payload?: Record<string, unknown>) {
  const response = await fetch('/api/accounts', payload ? {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  } : { headers: { Accept: 'application/json' } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

export default function AccountManagement() {
  const [users, setUsers] = useState<Account[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [credential, setCredential] = useState<{ email: string; password: string } | null>(null);
  const [draft, setDraft] = useState({ name: '', email: '', role: 'PAYROLL_PROCESSOR' as AppRole, clientIds: [] as string[], paymentApprover: false });

  async function load() {
    setLoading(true);
    setError('');
    try {
      const data = await accountRequest();
      setUsers(data.users || []);
      setClients(data.clients || []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Akun gagal dimuat');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  function updateLocal(id: string, values: Partial<Account>) {
    setUsers((current) => current.map((user) => user.id === id ? { ...user, ...values } : user));
  }

  async function createAccount() {
    setBusy('create'); setError(''); setCredential(null);
    try {
      const data = await accountRequest({ action: 'CREATE', ...draft });
      setCredential({ email: data.user.email, password: data.temporaryPassword });
      setDraft({ name: '', email: '', role: 'PAYROLL_PROCESSOR', clientIds: [], paymentApprover: false });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Akun gagal dibuat');
    } finally { setBusy(''); }
  }

  async function saveAccount(user: Account) {
    setBusy(user.id); setError('');
    try {
      await accountRequest({ action: 'UPDATE', userId: user.id, name: user.name, role: user.role, status: user.status, paymentApprover: user.paymentApprover, clientIds: user.clientIds });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Perubahan gagal disimpan');
      await load();
    } finally { setBusy(''); }
  }

  async function resetPassword(user: Account) {
    setBusy(`password-${user.id}`); setError(''); setCredential(null);
    try {
      const data = await accountRequest({ action: 'RESET_PASSWORD', userId: user.id });
      setCredential({ email: user.email, password: data.temporaryPassword });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Password gagal direset');
    } finally { setBusy(''); }
  }

  const needsClient = draft.role === 'CLIENT_USER';
  return <div className="account-management">
    <div className="account-role-summary">
      {ROLES.map((role) => <div key={role.value}><strong>{role.label}</strong><span>{role.value === 'SUPER_ADMIN' ? 'Seluruh akses dan konfigurasi' : role.value === 'PAYROLL_PROCESSOR' ? 'Intake, validasi, normalisasi, dan payroll' : role.value === 'PAYROLL_CONTROLLER' ? 'Review, kontrol, payment instruction' : 'Akses terbatas pada klien yang ditetapkan'}</span></div>)}
    </div>

    <div className="account-create-grid">
      <label><span>Nama lengkap</span><input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="Nama pengguna" /></label>
      <label><span>Email login</span><input type="email" value={draft.email} onChange={(event) => setDraft({ ...draft, email: event.target.value })} placeholder="nama@perusahaan.com" /></label>
      <label><span>Role</span><select value={draft.role} onChange={(event) => setDraft({ ...draft, role: event.target.value as AppRole, clientIds: [] })}>{ROLES.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}</select></label>
      {draft.role === 'PAYROLL_CONTROLLER' ? <label className="account-check"><input type="checkbox" checked={draft.paymentApprover} onChange={(event) => setDraft({ ...draft, paymentApprover: event.target.checked })} /><span>Berikan permission PAYMENT_APPROVER</span></label> : null}
    </div>
    {needsClient ? <ClientScopes clients={clients} selected={draft.clientIds} onChange={(clientIds) => setDraft({ ...draft, clientIds })} /> : null}
    <button type="button" className="btn btn-primary" disabled={busy === 'create' || !draft.name.trim() || !draft.email.trim() || (needsClient && !draft.clientIds.length)} onClick={() => void createAccount()}>{busy === 'create' ? 'Membuat…' : '+ Buat akun & password'}</button>

    {credential ? <div className="account-credential" role="status"><div><strong>Password sementara — hanya ditampilkan sekali</strong><span>{credential.email}</span></div><code>{credential.password}</code><button type="button" className="btn" onClick={() => void navigator.clipboard.writeText(credential.password)}>Salin</button></div> : null}
    {error ? <div className="settings-status error" role="alert">{error}</div> : null}

    <div className="account-list-heading"><strong>Akun tersimpan di database</strong><span>{users.length} akun</span></div>
    {loading ? <p className="account-empty">Memuat akun…</p> : users.length === 0 ? <p className="account-empty">Belum ada akun. Buat Super Admin sebelum mengaktifkan login database.</p> : <div className="account-list">
      {users.map((user) => <article key={user.id} className="account-card">
        <div className="account-avatar">{user.name.slice(0, 2).toUpperCase()}</div>
        <div className="account-fields">
          <input aria-label={`Nama ${user.email}`} value={user.name} onChange={(event) => updateLocal(user.id, { name: event.target.value })} />
          <span>{user.email} · {user.lastLoginAt ? `Login ${new Date(user.lastLoginAt).toLocaleDateString('id-ID')}` : 'Belum pernah login'}</span>
          {user.role === 'CLIENT_USER' ? <ClientScopes clients={clients} selected={user.clientIds} onChange={(clientIds) => updateLocal(user.id, { clientIds })} compact /> : null}
        </div>
        <select aria-label={`Role ${user.email}`} value={user.role} onChange={(event) => updateLocal(user.id, { role: event.target.value as AppRole, clientIds: [] })}>{ROLES.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}</select>
        <select aria-label={`Status ${user.email}`} value={user.status} onChange={(event) => updateLocal(user.id, { status: event.target.value as AccountStatus })}><option value="ACTIVE">Aktif</option><option value="SUSPENDED">Ditangguhkan</option><option value="INACTIVE">Nonaktif</option></select>
        <label className="account-approver"><input type="checkbox" disabled={user.role !== 'PAYROLL_CONTROLLER'} checked={user.role === 'PAYROLL_CONTROLLER' && user.paymentApprover} onChange={(event) => updateLocal(user.id, { paymentApprover: event.target.checked })} /> Approver</label>
        <div className="account-actions"><button type="button" className="btn" disabled={Boolean(busy)} onClick={() => void resetPassword(user)}>Reset password</button><button type="button" className="btn btn-primary" disabled={Boolean(busy)} onClick={() => void saveAccount(user)}>{busy === user.id ? 'Menyimpan…' : 'Simpan'}</button></div>
      </article>)}
    </div>}
  </div>;
}

function ClientScopes({ clients, selected, onChange, compact = false }: { clients: Client[]; selected: string[]; onChange: (ids: string[]) => void; compact?: boolean }) {
  return <div className={`client-scope-picker${compact ? ' compact' : ''}`}><span>Klien & seluruh project terkait</span><div>{clients.length ? clients.map((client) => <label key={client.id}><input type="checkbox" checked={selected.includes(client.id)} onChange={(event) => onChange(event.target.checked ? [...selected, client.id] : selected.filter((id) => id !== client.id))} /> {client.name}</label>) : <em>Belum ada klien. Tambahkan klien terlebih dahulu.</em>}</div></div>;
}
