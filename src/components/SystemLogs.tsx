"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import {
  clearSystemLogs,
  loadSystemLogs,
  onSystemLogChange,
  type SystemLogEntry,
} from "@/lib/system-log";

type AuditLevel = "INFO" | "SUCCESS" | "WARN" | "ERROR";
type AuditRow = {
  id: string;
  timestamp: string;
  source: string;
  level: AuditLevel;
  event: string;
  message: string;
  actor?: string;
  actor_role?: string;
  entity?: string;
  entity_id?: string;
  correlation_id?: string;
  ip?: string;
  origin?: string;
};

type ApiPage = { offset: number; limit: number; total: number; hasMore: boolean; nextOffset: number };
type Summary = { total: number; errors: number; warnings: number; employeeServices: number; failedLogins: number };
type Health = { gatewayFailed:number; gatewayActive:number; connectedApps:number; apiErrors24h:number };

const SOURCE_LABELS: Record<string, string> = {
  BUSINESS: "Business",
  PAYROLL: "Payroll",
  PAYMENT: "Payment",
  BILLING: "Billing & AR",
  EMPLOYEE_SERVICE: "Employee Services",
  SECURITY: "Security",
  INTEGRATION: "Integration",
  SYSTEM: "System",
  LOCAL_RUNTIME: "Runtime Local",
};

const EVENT_LABELS: Record<string, string> = {
  EMPLOYEE_PORTAL_LOGIN_SUCCESS: "Login portal berhasil",
  EMPLOYEE_PORTAL_LOGIN_FAILED: "Login portal gagal",
  EWA_SUBMITTED: "Advance diajukan",
  EWA_APPROVED: "Advance disetujui",
  EWA_REJECTED: "Advance ditolak",
  EWA_DISBURSED: "Advance dicairkan",
  EWA_REPAID_RECONCILED: "Advance lunas setelah rekonsiliasi",
  EMPLOYEE_PASSWORD_CHANGED: "Password portal diubah",
  EMPLOYEE_PORTAL_PASSWORDS_ISSUED: "Kredensial portal diterbitkan",
};

const humanize = (value: string) =>
  EVENT_LABELS[value] ||
  String(value || "")
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/^./, (c) => c.toUpperCase());

const fmtTime = (value: string | number) =>
  new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(typeof value === "number" ? value : new Date(value));

function localToAudit(item: SystemLogEntry): AuditRow {
  return {
    id: `local-${item.id}`,
    timestamp: new Date(item.timestamp).toISOString(),
    source: "LOCAL_RUNTIME",
    level: item.level,
    event: item.event,
    message: item.message,
    actor: "Browser session",
    actor_role: "LOCAL",
    entity: item.source,
    entity_id: "",
    origin: "LOCAL_RUNTIME",
  };
}

export default function SystemLogs() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [localLogs, setLocalLogs] = useState<SystemLogEntry[]>([]);
  const [summary, setSummary] = useState<Summary>({
    total: 0,
    errors: 0,
    warnings: 0,
    employeeServices: 0,
    failedLogins: 0,
  });
  const [sources, setSources] = useState<Array<{ source: string; total: number }>>([]);
  const [health, setHealth] = useState<Health>({gatewayFailed:0,gatewayActive:0,connectedApps:0,apiErrors24h:0});
  const [page, setPage] = useState<ApiPage>({
    offset: 0,
    limit: 50,
    total: 0,
    hasMore: false,
    nextOffset: 0,
  });
  const [q, setQ] = useState(() => typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("auditCorrelation") || "");
  const [traceCorrelation, setTraceCorrelation] = useState(() => typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("auditCorrelation") || "");
  const qDebounced = useDebouncedValue(q, 300);
  const [source, setSource] = useState("");
  const [level, setLevel] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [limit, setLimit] = useState(50);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [selected, setSelected] = useState<AuditRow | null>(null);

  useEffect(() => {
    const refresh = () => setLocalLogs(loadSystemLogs());
    refresh();
    return onSystemLogChange(refresh);
  }, []);

  const load = useCallback(async () => {
    if (source === "LOCAL_RUNTIME") {
      setLoading(false);
      setMessage("");
      return;
    }
    setLoading(true);
    setMessage("");
    const params = new URLSearchParams({ offset: String(offset), limit: String(limit) });
    if (qDebounced.trim()) params.set("q", qDebounced.trim());
    if (source) params.set("source", source);
    if (level) params.set("level", level);
    if (from) params.set("from", from);
    if (to) params.set("to", to);

    try {
      const response = await fetch(`/api/audit-logs?${params.toString()}`, { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      setRows(data.rows || []);
      setSummary({
        total: Number(data.summary?.total || 0),
        errors: Number(data.summary?.errors || 0),
        warnings: Number(data.summary?.warnings || 0),
        employeeServices: Number(data.summary?.employeeServices || 0),
        failedLogins: Number(data.summary?.failedLogins || 0),
      });
      setSources(data.sources || []);
      setHealth({
        gatewayFailed:Number(data.health?.gatewayFailed||0),
        gatewayActive:Number(data.health?.gatewayActive||0),
        connectedApps:Number(data.health?.connectedApps||0),
        apiErrors24h:Number(data.health?.apiErrors24h||0),
      });
      setPage({
        offset: Number(data.page?.offset || 0),
        limit: Number(data.page?.limit || limit),
        total: Number(data.page?.total || 0),
        hasMore: Boolean(data.page?.hasMore),
        nextOffset: Number(data.page?.nextOffset || 0),
      });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Gagal memuat audit log");
    } finally {
      setLoading(false);
    }
  }, [qDebounced, source, level, from, to, offset, limit]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!selected) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelected(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [selected]);

  const localRows = useMemo(() => {
    const query = qDebounced.trim().toLowerCase();
    return localLogs
      .map(localToAudit)
      .filter((row) => {
        if (level && row.level !== level) return false;
        if (from && row.timestamp < from + "T00:00:00") return false;
        if (to && row.timestamp > to + "T23:59:59.999") return false;
        if (!query) return true;
        return [row.source, row.event, row.message, row.actor, row.entity].some((value) =>
          String(value || "")
            .toLowerCase()
            .includes(query),
        );
      })
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  }, [localLogs, qDebounced, level, from, to]);

  const activeRows = source === "LOCAL_RUNTIME" ? localRows.slice(offset, offset + limit) : rows;
  const localTotal = localRows.length;
  const activeTotal = source === "LOCAL_RUNTIME" ? localTotal : page.total;
  const activeHasMore = source === "LOCAL_RUNTIME" ? offset + limit < localTotal : page.hasMore;
  const nextOffset = source === "LOCAL_RUNTIME" ? offset + limit : page.nextOffset;

  const resetFilters = () => {
    setQ("");
    setTraceCorrelation("");
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.delete("auditCorrelation");
      window.history.replaceState(window.history.state, "", url);
    }
    setSource("");
    setLevel("");
    setFrom("");
    setTo("");
    setLimit(50);
    setOffset(0);
    setSelected(null);
  };
  const hasFilters = Boolean(q || source || level || from || to || limit !== 50);

  const sourceOptions = useMemo(() => {
    const map = new Map(sources.map((item) => [item.source, item.total]));
    return [
      "BUSINESS",
      "PAYROLL",
      "PAYMENT",
      "BILLING",
      "EMPLOYEE_SERVICE",
      "SECURITY",
      "INTEGRATION",
      "SYSTEM",
    ]
      .map((key) => ({ key, total: Number(map.get(key) || 0) }))
      .filter((item) => item.total > 0 || ["EMPLOYEE_SERVICE", "SECURITY"].includes(item.key));
  }, [sources]);

  return (
    <section className="audit-console">
      <section className="audit-hero">
        <div>
          <span className="audit-eyebrow">GOVERNANCE · SECURITY · OPERATIONS</span>
          <h1>Audit Logs Control Center</h1>
          <p>
            Satu console untuk seluruh audit bisnis, payroll, payment, billing, Employee Services,
            security, integration, dan runtime aplikasi.
          </p>
          <div className="audit-hero-meta">
            <span><strong>D1</strong> canonical audit authority</span>
            <span><strong>{summary.failedLogins}</strong> login portal gagal</span>
            <span><strong>{localLogs.length}</strong> runtime local</span>
          </div>
        </div>
        <button type="button" className="btn" disabled={loading} onClick={() => void load()}>{loading ? "Memuat…" : "Refresh audit"}</button>
      </section>

      {traceCorrelation ? <div className="app-notice-bubble app-notice-info" role="status">
        <strong>Correlation trace aktif</strong>
        <span>Audit Logs difilter otomatis untuk correlation ID <code>{traceCorrelation}</code>.</span>
        <button type="button" className="btn" onClick={resetFilters}>Tampilkan semua audit</button>
      </div> : null}

      <div className="audit-kpis">
        <div className="audit-kpi"><span>Total canonical</span><strong>{summary.total}</strong><small>event sesuai filter</small></div>
        <div className="audit-kpi audit-kpi-error"><span>Error</span><strong>{summary.errors}</strong><small>butuh investigasi</small></div>
        <div className="audit-kpi audit-kpi-warn"><span>Warning</span><strong>{summary.warnings}</strong><small>perlu perhatian</small></div>
        <div className="audit-kpi audit-kpi-ess"><span>Employee Services</span><strong>{summary.employeeServices}</strong><small>termasuk portal login</small></div>
      </div>

      <section className="audit-health-strip" aria-label="Status operasional">
        <div><span>Payment Gateway</span><strong className={health.gatewayFailed?"bad":health.gatewayActive?"warn":"ok"}>{health.gatewayFailed ? health.gatewayFailed+" gagal" : health.gatewayActive ? health.gatewayActive+" aktif" : "Normal"}</strong></div>
        <div><span>Connected Apps</span><strong>{health.connectedApps}</strong></div>
        <div><span>API error 24 jam</span><strong className={health.apiErrors24h?"bad":"ok"}>{health.apiErrors24h}</strong></div>
        <div><span>ESS failed login</span><strong className={summary.failedLogins?"warn":"ok"}>{summary.failedLogins}</strong></div>
      </section>

      <section className="card audit-filter-panel">
        <div className="audit-filter-head"><div><strong>Filter console</strong><span>Semua event canonical tersedia dari satu endpoint D1.</span></div>{hasFilters ? <button type="button" className="btn" onClick={resetFilters}>Reset filter</button> : null}</div>
        <div className="audit-filter-grid">
          <label className="audit-search"><span>Pencarian</span><input value={q} onChange={(event) => { setQ(event.target.value); setTraceCorrelation(""); setOffset(0); }} placeholder="Event, actor, entity, correlation ID, IP…" /></label>
          <label><span>Source</span><select value={source} onChange={(event) => { setSource(event.target.value); setOffset(0); setSelected(null); }}><option value="">Semua canonical D1</option>{sourceOptions.map((item) => <option key={item.key} value={item.key}>{SOURCE_LABELS[item.key] || item.key} ({item.total})</option>)}<option value="LOCAL_RUNTIME">Runtime Local ({localLogs.length})</option></select></label>
          <label><span>Level</span><select value={level} onChange={(event) => { setLevel(event.target.value); setOffset(0); }}><option value="">Semua level</option><option>INFO</option><option>SUCCESS</option><option>WARN</option><option>ERROR</option></select></label>
          <label><span>Dari</span><input type="date" value={from} onChange={(event) => { setFrom(event.target.value); setOffset(0); }} /></label>
          <label><span>Sampai</span><input type="date" value={to} onChange={(event) => { setTo(event.target.value); setOffset(0); }} /></label>
          <label><span>Baris</span><select value={limit} onChange={(event) => { setLimit(Number(event.target.value)); setOffset(0); }}><option value={25}>25</option><option value={50}>50</option><option value={100}>100</option></select></label>
        </div>
      </section>

      {message ? <div className="app-notice-bubble app-notice-error" role="alert"><span>{message}</span><button type="button" className="btn" onClick={() => void load()}>Coba lagi</button></div> : null}

      <section className="card audit-stream">
        <div className="audit-stream-head"><div><strong>{source === "LOCAL_RUNTIME" ? "Runtime Local" : source ? SOURCE_LABELS[source] || source : "Semua Canonical Audit"}</strong><span>{activeTotal} event · {source === "LOCAL_RUNTIME" ? "browser-only, non-authoritative" : "Cloudflare D1 authoritative"}</span></div>{source === "LOCAL_RUNTIME" && localLogs.length ? <button type="button" className="btn" onClick={clearSystemLogs}>Bersihkan runtime local</button> : null}</div>
        {loading && source !== "LOCAL_RUNTIME" && activeRows.length === 0 ? <div className="audit-empty">Memuat audit log…</div> : null}
        {!loading && !message && activeRows.length === 0 ? <div className="audit-empty">Tidak ada event yang cocok dengan filter.</div> : null}
        {activeRows.length > 0 ? <div className="audit-table-wrap"><table className="audit-table"><thead><tr><th>Waktu</th><th>Level</th><th>Source</th><th>Event</th><th>Actor</th><th>Entity</th><th /></tr></thead><tbody>{activeRows.map((row) => <tr key={row.id}><td className="audit-time">{fmtTime(row.timestamp)} WIB</td><td><span className={`audit-level audit-level-${row.level.toLowerCase()}`}>{row.level}</span></td><td><span className="audit-source">{SOURCE_LABELS[row.source] || row.source}</span></td><td><strong>{humanize(row.event)}</strong><small>{row.message || row.event}</small></td><td>{row.actor || "SYSTEM"}<small>{row.actor_role || "—"}</small></td><td>{row.entity || "—"}<small>{row.entity_id || row.ip || "—"}</small></td><td className="audit-action"><button type="button" className="btn" onClick={() => setSelected(row)}>Detail</button></td></tr>)}</tbody></table></div> : null}
        <div className="audit-pagination"><span>{activeTotal ? `${offset + 1}–${Math.min(offset + activeRows.length, activeTotal)} dari ${activeTotal}` : "0 event"}</span><div><button type="button" className="btn" disabled={offset === 0 || loading} onClick={() => setOffset(Math.max(0, offset - limit))}>Sebelumnya</button><button type="button" className="btn" disabled={!activeHasMore || loading} onClick={() => setOffset(nextOffset)}>Berikutnya</button></div></div>
      </section>

      {selected ? <div className="es-drawer-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) setSelected(null); }}><aside className="es-drawer audit-drawer" role="dialog" aria-modal="true" aria-labelledby="audit-detail-title"><div className="es-drawer-head"><div><span className="audit-eyebrow">AUDIT DETAIL</span><h2 id="audit-detail-title">{humanize(selected.event)}</h2><small>{selected.id}</small></div><button type="button" className="btn" onClick={() => setSelected(null)}>Tutup</button></div><div className="es-detail-grid"><div><span>Waktu</span>{fmtTime(selected.timestamp)} WIB</div><div><span>Level</span>{selected.level}</div><div><span>Source</span>{SOURCE_LABELS[selected.source] || selected.source}</div><div><span>Origin</span>{selected.origin || "—"}</div><div><span>Actor</span>{selected.actor || "SYSTEM"} · {selected.actor_role || "—"}</div><div><span>IP</span>{selected.ip || "—"}</div><div><span>Entity</span>{selected.entity || "—"}</div><div><span>Entity ID</span>{selected.entity_id || "—"}</div><div><span>Correlation ID</span>{selected.correlation_id || "—"}</div><div className="audit-detail-wide"><span>Raw event</span>{selected.event}</div><div className="audit-detail-wide"><span>Detail</span>{selected.message || "—"}</div></div></aside></div> : null}
    </section>
  );
}
