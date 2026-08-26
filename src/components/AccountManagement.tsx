"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import type { AppRole } from "@/lib/app-settings";

type AccountStatus = "ACTIVE" | "SUSPENDED" | "INACTIVE";
type Account = {
  id: string;
  name: string;
  email: string;
  role: AppRole;
  status: AccountStatus;
  paymentApprover: boolean;
  mustChangePassword: boolean;
  clientIds: string[];
  projectIds: string[];
  lastLoginAt?: string | null;
  avatarUrl?: string | null;
  jobTitle?: string | null;
  department?: string | null;
  phone?: string | null;
};
type Client = { id: string; name: string };
type Project = {
  id: string;
  client_id: string;
  code: string;
  name: string;
  status: string;
};

const ROLES: Array<{ value: AppRole; label: string }> = [
  { value: "SUPER_ADMIN", label: "Super Admin" },
  { value: "PAYROLL_PROCESSOR", label: "Payroll Processor" },
  { value: "PAYROLL_CONTROLLER", label: "Payroll Controller" },
  { value: "CLIENT_USER", label: "Client User" },
];

async function accountRequest(payload?: Record<string, unknown>) {
  const response = await fetch(
    "/api/accounts",
    payload
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      : { headers: { Accept: "application/json" } },
  );
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

export default function AccountManagement() {
  const [users, setUsers] = useState<Account[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [credential, setCredential] = useState<{
    email: string;
    password: string;
  } | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState("");
  const [draft, setDraft] = useState({
    name: "",
    email: "",
    role: "PAYROLL_PROCESSOR" as AppRole,
    clientIds: [] as string[],
    projectIds: [] as string[],
    paymentApprover: false,
    avatarUrl: "",
    jobTitle: "",
    department: "",
    phone: "",
  });

  async function load() {
    setLoading(true);
    setError("");
    try {
      const data = await accountRequest();
      setUsers(data.users || []);
      setClients(data.clients || []);
      setProjects(data.projects || []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Akun gagal dimuat");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  function updateLocal(id: string, values: Partial<Account>) {
    setUsers((current) =>
      current.map((user) => (user.id === id ? { ...user, ...values } : user)),
    );
  }

  async function uploadPhoto(target: "draft" | string, file?: File) {
    if (!file || uploadingPhoto) return;
    setUploadingPhoto(target); setError("");
    try {
      const body = new FormData(); body.append("file", file);
      const response = await fetch("/api/portal-media", { method: "POST", body });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      if (target === "draft") setDraft((current) => ({ ...current, avatarUrl: data.url }));
      else updateLocal(target, { avatarUrl: data.url });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Upload foto gagal"); }
    finally { setUploadingPhoto(""); }
  }

  async function createAccount() {
    setBusy("create");
    setError("");
    setCredential(null);
    try {
      const data = await accountRequest({ action: "CREATE", ...draft });
      setCredential({
        email: data.user.email,
        password: data.temporaryPassword,
      });
      setDraft({
        name: "",
        email: "",
        role: "PAYROLL_PROCESSOR",
        clientIds: [],
        projectIds: [],
        paymentApprover: false,
        avatarUrl: "",
        jobTitle: "",
        department: "",
        phone: "",
      });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Akun gagal dibuat");
    } finally {
      setBusy("");
    }
  }

  async function saveAccount(user: Account) {
    setBusy(user.id);
    setError("");
    try {
      await accountRequest({
        action: "UPDATE",
        userId: user.id,
        name: user.name,
        role: user.role,
        status: user.status,
        paymentApprover: user.paymentApprover,
        clientIds: user.clientIds,
        projectIds: user.projectIds,
        avatarUrl: user.avatarUrl,
        jobTitle: user.jobTitle,
        department: user.department,
        phone: user.phone,
      });
      await load();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Perubahan gagal disimpan",
      );
      await load();
    } finally {
      setBusy("");
    }
  }

  async function resetPassword(user: Account) {
    setBusy(`password-${user.id}`);
    setError("");
    setCredential(null);
    try {
      const data = await accountRequest({
        action: "RESET_PASSWORD",
        userId: user.id,
      });
      setCredential({ email: user.email, password: data.temporaryPassword });
      await load();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Password gagal direset",
      );
    } finally {
      setBusy("");
    }
  }

  const needsClient = draft.role === "CLIENT_USER";
  return (
    <div className="account-management">
      <div className="account-role-summary">
        {ROLES.map((role) => (
          <div key={role.value}>
            <strong>{role.label}</strong>
            <span>
              {role.value === "SUPER_ADMIN"
                ? "Seluruh akses dan konfigurasi"
                : role.value === "PAYROLL_PROCESSOR"
                  ? "Intake, validasi, normalisasi, dan payroll"
                  : role.value === "PAYROLL_CONTROLLER"
                    ? "Review, kontrol, payment instruction"
                    : "Akses terbatas pada klien yang ditetapkan"}
            </span>
          </div>
        ))}
      </div>

      <div className="account-create-panel">
        <div className="account-panel-heading">
          <div>
            <strong>Tambah akun</strong>
            <span>Buat akses baru sesuai tanggung jawab pengguna.</span>
          </div>
          <span>NEW USER</span>
        </div>
        <div className="account-create-grid">
          <label>
            <span>Nama lengkap</span>
            <input
              value={draft.name}
              onChange={(event) =>
                setDraft({ ...draft, name: event.target.value })
              }
              placeholder="Nama pengguna"
            />
          </label>
          <label>
            <span>Email login</span>
            <input
              type="email"
              value={draft.email}
              onChange={(event) =>
                setDraft({ ...draft, email: event.target.value })
              }
              placeholder="nama@perusahaan.com"
            />
          </label>
          <label>
            <span>Role</span>
            <select
              value={draft.role}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  role: event.target.value as AppRole,
                  clientIds: [],
                  projectIds: [],
                })
              }
            >
              {ROLES.map((role) => (
                <option key={role.value} value={role.value}>
                  {role.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Jabatan</span>
            <input
              value={draft.jobTitle}
              onChange={(event) =>
                setDraft({ ...draft, jobTitle: event.target.value })
              }
              placeholder="Payroll Manager"
            />
          </label>
          <label>
            <span>Departemen</span>
            <input
              value={draft.department}
              onChange={(event) =>
                setDraft({ ...draft, department: event.target.value })
              }
              placeholder="Finance / HR"
            />
          </label>
          <label>
            <span>Nomor telepon</span>
            <input
              value={draft.phone}
              onChange={(event) =>
                setDraft({ ...draft, phone: event.target.value })
              }
              placeholder="+62 812…"
            />
          </label>
          <label className="account-photo-field portal-upload">
            <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" disabled={Boolean(uploadingPhoto)} onChange={(event) => void uploadPhoto("draft", event.target.files?.[0])} />
            <span className="portal-upload-icon">↑</span><span><strong>{uploadingPhoto === "draft" ? "Mengunggah…" : "Upload foto profil"}</strong><small>JPG, PNG, WebP, atau GIF · maks. 5 MB</small></span><b>{draft.avatarUrl ? "Ganti" : "Pilih file"}</b>
          </label>
          {draft.role === "PAYROLL_CONTROLLER" ? (
            <label className="account-check">
              <input
                type="checkbox"
                checked={draft.paymentApprover}
                onChange={(event) =>
                  setDraft({ ...draft, paymentApprover: event.target.checked })
                }
              />
              <span>Berikan permission PAYMENT_APPROVER</span>
            </label>
          ) : null}
        </div>
        {needsClient ? (
          <AccessScopes
            clients={clients}
            projects={projects}
            clientIds={draft.clientIds}
            projectIds={draft.projectIds}
            onChange={(clientIds, projectIds) =>
              setDraft({ ...draft, clientIds, projectIds })
            }
          />
        ) : null}
        <div className="account-create-actions">
          <span>
            Password sementara dibuat otomatis dan wajib diganti saat login
            pertama.
          </span>
          <button
            type="button"
            className="btn btn-primary"
            disabled={
              busy === "create" ||
              !draft.name.trim() ||
              !draft.email.trim() ||
              (needsClient && !draft.clientIds.length)
            }
            onClick={() => void createAccount()}
          >
            {busy === "create" ? "Membuat…" : "Buat akun"}
          </button>
        </div>
      </div>

      {credential ? (
        <div className="account-credential" role="status">
          <div>
            <strong>Password sementara — hanya ditampilkan sekali</strong>
            <span>{credential.email}</span>
          </div>
          <code>{credential.password}</code>
          <button
            type="button"
            className="btn"
            onClick={() =>
              void navigator.clipboard.writeText(credential.password)
            }
          >
            Salin
          </button>
        </div>
      ) : null}
      {error ? (
        <div className="settings-status error" role="alert">
          {error}
        </div>
      ) : null}

      <div className="account-list-heading">
        <strong>Akun tersimpan di database</strong>
        <span>{users.length} akun</span>
      </div>
      {loading ? (
        <p className="account-empty">Memuat akun…</p>
      ) : users.length === 0 ? (
        <p className="account-empty">
          Belum ada akun. Buat Super Admin sebelum mengaktifkan login database.
        </p>
      ) : (
        <div className="account-list">
          {users.map((user) => (
            <article key={user.id} className="account-card">
              <div className="account-card-identity">
                {user.avatarUrl ? (
                <Image
                  className="account-avatar account-avatar-photo"
                  src={user.avatarUrl}
                  alt={`Foto ${user.name}`}
                  width={38}
                  height={38}
                  unoptimized
                />
                ) : (
                  <div className="account-avatar">
                    {user.name.slice(0, 2).toUpperCase()}
                  </div>
                )}
                <div>
                  <strong>{user.name}</strong>
                  <span>
                    {user.jobTitle || "Jabatan belum diisi"}
                    {user.department ? ` · ${user.department}` : ""}
                  </span>
                  <span>
                    {user.email} ·{" "}
                    {user.lastLoginAt
                      ? `Login ${new Date(user.lastLoginAt).toLocaleDateString("id-ID")}`
                      : "Belum pernah login"}
                  </span>
                </div>
              </div>
              <div className="account-card-fields">
                <label>
                  <span>Nama pengguna</span>
                  <input
                    aria-label={`Nama ${user.email}`}
                    value={user.name}
                    onChange={(event) =>
                      updateLocal(user.id, { name: event.target.value })
                    }
                  />
                </label>
                <label>
                  <span>Role</span>
                  <select
                    aria-label={`Role ${user.email}`}
                    value={user.role}
                    onChange={(event) =>
                      updateLocal(user.id, {
                        role: event.target.value as AppRole,
                        clientIds: [],
                        projectIds: [],
                      })
                    }
                  >
                    {ROLES.map((role) => (
                      <option key={role.value} value={role.value}>
                        {role.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Status</span>
                  <select
                    aria-label={`Status ${user.email}`}
                    value={user.status}
                    onChange={(event) =>
                      updateLocal(user.id, {
                        status: event.target.value as AccountStatus,
                      })
                    }
                  >
                    <option value="ACTIVE">Aktif</option>
                    <option value="SUSPENDED">Ditangguhkan</option>
                    <option value="INACTIVE">Nonaktif</option>
                  </select>
                </label>
                <label className="account-approver">
                  <span>Approval PI</span>
                  <span>
                    <input
                      type="checkbox"
                      disabled={user.role !== "PAYROLL_CONTROLLER"}
                      checked={
                        user.role === "PAYROLL_CONTROLLER" &&
                        user.paymentApprover
                      }
                      onChange={(event) =>
                        updateLocal(user.id, {
                          paymentApprover: event.target.checked,
                        })
                      }
                    />{" "}
                    Approver
                  </span>
                </label>
              </div>
              <div className="account-profile-fields">
                <label>
                  <span>Jabatan</span>
                  <input
                    value={user.jobTitle || ""}
                    onChange={(event) =>
                      updateLocal(user.id, { jobTitle: event.target.value })
                    }
                  />
                </label>
                <label>
                  <span>Departemen</span>
                  <input
                    value={user.department || ""}
                    onChange={(event) =>
                      updateLocal(user.id, { department: event.target.value })
                    }
                  />
                </label>
                <label>
                  <span>Telepon</span>
                  <input
                    value={user.phone || ""}
                    onChange={(event) =>
                      updateLocal(user.id, { phone: event.target.value })
                    }
                  />
                </label>
                <label className="portal-upload">
                  <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" disabled={Boolean(uploadingPhoto)} onChange={(event) => void uploadPhoto(user.id, event.target.files?.[0])} />
                  <span className="portal-upload-icon">↑</span><span><strong>{uploadingPhoto === user.id ? "Mengunggah…" : "Upload foto"}</strong><small>File gambar · maks. 5 MB</small></span><b>{user.avatarUrl ? "Ganti" : "Pilih"}</b>
                </label>
              </div>
              <div className="account-fields">
                {user.role === "CLIENT_USER" ? (
                  <AccessScopes
                    clients={clients}
                    projects={projects}
                    clientIds={user.clientIds}
                    projectIds={user.projectIds || []}
                    onChange={(clientIds, projectIds) =>
                      updateLocal(user.id, { clientIds, projectIds })
                    }
                    compact
                  />
                ) : null}
              </div>
              <div className="account-actions">
                <button
                  type="button"
                  className="btn"
                  disabled={Boolean(busy)}
                  onClick={() => void resetPassword(user)}
                >
                  Reset password
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={Boolean(busy)}
                  onClick={() => void saveAccount(user)}
                >
                  {busy === user.id ? "Menyimpan…" : "Simpan"}
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

function AccessScopes({
  clients,
  projects,
  clientIds,
  projectIds,
  onChange,
  compact = false,
}: {
  clients: Client[];
  projects: Project[];
  clientIds: string[];
  projectIds: string[];
  onChange: (clientIds: string[], projectIds: string[]) => void;
  compact?: boolean;
}) {
  return (
    <div className={`client-scope-picker${compact ? " compact" : ""}`}>
      <span>Pasangkan akses klien dan project</span>
      <div>
        {clients.length ? (
          clients.map((client) => {
            const selected = clientIds.includes(client.id);
            const clientProjects = projects.filter(
              (project) => project.client_id === client.id,
            );
            return (
              <div key={client.id} style={{ display: "grid", gap: 4 }}>
                <label>
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={(event) => {
                      const nextClients = event.target.checked
                        ? [...clientIds, client.id]
                        : clientIds.filter((id) => id !== client.id);
                      const nextProjects = event.target.checked
                        ? projectIds
                        : projectIds.filter(
                            (id) =>
                              !clientProjects.some(
                                (project) => project.id === id,
                              ),
                          );
                      onChange(nextClients, nextProjects);
                    }}
                  />{" "}
                  <strong>{client.name}</strong>
                </label>
                {selected && clientProjects.length ? (
                  <div style={{ display: "grid", paddingLeft: 22, gap: 3 }}>
                    {clientProjects.map((project) => (
                      <label key={project.id}>
                        <input
                          type="checkbox"
                          checked={projectIds.includes(project.id)}
                          onChange={(event) =>
                            onChange(
                              clientIds,
                              event.target.checked
                                ? [...projectIds, project.id]
                                : projectIds.filter((id) => id !== project.id),
                            )
                          }
                        />{" "}
                        {project.name}
                      </label>
                    ))}
                    <em style={{ fontSize: 10 }}>
                      Tanpa project dipilih = akses seluruh project klien
                    </em>
                  </div>
                ) : null}
              </div>
            );
          })
        ) : (
          <em>Belum ada klien. Tambahkan klien terlebih dahulu.</em>
        )}
      </div>
    </div>
  );
}
