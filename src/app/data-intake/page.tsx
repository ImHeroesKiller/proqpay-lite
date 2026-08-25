"use client";

import { DragEvent, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { parseIapWorkbook } from "@/lib/excel-iap";
import { formatIDR } from "@/lib/format";
import Sidebar, { type AppView } from "@/components/Sidebar";
import { IconMenu } from "@/components/Icons";
import {
  PAYROLL_TEMPLATE_URL,
  PAYROLL_TEMPLATE_VERSION,
} from "@/lib/payroll-template";

type Client = { id: string; code: string; name: string };
type Project = { id: string; client_id: string; name: string };
type Plan = {
  id: string;
  client_id: string;
  project_id: string | null;
  tier: string;
  effective_from: string;
  effective_until: string | null;
};
type Setup = { clients: Client[]; projects: Project[]; servicePlans: Plan[] };
type Resolution = "NO_PAY_THIS_PERIOD" | "RESIGNED" | "TRANSFERRED" | "OTHER";
type MissingResolution = { resolution: Resolution; note?: string };
type Parsed = Awaited<ReturnType<typeof parseIapWorkbook>>;
type Preview = {
  batchId: string;
  confirmed?: boolean;
  comparison?: Record<string, number>;
  changes?: Array<{
    employeeId: string;
    row: number;
    nrk: string;
    name: string;
    changedFields: string[];
  }>;
  newEmployees?: Array<{ nrk: string; name: string }>;
  missing?: Array<{ employeeId: string; nrk: string; name: string }>;
  confirmation?: Record<string, unknown>;
};

export default function DataIntakePage() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [actor, setActor] = useState<{ email: string; role: string } | null>(
    null,
  );
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [setup, setSetup] = useState<Setup>({
    clients: [],
    projects: [],
    servicePlans: [],
  });
  const [form, setForm] = useState({
    clientId: "",
    projectId: "",
    period: new Date().toISOString().slice(0, 7),
  });
  const [file, setFile] = useState<File | null>(null);
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [resolutions, setResolutions] = useState<
    Record<string, MissingResolution>
  >({});
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [issues, setIssues] = useState<
    Array<{ row?: number; field?: string; message: string }>
  >([]);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([
      fetch("/api/me", { signal: controller.signal, cache: "no-store" })
        .then(readJson)
        .then((x) => x.user),
      fetch("/api/payroll-intake-setup", {
        signal: controller.signal,
        cache: "no-store",
      }).then(readJson),
    ])
      .then(([user, data]) => {
        setActor(user);
        setSetup({
          clients: data.clients || [],
          projects: data.projects || [],
          servicePlans: data.servicePlans || [],
        });
      })
      .catch((error) => {
        if (error.name !== "AbortError") setMessage(error.message);
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, []);

  const projects = useMemo(
    () =>
      setup.projects.filter((project) => project.client_id === form.clientId),
    [setup.projects, form.clientId],
  );
  const plans = useMemo(() => {
    if (!form.period) return [];
    const start = `${form.period}-01`;
    const [year, month] = form.period.split("-").map(Number);
    const end = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
    const candidates = setup.servicePlans.filter(
      (item) =>
        item.client_id === form.clientId &&
        (!item.project_id || item.project_id === form.projectId) &&
        item.effective_from <= end &&
        (!item.effective_until || item.effective_until >= start),
    );
    const exact = candidates.filter(
      (item) => item.project_id === form.projectId,
    );
    return exact.length ? exact : candidates.filter((item) => !item.project_id);
  }, [setup.servicePlans, form]);
  const plan = plans[0];
  const client = setup.clients.find((item) => item.id === form.clientId);
  const project = projects.find((item) => item.id === form.projectId);
  const contextReady = Boolean(client && project && plan && form.period);
  const progress = preview?.confirmed ? 4 : preview ? 3 : parsed ? 2 : 1;
  const notesComplete = (preview?.missing || []).every((item) => {
    const value = resolutions[item.employeeId];
    return (
      value &&
      !(
        ["TRANSFERRED", "OTHER"].includes(value.resolution) ||
        value.note?.trim()
      )
    );
  });

  function resetFile() {
    setFile(null);
    setParsed(null);
    setPreview(null);
    setResolutions({});
    setIssues([]);
    if (inputRef.current) inputRef.current.value = "";
  }
  async function choose(chosen: File) {
    setBusy(true);
    setMessage("");
    setIssues([]);
    setPreview(null);
    try {
      if (!/\.xlsx?$/i.test(chosen.name))
        throw new Error("Gunakan file Excel berformat .xlsx atau .xls");
      if (chosen.size > 8 * 1024 * 1024)
        throw new Error("Ukuran file maksimal 8 MB");
      const result = await parseIapWorkbook(await chosen.arrayBuffer());
      if (!result.rows.length)
        throw new Error(
          "Tidak ada baris dengan NRK dan Nama Karyawan yang dapat dibaca",
        );
      setFile(chosen);
      setParsed(result);
      if (result.skipped || result.duplicateRows)
        setMessage(
          `${result.rows.length} baris siap. ${result.skipped} baris dilewati dan ${result.duplicateRows} NRK duplikat diabaikan.`,
        );
    } catch (error) {
      resetFile();
      setMessage(error instanceof Error ? error.message : "File gagal dibaca");
    } finally {
      setBusy(false);
    }
  }
  function drop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    const chosen = event.dataTransfer.files?.[0];
    if (chosen && contextReady) void choose(chosen);
  }
  async function upload() {
    if (!file || !parsed || !client || !project || !plan) return;
    setBusy(true);
    setMessage("");
    setIssues([]);
    try {
      const data = new FormData();
      data.set("file", file);
      data.set("rows", JSON.stringify(parsed.rows));
      data.set(
        "context",
        JSON.stringify({
          clientId: client.id,
          clientCode: client.code,
          projectId: project.id,
          period: form.period,
          servicePlanId: plan.id,
        }),
      );
      data.set("sourceSheet", parsed.sheetName || "01_PAYROLL_DATA");
      data.set("rawRowCount", String(parsed.totalRaw || parsed.rows.length));
      data.set("templateVersion", PAYROLL_TEMPLATE_VERSION);
      const payload = await readJson(
        await fetch("/api/payroll-intake", { method: "POST", body: data }),
      );
      setPreview(payload);
      const initial: Record<string, MissingResolution> = {};
      (payload.missing || []).forEach((item: { employeeId: string }) => {
        initial[item.employeeId] = { resolution: "NO_PAY_THIS_PERIOD" };
      });
      setResolutions(initial);
      setMessage(
        payload.missing?.length
          ? "Analisis selesai. Lengkapi keputusan untuk karyawan yang tidak muncul."
          : "Analisis selesai. Data siap dikonfirmasi.",
      );
    } catch (error) {
      const enriched = error as Error & { issues?: typeof issues };
      setIssues(enriched.issues || []);
      setMessage(enriched.message || "Upload gagal");
    } finally {
      setBusy(false);
    }
  }
  async function confirm() {
    if (!preview?.batchId || !notesComplete) return;
    setBusy(true);
    setMessage("");
    setIssues([]);
    try {
      const payload = await readJson(
        await fetch("/api/payroll-intake", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "CONFIRM",
            batchId: preview.batchId,
            missingResolutions: resolutions,
          }),
        }),
      );
      setPreview({ ...preview, confirmed: true, confirmation: payload });
      setMessage(
        `Intake ${form.period} dikonfirmasi. ${payload.employees ?? "Semua"} karyawan masuk Pay Run.`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Konfirmasi gagal");
    } finally {
      setBusy(false);
    }
  }

  function navigate(view: AppView) {
    router.push(`/?view=${view}`);
  }

  return (
    <div className="app-shell data-intake-app">
      <Sidebar
        view="operations"
        activePath="data-intake"
        onView={navigate}
        onOpenIda={() => navigate("dashboard")}
        onOpenHelp={() => navigate("dashboard")}
        role={actor?.role}
        mobileOpen={mobileNavOpen}
        onMobileClose={() => setMobileNavOpen(false)}
        settingsOpen={settingsOpen}
        onSettingsOpen={setSettingsOpen}
      />
      <main className="data-intake-page">
        <div className="data-intake-shell">
          <header className="data-intake-heading">
            <div>
              <button
                type="button"
                className="header-menu-button data-intake-menu-button"
                aria-label="Buka navigasi"
                onClick={() => setMobileNavOpen(true)}
              >
                <IconMenu aria-hidden="true" />
              </button>
              <span className="page-eyebrow">Payroll operations</span>
              <h1>Data Intake Payroll</h1>
              <p>
                Validasi file, bandingkan dengan master aktif, lalu konfirmasi
                snapshot Pay Run dalam satu alur yang terkontrol.
              </p>
            </div>
            <div className="data-intake-heading-actions">
              <Link className="btn" href="/?view=operations">
                ← Pay Runs
              </Link>
            </div>
          </header>
          <ol
            className="intake-stepper"
            aria-label={`Langkah ${progress} dari 4`}
          >
            {[
              "Tentukan scope",
              "Unggah & validasi",
              "Review perubahan",
              "Konfirmasi Pay Run",
            ].map((label, index) => (
              <li
                key={label}
                className={
                  index + 1 < progress
                    ? "done"
                    : index + 1 === progress
                      ? "active"
                      : ""
                }
              >
                <span>{index + 1 < progress ? "✓" : index + 1}</span>
                <div>
                  <strong>{label}</strong>
                  <small>
                    {
                      [
                        "Client, project, periode",
                        "Cek format dan control total",
                        "Master baru, berubah, hilang",
                        "Simpan history dan snapshot",
                      ][index]
                    }
                  </small>
                </div>
              </li>
            ))}
          </ol>
          {message ? (
            <div
              role="status"
              className={`app-notice-bubble ${/gagal|error|tidak|wajib|valid/i.test(message) ? "app-notice-error" : "app-notice-info"}`}
            >
              <strong>
                {/gagal|error|tidak|wajib|valid/i.test(message)
                  ? "Perlu perhatian"
                  : "Informasi"}
              </strong>
              <span>{message}</span>
            </div>
          ) : null}
          {issues.length ? (
            <section className="intake-issues" role="alert">
              <strong>{issues.length} masalah perlu diperbaiki di file</strong>
              <ul>
                {issues.slice(0, 8).map((issue, index) => (
                  <li key={`${issue.row}-${issue.field}-${index}`}>
                    {issue.row ? `Baris ${issue.row} · ` : ""}
                    {issue.message}
                  </li>
                ))}
              </ul>
              {issues.length > 8 ? (
                <small>Dan {issues.length - 8} masalah lainnya.</small>
              ) : null}
            </section>
          ) : null}
          <div className="intake-layout">
            <section className="card intake-main-card">
              <div className="panel-heading">
                <div>
                  <span className="panel-eyebrow">1 · Scope payroll</span>
                  <h2>Pilih sumber intake</h2>
                </div>
                {file || preview ? (
                  <button
                    className="btn btn-quiet"
                    type="button"
                    onClick={resetFile}
                  >
                    Mulai ulang
                  </button>
                ) : null}
              </div>
              <div className="intake-form-grid">
                <label>
                  <span>Client</span>
                  <select
                    value={form.clientId}
                    disabled={loading || Boolean(preview)}
                    onChange={(event) => {
                      setForm({
                        clientId: event.target.value,
                        projectId: "",
                        period: form.period,
                      });
                      resetFile();
                    }}
                  >
                    <option value="">Pilih client</option>
                    {setup.clients.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Project</span>
                  <select
                    value={form.projectId}
                    disabled={!form.clientId || Boolean(preview)}
                    onChange={(event) => {
                      setForm({ ...form, projectId: event.target.value });
                      resetFile();
                    }}
                  >
                    <option value="">Pilih project</option>
                    {projects.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Periode payroll</span>
                  <input
                    type="month"
                    value={form.period}
                    disabled={Boolean(preview)}
                    onChange={(event) => {
                      setForm({ ...form, period: event.target.value });
                      resetFile();
                    }}
                  />
                </label>
                <label>
                  <span>Service tier</span>
                  <input
                    readOnly
                    value={
                      plan
                        ? plan.tier.replaceAll("_", " ")
                        : client && project
                          ? "Belum ada tier aktif"
                          : "Pilih scope terlebih dahulu"
                    }
                  />
                </label>
              </div>
              <div
                className={`intake-dropzone${dragging ? " is-dragging" : ""}${!contextReady ? " is-disabled" : ""}`}
                onDragOver={(event) => {
                  event.preventDefault();
                  if (contextReady) setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={drop}
              >
                <input
                  ref={inputRef}
                  hidden
                  type="file"
                  accept=".xlsx,.xls"
                  onChange={(event) => {
                    const chosen = event.target.files?.[0];
                    if (chosen) void choose(chosen);
                  }}
                />
                <div className="intake-file-icon">XLSX</div>
                <div>
                  <strong>
                    {file ? file.name : "Tarik file Excel ke sini"}
                  </strong>
                  <span>
                    {file
                      ? `${(file.size / 1024).toFixed(0)} KB · ${parsed?.rows.length || 0} karyawan terbaca`
                      : "Atau pilih file .xlsx/.xls, maksimal 8 MB"}
                  </span>
                </div>
                <button
                  className="btn"
                  type="button"
                  disabled={busy || !contextReady || Boolean(preview)}
                  onClick={() => inputRef.current?.click()}
                >
                  {busy ? "Membaca…" : file ? "Ganti file" : "Pilih file"}
                </button>
              </div>
              {parsed ? (
                <>
                  <div className="intake-metrics">
                    <Metric
                      label="Karyawan valid"
                      value={String(parsed.rows.length)}
                      note={`${parsed.duplicateRows} duplikat`}
                    />
                    <Metric
                      label="Gross"
                      value={formatIDR(parsed.payrollSummary.gross)}
                    />
                    <Metric
                      label="Deduction"
                      value={formatIDR(parsed.payrollSummary.deductions)}
                    />
                    <Metric
                      label="Net / THP"
                      value={formatIDR(parsed.payrollSummary.net)}
                    />
                  </div>
                  {!preview ? (
                    <div className="intake-primary-action">
                      <span>
                        File hanya menjadi sumber canonical setelah review dan
                        konfirmasi.
                      </span>
                      <button
                        className="btn btn-primary"
                        disabled={busy || !plan}
                        onClick={() => void upload()}
                      >
                        {busy ? "Menganalisis…" : "Upload & Analisis →"}
                      </button>
                    </div>
                  ) : null}
                </>
              ) : null}
            </section>
            <aside className="card intake-guide">
              <span className="panel-eyebrow">Template contract</span>
              <h2>Siapkan file dengan benar</h2>
              <a
                className="intake-template-link"
                href={PAYROLL_TEMPLATE_URL}
                download
              >
                <strong>ProQPay Data Intake v1</strong>
                <span>
                  Petunjuk, contoh, dan control total tersedia di dalam
                  workbook.
                </span>
                <b>Unduh .xlsx →</b>
              </a>
              <ul>
                <li>NRK dan nama wajib serta unik.</li>
                <li>Bank dan nomor rekening 6–34 digit wajib.</li>
                <li>Gross − Deduct harus sama dengan Netto.</li>
                <li>Komponen pendapatan dan potongan harus balance.</li>
              </ul>
              <small>{PAYROLL_TEMPLATE_VERSION} · Maks. 8 MB</small>
            </aside>
          </div>
          {preview ? (
            <section className="card intake-review">
              <div className="panel-heading">
                <div>
                  <span className="panel-eyebrow">3 · Backend comparison</span>
                  <h2>Review dampak ke master data</h2>
                </div>
                <span
                  className={`intake-status ${preview.confirmed ? "success" : "warning"}`}
                >
                  {preview.confirmed ? "Confirmed" : "Review required"}
                </span>
              </div>
              <div className="intake-metrics">
                <Metric
                  label="Matched"
                  value={String(preview.comparison?.matched || 0)}
                />
                <Metric
                  label="Employee baru"
                  value={String(preview.comparison?.new || 0)}
                />
                <Metric
                  label="Data berubah"
                  value={String(preview.comparison?.changed || 0)}
                />
                <Metric
                  label="Tidak muncul"
                  value={String(preview.comparison?.missing || 0)}
                />
              </div>
              {(preview.changes || []).length ? (
                <details open>
                  <summary>
                    Perubahan master terdeteksi <b>{preview.changes?.length}</b>
                  </summary>
                  <div className="intake-change-list">
                    {preview.changes?.slice(0, 30).map((item) => (
                      <div key={`${item.employeeId}-${item.row}`}>
                        <strong>
                          {item.nrk} · {item.name}
                        </strong>
                        <small>{item.changedFields.join(", ")}</small>
                      </div>
                    ))}
                  </div>
                </details>
              ) : null}
              {(preview.newEmployees || []).length ? (
                <details>
                  <summary>
                    Employee baru <b>{preview.newEmployees?.length}</b>
                  </summary>
                  <div className="intake-inline-list">
                    {preview.newEmployees
                      ?.map((item) => `${item.nrk} · ${item.name}`)
                      .join(", ")}
                  </div>
                </details>
              ) : null}
              {(preview.missing || []).length ? (
                <div className="intake-missing">
                  <div>
                    <strong>
                      Karyawan tidak terdapat pada payroll {form.period}
                    </strong>
                    <span>
                      Setiap karyawan membutuhkan keputusan eksplisit. Catatan
                      wajib untuk mutasi dan alasan lainnya.
                    </span>
                  </div>
                  {preview.missing?.map((item) => {
                    const value = resolutions[item.employeeId] || {
                      resolution: "NO_PAY_THIS_PERIOD" as Resolution,
                    };
                    const noteRequired = ["TRANSFERRED", "OTHER"].includes(
                      value.resolution,
                    );
                    return (
                      <div className="intake-missing-row" key={item.employeeId}>
                        <div>
                          <strong>{item.nrk}</strong>
                          <small>{item.name}</small>
                        </div>
                        <select
                          value={value.resolution}
                          onChange={(event) =>
                            setResolutions({
                              ...resolutions,
                              [item.employeeId]: {
                                ...value,
                                resolution: event.target.value as Resolution,
                              },
                            })
                          }
                        >
                          <option value="NO_PAY_THIS_PERIOD">
                            Tidak menerima gaji
                          </option>
                          <option value="RESIGNED">Resign / terminated</option>
                          <option value="TRANSFERRED">Mutasi project</option>
                          <option value="OTHER">Lainnya</option>
                        </select>
                        <input
                          aria-label={`Catatan untuk ${item.name}`}
                          required={noteRequired}
                          placeholder={
                            noteRequired ? "Catatan wajib" : "Catatan opsional"
                          }
                          value={value.note || ""}
                          onChange={(event) =>
                            setResolutions({
                              ...resolutions,
                              [item.employeeId]: {
                                ...value,
                                note: event.target.value,
                              },
                            })
                          }
                        />
                      </div>
                    );
                  })}
                </div>
              ) : null}
              {!preview.confirmed ? (
                <div className="intake-confirm">
                  <div>
                    <strong>Siap membuat Pay Run?</strong>
                    <span>
                      Konfirmasi akan memperbarui current master, menyimpan
                      history, dan membuat snapshot periode.
                    </span>
                  </div>
                  <button
                    className="btn btn-primary"
                    disabled={busy || !notesComplete}
                    onClick={() => void confirm()}
                  >
                    {busy ? "Menyimpan…" : "Konfirmasi Intake & Buat Pay Run"}
                  </button>
                </div>
              ) : (
                <div className="intake-complete">
                  <div>
                    <strong>Intake selesai</strong>
                    <span>
                      Master, history, dan snapshot Pay Run telah tersimpan.
                    </span>
                  </div>
                  <Link className="btn btn-primary" href="/?view=operations">
                    Buka Pay Run →
                  </Link>
                </div>
              )}
            </section>
          ) : null}
          <footer className="intake-footer">
            <span>Login: {actor?.email || "Memuat…"}</span>
            <span>
              File sumber disimpan private di R2 · Data canonical dan history
              tersimpan di D1
            </span>
          </footer>
        </div>
      </main>
    </div>
  );
}

async function readJson(response: Response) {
  const payload = await response
    .json()
    .catch(() => ({ error: `HTTP ${response.status}` }));
  if (!response.ok) {
    const error = new Error(
      payload.error || `HTTP ${response.status}`,
    ) as Error & {
      issues?: Array<{ row?: number; field?: string; message: string }>;
    };
    error.issues = payload.issues;
    throw error;
  }
  return payload;
}
function Metric({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note?: string;
}) {
  return (
    <div className="intake-metric">
      <span>{label}</span>
      <strong>{value}</strong>
      {note ? <small>{note}</small> : null}
    </div>
  );
}
