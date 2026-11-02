"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { EwaDetailPanel, EwaStatusBadge } from "@/components/employee-services/EwaLifecycle";
import { EmployeeServiceState } from "@/components/employee-services/OperationalState";
import { WorkspaceHeader as UiWorkspaceHeader, Pagination as UiPagination, ModalShell } from "@/components/ui/UnifiedSystem";
import { IconRefresh, IconSearch, IconCheckCircle, IconClock, IconLayers, IconWallet, IconEye, IconX, IconFilter, IconCalendar, IconList } from "@/components/Icons";
import { EWA_STATUSES, ewaMeta, formatPortalDate, type ClientFacet, type EwaRow, type StatusCounts } from "@/lib/employee-services";

const IDR = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 });
const KPIS = [
  { key: "SUBMITTED", label: "Menunggu", note: "Perlu keputusan", Icon: IconWallet, tone: "pending" },
  { key: "APPROVED", label: "Siap Cair", note: "Siap proses pencairan", Icon: IconClock, tone: "ready" },
  { key: "DISBURSED", label: "Dicairkan", note: "Sudah dicairkan", Icon: IconCheckCircle, tone: "paid" },
  { key: "REPAYING", label: "Dalam Payroll", note: "Sedang dipotong payroll", Icon: IconLayers, tone: "payroll" },
];
function canDecide(row: EwaRow, role: string) {
  return row.status === "SUBMITTED" && ((role === "CLIENT_USER" && row.client_approval_status === "PENDING") || (["SUPER_ADMIN", "PAYROLL_PROCESSOR"].includes(role) && row.client_approval_status === "APPROVED"));
}
function approvalNote(row: EwaRow) {
  if (row.status === "SUBMITTED") return row.client_approval_status === "APPROVED" ? "Menunggu Payroll Processor" : "Menunggu persetujuan klien";
  if (row.status === "APPROVED") return "Lanjut persetujuan Controller di Pembayaran";
  return ewaMeta(row.status).note;
}
function initials(name: string) { return name.trim().split(/\s+/).slice(0, 2).map(s => s[0]).join("").toUpperCase(); }
function lastActivity(row: EwaRow) { return row.updated_at || row.decided_at || row.disbursed_at || row.approved_at || row.client_decided_at || row.created_at; }
function EwaActionButtons({ row, role, busy, onDetail, onDecision }: { row: EwaRow; role: string; busy: boolean; onDetail: (row: EwaRow) => void; onDecision: (row: EwaRow, action: "APPROVE" | "REJECT") => void }) {
  return <div className="ewa-row-actions">
    <button type="button" className="btn" onClick={() => onDetail(row)} aria-label={`Detail ${row.employee_name || row.id}`}><IconEye aria-hidden="true" />Detail</button>
    {canDecide(row, role) ? <>
      <button type="button" className="btn btn-primary" disabled={busy} onClick={() => onDecision(row, "APPROVE")}><IconCheckCircle aria-hidden="true" />Setujui</button>
      <button type="button" className="btn" disabled={busy} onClick={() => onDecision(row, "REJECT")}><IconX aria-hidden="true" />Tolak</button>
    </> : row.status === "APPROVED" && ["PAYROLL_PROCESSOR", "PAYROLL_CONTROLLER"].includes(role) ? <a className="btn" href={`/?view=payments&stage=payment&paymentPanel=DISBURSEMENT&ewaRequest=${encodeURIComponent(row.id)}&clientId=${encodeURIComponent(row.client_id || "")}`}>Buka pembayaran</a> : null}
  </div>;
}

export default function EwaInbox() {
  const [rows, setRows] = useState<EwaRow[]>([]), [pending, setPending] = useState(0), [total, setTotal] = useState(0);
  const [status, setStatus] = useState("SUBMITTED"), [q, setQ] = useState(""), [period, setPeriod] = useState(""), [clientId, setClientId] = useState("");
  const qDebounced = useDebouncedValue(q, 300);
  const [clients, setClients] = useState<ClientFacet[]>([]), [counts, setCounts] = useState<StatusCounts>({});
  const [offset, setOffset] = useState(0), [limit, setLimit] = useState(50);
  const [page, setPage] = useState({ total: 0, hasMore: false, nextOffset: 0 });
  const [loading, setLoading] = useState(true), [message, setMessage] = useState(""), [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false), [selected, setSelected] = useState<EwaRow | null>(null);
  const [actor, setActor] = useState<{ role: string } | null>(null), [filtersOpen, setFiltersOpen] = useState(false);
  const [decision, setDecision] = useState<{ row: EwaRow; action: "APPROVE" | "REJECT" } | null>(null), [note, setNote] = useState(""), [decisionError, setDecisionError] = useState("");
  const sequence = useRef(0), fetchController = useRef<AbortController | null>(null), mutationLock = useRef(false);
  useEffect(() => { const controller = new AbortController(); void fetch("/api/me", { signal: controller.signal }).then(r => r.ok ? r.json() : null).then(d => setActor(d?.user || null)).catch(() => {}); return () => controller.abort(); }, []);

  const load = useCallback(async () => {
    fetchController.current?.abort(); const controller = new AbortController(); fetchController.current = controller; const current = ++sequence.current;
    setLoading(true); setMessage("");
    const params = new URLSearchParams({ status, offset: String(offset), limit: String(limit) });
    if (qDebounced.trim()) params.set("q", qDebounced.trim());
    if (/^\d{4}-\d{2}$/.test(period)) params.set("period", period);
    if (clientId) params.set("clientId", clientId);
    try {
      const response = await fetch(`/api/ewa?${params}`, { cache: "no-store", signal: controller.signal }); const data = await response.json().catch(() => ({}));
      if (!response.ok) throw Error(data.error || `HTTP ${response.status}`);
      if (current !== sequence.current) return;
      setRows(data.requests || []); setPending(Number(data.pending || 0)); setTotal(Number(data.total || 0)); setClients(data.clients || []); setCounts(data.statusCounts || {});
      const filteredTotal = Number(data.filteredTotal || 0);
      if (offset > 0 && offset >= filteredTotal) { setOffset(Math.max(0, Math.floor((filteredTotal - 1) / limit) * limit)); return; }
      setPage({ total: filteredTotal, hasMore: Boolean(data.page?.hasMore), nextOffset: Number(data.page?.nextOffset || 0) });
    } catch (error) { if (!controller.signal.aborted && current === sequence.current) setMessage(error instanceof Error ? error.message : "Gagal memuat pengajuan EWA"); }
    finally { if (current === sequence.current) setLoading(false); }
  }, [status, qDebounced, period, clientId, offset, limit]);
  useEffect(() => { void load(); return () => fetchController.current?.abort(); }, [load]);
  function resetFilters() { setStatus(""); setQ(""); setPeriod(""); setClientId(""); setOffset(0); }
  const hasFilters = Boolean(status || q || period || clientId);
  function openDecision(row: EwaRow, action: "APPROVE" | "REJECT") { if (mutationLock.current || !canDecide(row, actor?.role || "")) return; setDecision({ row, action }); setNote(""); setDecisionError(""); setSuccess(""); }
  async function act(id: string, action: string, extra: Record<string, string> = {}): Promise<boolean> {
    if (mutationLock.current) return false;
    mutationLock.current = true; setBusy(true); setDecisionError(""); setSuccess("");
    try {
      const response = await fetch("/api/ewa", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, action, ...extra }) });
      const data = await response.json().catch(() => ({})); if (!response.ok) throw Error(data.error || `HTTP ${response.status}`);
      if (data.request) setSelected(previous => previous?.id === id ? { ...previous, ...data.request } : previous);
      setDecision(null); setSuccess(action === "APPROVE" ? "Persetujuan berhasil disimpan." : "Penolakan dan alasannya berhasil disimpan."); await load(); return true;
    } catch (error) { setDecisionError(error instanceof Error ? error.message : "Gagal menyimpan keputusan"); return false; }
    finally { mutationLock.current = false; setBusy(false); }
  }
  const actionProps = { role: actor?.role || "", busy, onDetail: setSelected, onDecision: openDecision };
  return <section className="portal-workspace ewa-approval-page">
    <UiWorkspaceHeader className="ewa-approval-header" eyebrow="EMPLOYEE SERVICES" title="Persetujuan Advance Salary" description="Tinjau dan setujui pengajuan EWA sesuai kebijakan yang berlaku."
      meta={<><span className="ewa-new-badge"><IconWallet aria-hidden="true" /><strong>{pending}</strong> pengajuan baru</span><span><IconLayers aria-hidden="true" />Total {total} pengajuan</span></>}
      action={<button type="button" className="btn" onClick={() => void load()} disabled={loading}><IconRefresh aria-hidden="true" />{loading ? "Memuat…" : "Refresh Data"}</button>} />
    <div className="ewa-kpi-grid" aria-label="Ringkasan pengajuan">
      {KPIS.map(({ key, label, note: caption, Icon, tone }) => <button type="button" key={key} className={`ewa-kpi ewa-kpi-${tone}`} aria-pressed={status === key} onClick={() => { setStatus(status === key ? "" : key); setOffset(0); }}><span className="ewa-kpi-icon"><Icon aria-hidden="true" /></span><span className="ewa-kpi-copy"><span>{label}</span><strong>{counts[key] || 0}</strong><small>{caption}</small></span></button>)}
    </div>
    <section className="ewa-filter-panel" aria-label="Filter pengajuan">
      <div className="ewa-section-heading"><div><IconFilter aria-hidden="true" /><div><h2>Filter &amp; Pencarian</h2><p>Gunakan filter untuk mempersempit daftar pengajuan.</p></div></div><div className="ewa-filter-actions">{hasFilters ? <button type="button" className="btn" onClick={resetFilters}>Reset filter</button> : null}<button type="button" className="btn ewa-filter-toggle" aria-expanded={filtersOpen} aria-controls="ewa-filters" onClick={() => setFiltersOpen(!filtersOpen)}>Filter</button></div></div>
      <div id="ewa-filters" className={`ewa-approval-filters${filtersOpen ? " is-open" : ""}`}>
        <label>Status<select value={status} onChange={e => { setStatus(e.target.value); setOffset(0); }} aria-label="Filter status"><option value="">Semua status ({total})</option>{EWA_STATUSES.map(value => <option value={value} key={value}>{ewaMeta(value).label} ({counts[value] || 0})</option>)}</select></label>
        <label className="ewa-filter-search">Pencarian<span className="ewa-input-icon"><IconSearch aria-hidden="true" /><input value={q} onChange={e => { setQ(e.target.value); setOffset(0); }} placeholder="Cari nama, kode, atau ID pengajuan" aria-label="Cari pengajuan advance" /></span></label>
        <label>Klien<select value={clientId} onChange={e => { setClientId(e.target.value); setOffset(0); }} aria-label="Filter klien"><option value="">Semua klien</option>{clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label>Periode<span className="ewa-input-icon"><IconCalendar aria-hidden="true" /><input type="month" value={period} onChange={e => { setPeriod(e.target.value); setOffset(0); }} aria-label="Filter periode" /></span></label>
        <label>Baris<select value={limit} onChange={e => { setLimit(Number(e.target.value)); setOffset(0); }} aria-label="Jumlah baris per halaman"><option value={25}>25 baris</option><option value={50}>50 baris</option><option value={100}>100 baris</option></select></label>
      </div>
    </section>
    {success ? <p className="ewa-success" role="status"><IconCheckCircle aria-hidden="true" />{success}</p> : null}
    <section className="ewa-list-card" aria-label="Daftar pengajuan" aria-busy={loading}>
      <div className="ewa-section-heading"><div><IconList aria-hidden="true" /><div><h2>Daftar Pengajuan</h2><p>{page.total} data sesuai filter</p></div></div>{loading && rows.length > 0 ? <span role="status">Memperbarui…</span> : null}</div>
      <EmployeeServiceState loading={loading && rows.length === 0} error={message} empty={!loading && !message && rows.length === 0} emptyTitle={hasFilters ? "Tidak ada pengajuan yang cocok" : "Belum ada pengajuan advance"} emptyBody="Pengajuan baru dari ESS akan muncul di sini." onRetry={() => void load()} onReset={hasFilters ? resetFilters : undefined} />
      {rows.length > 0 ? <>
        <div className="ewa-desktop es-table-wrap"><table className="data-table ewa-table"><colgroup><col className="ewa-col-employee"/><col/><col/><col/><col className="ewa-col-status"/><col/><col className="ewa-col-actions"/></colgroup><thead><tr><th>Karyawan</th><th className="ewa-money">Advance</th><th className="ewa-money">Potong Payroll</th><th className="ewa-money">Gaji Acuan</th><th>Status</th><th>Aktivitas Terakhir</th><th>Aksi</th></tr></thead><tbody>{rows.map(row => <tr key={row.id}>
          <td><div className="ewa-person"><span className="ewa-avatar" aria-hidden="true">{initials(row.employee_name || row.employee_id)}</span><div><strong>{row.employee_name || row.employee_id}</strong><small>{row.employee_code || row.employee_id} · {row.client_name}</small></div></div></td>
          <td className="ewa-money"><strong>{IDR.format(row.amount || 0)}</strong><small>Fee {IDR.format(row.fee || 0)}</small></td>
          <td className="ewa-money">{IDR.format(row.repayment || 0)}</td>
          <td className="ewa-money">{row.salary_reference_snapshot != null ? IDR.format(row.salary_reference_snapshot) : "—"}<small>{row.salary_source_period_snapshot || "Belum tercatat"}</small></td>
          <td><EwaStatusBadge status={row.status}/><small>{approvalNote(row)}</small></td>
          <td><time>{formatPortalDate(lastActivity(row))}</time></td>
          <td><EwaActionButtons row={row} {...actionProps}/></td>
        </tr>)}</tbody></table></div>
        <div className="ewa-mobile">{rows.map(row => <article key={row.id} className="ewa-mobile-card"><div className="ewa-mobile-top"><div className="ewa-person"><span className="ewa-avatar" aria-hidden="true">{initials(row.employee_name || row.employee_id)}</span><div><strong>{row.employee_name || row.employee_id}</strong><small>{row.employee_code} · {row.client_name}</small></div></div><EwaStatusBadge status={row.status}/></div><dl className="ewa-mobile-values"><div><dt>Advance</dt><dd>{IDR.format(row.amount || 0)}<small>Fee {IDR.format(row.fee || 0)}</small></dd></div><div><dt>Potong Payroll</dt><dd>{IDR.format(row.repayment || 0)}</dd></div><div><dt>Gaji Acuan</dt><dd>{row.salary_reference_snapshot != null ? IDR.format(row.salary_reference_snapshot) : "—"}<small>{row.salary_source_period_snapshot || "Belum tercatat"}</small></dd></div><div><dt>Aktivitas Terakhir</dt><dd>{formatPortalDate(lastActivity(row))}</dd></div></dl><p className="ewa-mobile-note">{approvalNote(row)}</p><EwaActionButtons row={row} {...actionProps}/></article>)}</div>
      </> : null}
      <UiPagination total={page.total} from={page.total ? offset + 1 : 0} to={Math.min(offset + rows.length, page.total)} previousDisabled={offset === 0 || loading} nextDisabled={!page.hasMore || loading} onPrevious={() => setOffset(Math.max(0, offset - limit))} onNext={() => setOffset(page.nextOffset)}/>
    </section>
    {selected ? <EwaDetailPanel row={selected} onClose={() => setSelected(null)}/> : null}
    {decision ? <ModalShell title={decision.action === "APPROVE" ? "Setujui pengajuan advance?" : "Tolak pengajuan advance?"} onClose={() => { if (!mutationLock.current) setDecision(null); }} className="ewa-approval-confirm">
      <p><strong>{decision.row.employee_name || decision.row.employee_id}</strong> · {IDR.format(decision.row.amount)}</p><p>{decision.action === "APPROVE" ? "Keputusan hanya berlaku pada tahap persetujuan Anda. Pencairan mengikuti proses persetujuan dan validasi pembayaran berikutnya." : "Alasan penolakan akan disimpan dan dapat dilihat pada detail pengajuan."}</p>
      <form onSubmit={e => { e.preventDefault(); if (decision.action === "REJECT" && note.trim().length < 5) { setDecisionError("Alasan penolakan minimal 5 karakter."); return; } void act(decision.row.id, decision.action, { note: note.trim() }); }}>
        {decision.action === "REJECT" ? <label>Alasan penolakan<textarea required minLength={5} maxLength={240} value={note} disabled={busy} onChange={e => setNote(e.target.value)} autoComplete="off"/></label> : null}
        {decisionError ? <p role="alert" className="ewa-decision-error">{decisionError}</p> : null}
        <div className="ewa-confirm-actions"><button className="btn" type="button" disabled={busy} onClick={() => setDecision(null)}>Batal</button><button className={decision.action === "APPROVE" ? "btn btn-primary" : "btn"} type="submit" disabled={busy || (decision.action === "REJECT" && note.trim().length < 5)}>{busy ? "Menyimpan…" : decision.action === "APPROVE" ? "Konfirmasi persetujuan" : "Konfirmasi penolakan"}</button></div>
      </form>
    </ModalShell> : null}
  </section>;
}
