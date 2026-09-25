"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import {
  EwaDetailPanel,
  EwaStatusBadge,
} from "@/components/employee-services/EwaLifecycle";
import { EmployeeServiceState } from "@/components/employee-services/OperationalState";
import DisbursementDialog from "@/components/employee-services/DisbursementDialog";
import {
  EWA_STATUSES,
  ewaMeta,
  formatPortalDate,
  type ClientFacet,
  type EwaRow,
  type StatusCounts,
} from "@/lib/employee-services";

const IDR = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
});

function EwaActionButtons({
  row,
  busy,
  onAction,
  onDisburse,
  onDetail,
}: {
  row: EwaRow;
  busy: boolean;
  onAction: (id: string, action: string) => void;
  onDisburse: (id: string) => void;
  onDetail: (row: EwaRow) => void;
}) {
  return (
    <div className="ewa-row-actions">
      <button type="button" className="btn" onClick={() => onDetail(row)}>
        Detail
      </button>
      {row.status === "SUBMITTED" ? (
        <>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => onAction(row.id, "APPROVE")}>
            Setujui
          </button>
          <button type="button" className="btn" disabled={busy} onClick={() => onAction(row.id, "REJECT")}>
            Tolak
          </button>
        </>
      ) : row.status === "APPROVED" ? (
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => onDisburse(row.id)}>
          Catat pencairan
        </button>
      ) : null}
    </div>
  );
}

export default function EwaInbox() {
  const [rows, setRows] = useState<EwaRow[]>([]);
  const [pending, setPending] = useState(0);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState("SUBMITTED");
  const [q, setQ] = useState("");
  const qDebounced = useDebouncedValue(q, 300);
  const [period, setPeriod] = useState("");
  const [clientId, setClientId] = useState("");
  const [clients, setClients] = useState<ClientFacet[]>([]);
  const [counts, setCounts] = useState<StatusCounts>({});
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState({ total: 0, hasMore: false, nextOffset: 0, limit: 50 });
  const [limit, setLimit] = useState(50);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState("");
  const [selected, setSelected] = useState<EwaRow | null>(null);
  const [disbursementTarget, setDisbursementTarget] = useState<EwaRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setMessage("");
    const params = new URLSearchParams({ status, offset: String(offset), limit: String(limit) });
    if (qDebounced.trim()) params.set("q", qDebounced.trim());
    if (/^\d{4}-\d{2}$/.test(period)) params.set("period", period);
    if (clientId) params.set("clientId", clientId);
    try {
      const response = await fetch(`/api/ewa?${params.toString()}`, { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      setRows(data.requests || []);
      setPending(Number(data.pending || 0));
      setTotal(Number(data.total || 0));
      setClients(data.clients || []);
      setCounts(data.statusCounts || {});
      setPage({
        total: Number(data.filteredTotal || 0),
        hasMore: Boolean(data.page?.hasMore),
        nextOffset: Number(data.page?.nextOffset || 0),
        limit: Number(data.page?.limit || 50),
      });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Gagal memuat Employee Services");
    } finally {
      setLoading(false);
    }
  }, [status, qDebounced, period, clientId, offset, limit]);

  useEffect(() => {
    void load();
  }, [load]);

  const resetFilters = useCallback(() => {
    setQ("");
    setPeriod("");
    setClientId("");
    setOffset(0);
  }, []);

  const hasFilters = Boolean(q || period || clientId);
  const visibleSummary = useMemo(
    () =>
      ["SUBMITTED", "APPROVED", "DISBURSED", "REPAYING"].map((key) => ({
        key,
        label: ewaMeta(key).shortLabel,
        value: counts[key] || 0,
      })),
    [counts],
  );

  async function act(id: string, action: string, extra: Record<string, string> = {}): Promise<boolean> {
    if (busy) return;
    setBusy(id + action);
    setMessage("");
    try {
      const response = await fetch("/api/ewa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action, ...extra }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      setSelected(null);
      await load();
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Gagal memproses");
      return false;
    } finally {
      setBusy("");
    }
  }

  async function disburse(id: string) {
    const row = rows.find((item) => item.id === id);
    if (row) setDisbursementTarget(row);
  }

  const operationalState = (
    <EmployeeServiceState
      loading={loading && rows.length === 0}
      error={message}
      empty={!loading && !message && rows.length === 0}
      emptyTitle={hasFilters || status ? "Tidak ada pengajuan yang cocok" : "Belum ada pengajuan advance"}
      emptyBody={hasFilters ? "Ubah atau reset filter untuk melihat data lain." : "Pengajuan baru dari ESS akan muncul di sini."}
      onRetry={() => void load()}
      onReset={hasFilters ? resetFilters : undefined}
    />
  );

  return (
    <section className="portal-workspace">


      <div className="page-heading">
        <div>
          <span className="page-eyebrow">Employee Services</span>
          <h1>Advance Salary</h1>
          <p>Kontrol lifecycle advance dari pengajuan sampai lunas. Status lunas hanya berasal dari rekonsiliasi payroll.</p>
        </div>
        <div className="es-heading-actions">
          <span className="status-pill" aria-live="polite">{pending} menunggu</span>
          <button type="button" className="btn" onClick={() => void load()} disabled={loading}>
            {loading ? "Memuat…" : "Refresh"}
          </button>
        </div>
      </div>

      <div className="ewa-summary" aria-label="Ringkasan lifecycle">
        {visibleSummary.map((item) => (
          <div key={item.key} className="ewa-summary-card">
            <b>{item.value}</b><span>{item.label}</span>
          </div>
        ))}
      </div>

      <div className="portal-toolbar" aria-label="Filter Advance Salary">
        <select value={status} onChange={(event) => { setStatus(event.target.value); setOffset(0); }} aria-label="Filter status">
          <option value="">Semua status ({total})</option>
          {EWA_STATUSES.map((value) => (
            <option key={value} value={value}>{ewaMeta(value).label} ({counts[value] || 0})</option>
          ))}
        </select>
        <input value={q} onChange={(e) => { setQ(e.target.value); setOffset(0); }} placeholder="Cari nama, kode, atau ID pengajuan" aria-label="Cari pengajuan advance" />
        <select value={clientId} onChange={(e) => { setClientId(e.target.value); setOffset(0); }} aria-label="Filter klien">
          <option value="">Semua klien</option>
          {clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
        </select>
        <input type="month" value={period} onChange={(e) => { setPeriod(e.target.value); setOffset(0); }} aria-label="Filter periode" />
        <select value={limit} onChange={(e) => { setLimit(Number(e.target.value)); setOffset(0); }} aria-label="Jumlah baris per halaman">
          <option value={25}>25 baris</option>
          <option value={50}>50 baris</option>
          <option value={100}>100 baris</option>
        </select>
        {hasFilters ? <button type="button" className="btn" onClick={resetFilters}>Reset filter</button> : null}
      </div>

      {operationalState}

      {rows.length > 0 ? (
        <>
          <div className="card ewa-desktop es-table-wrap">
            <table className="data-table es-table ewa-table">
              <thead>
                <tr><th align="left" className="es-sticky-left ewa-employee-cell">Karyawan</th><th align="right">Advance</th><th align="right">Potong payroll</th><th align="left">Lifecycle</th><th align="left">Aktivitas terakhir</th><th align="right" className="es-sticky-right">Aksi</th></tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td className="es-sticky-left ewa-employee-cell"><strong>{row.employee_name || row.employee_id}</strong><div className="ewa-muted">{row.employee_code} · {row.client_name} · {row.period}</div></td>
                    <td align="right"><strong>{IDR.format(row.amount || 0)}</strong><div className="ewa-muted">Fee {IDR.format(row.fee || 0)}</div></td>
                    <td align="right">{IDR.format(row.repayment || 0)}</td>
                    <td className="ewa-status"><EwaStatusBadge status={row.status} /><div className="ewa-muted ewa-status-note">{ewaMeta(row.status).note}</div></td>
                    <td>{formatPortalDate(row.disbursed_at || row.approved_at || row.created_at)}</td>
                    <td className="es-sticky-right">
                      <EwaActionButtons
                        row={row}
                        busy={Boolean(busy)}
                        onAction={(id, action) => void act(id, action)}
                        onDisburse={(id) => void disburse(id)}
                        onDetail={setSelected}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="ewa-mobile" aria-label="Daftar advance versi mobile">
            {rows.map((row) => (
              <article className="ewa-mobile-card" key={row.id}>
                <div className="ewa-mobile-top">
                  <div><strong>{row.employee_name || row.employee_id}</strong><div className="ewa-muted">{row.employee_code} · {row.client_name}</div></div>
                  <EwaStatusBadge status={row.status} />
                </div>
                <div className="ewa-mobile-money">
                  <div><small>Cair</small><strong>{IDR.format(row.amount || 0)}</strong></div>
                  <div><small>Potong gaji</small><strong>{IDR.format(row.repayment || 0)}</strong></div>
                </div>
                <div className="ewa-muted ewa-mobile-meta">{row.period} · {formatPortalDate(row.disbursed_at || row.approved_at || row.created_at)}</div>
                <EwaActionButtons
                  row={row}
                  busy={Boolean(busy)}
                  onAction={(id, action) => void act(id, action)}
                  onDisburse={(id) => void disburse(id)}
                  onDetail={setSelected}
                />
              </article>
            ))}
          </div>
        </>
      ) : null}

      <div className="portal-toolbar es-pagination">
        <span className="ewa-muted" aria-live="polite">
          {page.total ? `${offset + 1}–${Math.min(offset + rows.length, page.total)} dari ${page.total}` : "0 data"}
        </span>
        <span className="es-pagination-actions">
          <button type="button" className="btn" disabled={offset === 0 || loading} onClick={() => setOffset(Math.max(0, offset - page.limit))}>Sebelumnya</button>
          <button type="button" className="btn" disabled={!page.hasMore || loading} onClick={() => setOffset(page.nextOffset)}>Berikutnya</button>
        </span>
      </div>

      {selected ? <EwaDetailPanel row={selected} onClose={() => setSelected(null)} /> : null}
      {disbursementTarget ? (
        <DisbursementDialog
          row={disbursementTarget}
          busy={Boolean(busy)}
          error={message}
          onClose={() => setDisbursementTarget(null)}
          onConfirm={(input) => {
            void act(disbursementTarget.id, "DISBURSE", input).then((success) => {
              if (success) setDisbursementTarget(null);
            });
          }}
        />
      ) : null}
    </section>
  );
}
