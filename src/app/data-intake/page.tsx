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
type MissingResolution = { resolution: Resolution; note?: string; targetProjectId?: string };
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
    before?: Record<string, unknown> | null;
    after?: Record<string, unknown> | null;
  }>;
  newEmployees?: Array<{ nrk: string; name: string }>;
  transfers?: Array<{ employeeId:string; nrk:string; name:string; fromProjectId:string|null; toProjectId:string }>;
  missing?: Array<{ employeeId: string; nrk: string; name: string }>;
  diagnostics?: Array<{sheetName:string;headerRow:number|null;totalRaw:number;accepted:number;skipped:number;kind:string}>;
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
  const [transferConfirmations,setTransferConfirmations] = useState<Record<string,boolean>>({});
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [messageTone,setMessageTone] = useState<"info"|"success"|"error"|"warning">("info");
  const [issues, setIssues] = useState<
    Array<{ row?: number; field?: string; message: string }>
  >([]);
  const [dragging, setDragging] = useState(false);
  const [reviewFilter,setReviewFilter] = useState<"ALL"|"CHANGED"|"NEW"|"TRANSFER"|"MISSING">("ALL");

  useEffect(() => {
    const requestedPeriod = new URLSearchParams(window.location.search).get("period");
    if (requestedPeriod && /^\d{4}-\d{2}$/.test(requestedPeriod)) {
      setForm((current) => ({ ...current, period: requestedPeriod }));
    }
  }, []);

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
        if (error.name !== "AbortError") { setMessageTone("error"); setMessage(error.message); }
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, []);

  useEffect(()=>{
    const dirty=Boolean(preview?.batchId && !preview.confirmed);
    if(!dirty) return;
    const handler=(event:BeforeUnloadEvent)=>{
      event.preventDefault();
      event.returnValue="";
    };
    window.addEventListener("beforeunload",handler);
    return()=>window.removeEventListener("beforeunload",handler);
  },[preview?.batchId,preview?.confirmed]);

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
  const controlGross = parsed?.payrollSummary.gross || 0;
  const controlDeduction = parsed?.payrollSummary.deductions || 0;
  const controlNet = parsed?.payrollSummary.net || 0;
  const progress = preview?.confirmed ? 4 : preview ? 3 : parsed ? 2 : 1;
  const transfersComplete = (preview?.transfers || []).every((item)=>transferConfirmations[item.employeeId] === true);
  const notesComplete = (preview?.missing || []).every((item) => {
    const value = resolutions[item.employeeId];
    if (!value) return false;
    if (value.resolution === "TRANSFERRED") {
      return Boolean(value.note?.trim() && value.targetProjectId);
    }
    if (value.resolution === "OTHER") {
      return Boolean(value.note?.trim());
    }
    return true;
  });

  function resetFile() {
    setFile(null);
    setParsed(null);
    setPreview(null);
    setResolutions({});
    setTransferConfirmations({});
    setIssues([]);
    if (inputRef.current) inputRef.current.value = "";
  }
  async function restartIntake() {
    if (!preview?.batchId || preview.confirmed) { resetFile(); return; }
    setBusy(true); setMessage(""); setMessageTone("info");
    try {
      await readJson(await fetch("/api/payroll-intake",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({action:"RESET",batchId:preview.batchId}),
      }));
      resetFile();
      setMessageTone("success");
      setMessage("Draft intake dibatalkan. Anda dapat memilih file sumber baru.");
    } catch(error) {
      setMessageTone("error");
      setMessage(error instanceof Error ? error.message : "Reset intake gagal");
    } finally {
      setBusy(false);
    }
  }

  async function choose(chosen: File) {
    setBusy(true);
    setMessage("");
    setIssues([]);
    setPreview(null);
    try {
      if (!/\.xlsx$/i.test(chosen.name))
        throw new Error("Gunakan file Excel .xlsx sesuai template ProQPay v1");
      if (chosen.size > 8 * 1024 * 1024)
        throw new Error("Ukuran file maksimal 8 MB");
      const result = await parseIapWorkbook(await chosen.arrayBuffer());
      if (!result.rows.length)
        throw new Error(
          "Tidak ada baris dengan NRK dan Nama Karyawan yang dapat dibaca",
        );
      if (result.duplicateRows > 0)
        throw new Error(`Ditemukan ${result.duplicateRows} NRK duplikat. Perbaiki file sebelum melanjutkan.`);
      setFile(chosen);
      setParsed(result);
      if (result.skipped) {
        setMessageTone("warning");
        setMessage(`${result.rows.length} baris siap. ${result.skipped} baris tanpa NRK/Nama dilewati.`);
      }
    } catch (error) {
      resetFile();
      setMessageTone("error");
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
    setMessageTone("info");
    setIssues([]);
    try {
      const data = new FormData();
      data.set("file", file);
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
      const payload = await readJson(
        await fetch("/api/payroll-intake", { method: "POST", body: data }),
      );
      setPreview(payload);
      const initial: Record<string, MissingResolution> = {};
      (payload.missing || []).forEach((item: { employeeId: string }) => {
        initial[item.employeeId] = { resolution: "NO_PAY_THIS_PERIOD" };
      });
      setResolutions(initial);
      setTransferConfirmations(Object.fromEntries((payload.transfers || []).map((item:{employeeId:string})=>[item.employeeId,false])));
      setMessageTone(payload.missing?.length || payload.transfers?.length ? "warning" : "success");
      setMessage(
        payload.missing?.length
          ? "Analisis selesai. Lengkapi keputusan untuk karyawan yang tidak muncul."
          : payload.transfers?.length
            ? "Analisis selesai. Konfirmasi perpindahan project sebelum melanjutkan."
            : "Analisis selesai. Data siap dikonfirmasi.",
      );
    } catch (error) {
      const enriched = error as Error & { issues?: typeof issues };
      setIssues(enriched.issues || []);
      setMessageTone("error");
      setMessage(enriched.message || "Upload gagal");
    } finally {
      setBusy(false);
    }
  }
  async function confirm() {
    if (!preview?.batchId || !notesComplete) return;
    setBusy(true);
    setMessage("");
    setMessageTone("info");
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
            transferConfirmations,
          }),
        }),
      );
      setPreview({ ...preview, confirmed: true, confirmation: payload });
      setMessageTone("success");
      setMessage(
        payload.recovered
          ? `Intake ${form.period} berhasil dipulihkan dan dikonfirmasi. ${payload.employees ?? "Semua"} karyawan masuk Pay Run.`
          : `Intake ${form.period} dikonfirmasi. ${payload.employees ?? "Semua"} karyawan masuk Pay Run.`,
      );
    } catch (error) {
      setMessageTone("error");
      setMessage(error instanceof Error ? error.message : "Konfirmasi gagal");
    } finally {
      setBusy(false);
    }
  }

  function navigate(view: AppView) {
    if (preview?.batchId && !preview.confirmed && !window.confirm("Intake belum dikonfirmasi. Batalkan intake terlebih dahulu jika ingin meninggalkan halaman ini.")) return;
    router.push(`/?view=${view}&period=${encodeURIComponent(form.period)}`);
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
        period={form.period}
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
                  preview?.confirmed
                    ? "done"
                    : index + 1 < progress
                      ? "done"
                      : index + 1 === progress
                        ? "active"
                        : ""
                }
              >
                <span>{preview?.confirmed || index + 1 < progress ? "✓" : index + 1}</span>
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
          {contextReady ? (
            <section className="intake-scope-summary" aria-label="Scope payroll aktif">
              <div><span>Client</span><strong>{client?.name}</strong></div>
              <div><span>Project</span><strong>{project?.name}</strong></div>
              <div><span>Periode</span><strong>{form.period}</strong></div>
              <div><span>Tier</span><strong>{plan?.tier.replaceAll("_"," ")}</strong></div>
            </section>
          ) : null}
          {message ? (
            <div
              role={messageTone==="error"?"alert":"status"}
              className={`app-notice-bubble ${messageTone==="error"?"app-notice-error":messageTone==="success"?"app-notice-success":messageTone==="warning"?"app-notice-warning":"app-notice-info"}`}
            >
              <strong>{messageTone==="error"?"Perlu perhatian":messageTone==="success"?"Berhasil":messageTone==="warning"?"Perlu review":"Informasi"}</strong>
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
                {(file || preview) && !preview?.confirmed ? (
                  <button
                    className="btn btn-quiet"
                    type="button"
                    disabled={busy}
                    onClick={() => void restartIntake()}
                  >
                    {preview ? "Batalkan intake" : "Mulai ulang"}
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
                  accept=".xlsx"
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
                      : "Atau pilih file .xlsx, maksimal 8 MB"}
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
                  <div className="intake-control-equation" aria-label="Control total payroll">
                    <div><span>Gross</span><strong>{formatIDR(controlGross)}</strong></div>
                    <b>−</b>
                    <div><span>Deduction</span><strong>{formatIDR(controlDeduction)}</strong></div>
                    <b>=</b>
                    <div><span>Net / THP</span><strong>{formatIDR(controlNet)}</strong></div>
                  </div>
                  {(preview?.diagnostics || parsed.diagnostics).length ? (
                    <details className="intake-diagnostics">
                      <summary>Diagnostik workbook <b>{(preview?.diagnostics || parsed.diagnostics).length}</b></summary>
                      <div className="intake-diagnostics-grid">
                        {(preview?.diagnostics || parsed.diagnostics).map((item)=>(
                          <div key={item.sheetName}>
                            <strong>{item.sheetName}</strong>
                            <span>{item.kind==="EMPLOYEE_DATA" ? `${item.accepted} accepted · ${item.skipped} skipped` : "Bukan sheet employee"}</span>
                            <small>{item.headerRow ? `Header baris ${item.headerRow}` : "Header employee tidak ditemukan"}</small>
                          </div>
                        ))}
                      </div>
                    </details>
                  ) : null}
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
              <div className="intake-review-toolbar" aria-label="Filter review perubahan">
                {[
                  ["ALL","Semua"],
                  ["CHANGED",`Berubah ${preview.comparison?.changed || 0}`],
                  ["NEW",`Baru ${preview.comparison?.new || 0}`],
                  ["TRANSFER",`Mutasi ${preview.comparison?.transferred || 0}`],
                  ["MISSING",`Tidak muncul ${preview.comparison?.missing || 0}`],
                ].map(([value,label])=>(
                  <button key={value} type="button" className={reviewFilter===value?"active":""} onClick={()=>setReviewFilter(value as typeof reviewFilter)}>{label}</button>
                ))}
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
                  label="Mutasi project"
                  value={String(preview.comparison?.transferred || 0)}
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
              {(reviewFilter==="ALL"||reviewFilter==="TRANSFER") && (preview.transfers || []).length ? (
                <div className="intake-missing intake-transfer-review">
                  <div>
                    <strong>Perpindahan project terdeteksi</strong>
                    <span>Karyawan berikut sudah ada pada client yang sama di project lain. Konfirmasi setiap perpindahan sebelum membuat Pay Run.</span>
                  </div>
                  {preview.transfers?.map((item)=>(
                    <label className="intake-transfer-row" key={item.employeeId}>
                      <input type="checkbox" checked={Boolean(transferConfirmations[item.employeeId])} onChange={(event)=>setTransferConfirmations({...transferConfirmations,[item.employeeId]:event.target.checked})} />
                      <span><strong>{item.nrk} · {item.name}</strong><small>{item.fromProjectId || "Tanpa project"} → {item.toProjectId}</small></span>
                    </label>
                  ))}
                </div>
              ) : null}
              {(reviewFilter==="ALL"||reviewFilter==="CHANGED") && (preview.changes || []).length ? (
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
                        <div className="intake-change-fields">
                          {item.changedFields.slice(0,8).map((field)=>(
                            <div key={field}>
                              <span>{changeFieldLabel(field)}</span>
                              <del>{displayChangeValue(field,item.before?.[field])}</del>
                              <b>→</b>
                              <ins>{displayChangeValue(field,item.after?.[field])}</ins>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </details>
              ) : null}
              {(reviewFilter==="ALL"||reviewFilter==="NEW") && (preview.newEmployees || []).length ? (
                <details>
                  <summary>
                    Employee baru <b>{preview.newEmployees?.length}</b>
                  </summary>
                  <div className="intake-new-grid">
                    {preview.newEmployees?.map((item)=>(
                      <div key={item.nrk}><strong>{item.nrk}</strong><span>{item.name}</span></div>
                    ))}
                  </div>
                </details>
              ) : null}
              {(reviewFilter==="ALL"||reviewFilter==="MISSING") && (preview.missing || []).length ? (
                <div className="intake-missing">
                  <div>
                    <strong>
                      Karyawan tidak terdapat pada payroll {form.period}
                    </strong>
                    <span>
                      Setiap karyawan membutuhkan keputusan eksplisit. Catatan
                      wajib untuk mutasi dan alasan lainnya.
                    </span>
                    <div className="intake-resolution-legend">
                      <b>No pay</b><b>Resign</b><b>Mutasi</b><b>Lainnya</b>
                    </div>
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
                                targetProjectId: event.target.value === "TRANSFERRED" ? value.targetProjectId : undefined,
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
                        {value.resolution === "TRANSFERRED" ? (
                          <select
                            aria-label={`Target project untuk ${item.name}`}
                            value={value.targetProjectId || ""}
                            onChange={(event)=>setResolutions({
                              ...resolutions,
                              [item.employeeId]: { ...value, targetProjectId:event.target.value },
                            })}
                          >
                            <option value="">Pilih target project</option>
                            {setup.projects
                              .filter((candidate)=>candidate.client_id===form.clientId && candidate.id!==form.projectId)
                              .map((candidate)=><option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}
                          </select>
                        ) : null}
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
                <>
                <div className="intake-review-readiness">
                  <div><span>Missing resolution</span><strong>{notesComplete ? "Lengkap" : "Belum lengkap"}</strong></div>
                  <div><span>Transfer confirmation</span><strong>{transfersComplete ? "Lengkap" : "Belum lengkap"}</strong></div>
                  <div><span>Snapshot</span><strong>Belum dibuat</strong></div>
                </div>
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
                    disabled={busy || !notesComplete || !transfersComplete}
                    onClick={() => void confirm()}
                  >
                    {busy ? "Menyimpan…" : "Konfirmasi Intake & Buat Pay Run"}
                  </button>
                </div>
                </>
              ) : (
                <div className="intake-complete">
                  <div>
                    <strong>Intake selesai</strong>
                    <span>
                      Master, history, dan snapshot Pay Run telah tersimpan.
                    </span>
                  </div>
                  <Link
                    className="btn btn-primary"
                    href={`/?view=operations&period=${encodeURIComponent(form.period)}`}
                  >
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
function changeFieldLabel(field:string) {
  const labels:Record<string,string>={accountNo:"Rekening",basicSalary:"Gaji pokok",statusAktif:"Status",bpjsKes:"BPJS Kesehatan",jamsostek:"Jamsostek",ktp:"KTP",npwp:"NPWP",employmentType:"Status kerja",contractStart:"Awal kontrak",contractEnd:"Akhir kontrak"};
  return labels[field] || field.replace(/([a-z])([A-Z])/g,"$1 $2");
}
function displayChangeValue(field:string,value:unknown) {
  if(value==null||value==="") return "-";
  const text=String(value);
  if(["accountNo","ktp","npwp"].includes(field)) return text.length>4?`••••${text.slice(-4)}`:text;
  if(field==="basicSalary") return formatIDR(Number(value)||0);
  return text;
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
