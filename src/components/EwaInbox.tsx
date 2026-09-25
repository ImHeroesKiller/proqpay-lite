"use client";

import { useCallback, useEffect, useState } from "react";

type EwaRow = {
  id: string;
  employee_id: string;
  employee_name?: string;
  employee_code?: string;
  client_name?: string;
  period: string;
  amount: number;
  fee: number;
  repayment: number;
  status: string;
  created_at: string;
};

const IDR = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
});

export default function EwaInbox() {
  const [rows, setRows] = useState<EwaRow[]>([]);
  const [pending, setPending] = useState(0);
  const [status, setStatus] = useState("SUBMITTED");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState("");
  const [q, setQ] = useState("");
  const [period, setPeriod] = useState("");
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState({ total: 0, hasMore: false, nextOffset: 0, limit: 50 });

  const load = useCallback(async () => {
    const params = new URLSearchParams({ status, offset: String(offset), limit: "50" });
    if (q.trim()) params.set("q", q.trim());
    if (/^\d{4}-\d{2}$/.test(period)) params.set("period", period);
    const response = await fetch(`/api/ewa?${params.toString()}`);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    setRows(data.requests || []);
    setPending(Number(data.pending || 0));
    setPage({
      total: Number(data.filteredTotal || 0),
      hasMore: Boolean(data.page?.hasMore),
      nextOffset: Number(data.page?.nextOffset || 0),
      limit: Number(data.page?.limit || 50),
    });
  }, [status, q, period, offset]);

  useEffect(() => {
    void load().catch((error) =>
      setMessage(error instanceof Error ? error.message : "Gagal memuat"),
    );
  }, [load]);

  async function act(id: string, action: string, extra: Record<string, string> = {}) {
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
      if (!response.ok)
        throw new Error(data.error || `HTTP ${response.status}`);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Gagal memproses");
    } finally {
      setBusy("");
    }
  }

  async function disburse(id: string) {
    const source = window.prompt("Sumber pencairan (contoh: E2PAY, BANK_TRANSFER):", "BANK_TRANSFER")?.trim();
    if (!source) return;
    const reference = window.prompt("Nomor referensi transaksi:")?.trim();
    if (!reference) return;
    const transactionDate = window.prompt("Tanggal transaksi (YYYY-MM-DD):", new Date().toISOString().slice(0, 10))?.trim();
    if (!transactionDate) return;
    await act(id, "DISBURSE", { source, reference, transactionDate });
  }

  return (
    <section className="portal-workspace">
      <div className="page-heading">
        <div>
          <span className="page-eyebrow">Employee portal</span>
          <h1>Advance Salary</h1>
          <p>
            Pengajuan EWA dari portal karyawan. Persetujuan dan pencairan memakai
            maker-checker; pencairan wajib memiliki bukti transaksi. Potongan masuk
            ke pay run saat input difinalisasi dan status lunas hanya berasal dari
            rekonsiliasi payroll.
          </p>
        </div>
        <span className="status-pill">{pending} menunggu</span>
      </div>
      <div className="portal-toolbar">
        {[
          "SUBMITTED",
          "APPROVED",
          "DISBURSED",
          "REPAYING",
          "REPAID",
          "REJECTED",
          "CANCELLED",
          "",
        ].map((value) => (
          <button
            key={value || "ALL"}
            type="button"
            className={`btn${status === value ? " btn-primary" : ""}`}
            onClick={() => { setStatus(value); setOffset(0); }}
          >
            {value || "Semua"}
          </button>
        ))}
      </div>
      <div className="portal-toolbar">
        <input
          value={q}
          onChange={(event) => { setQ(event.target.value); setOffset(0); }}
          placeholder="Cari nama, kode, atau ID pengajuan"
          aria-label="Cari pengajuan advance"
        />
        <input
          type="month"
          value={period}
          onChange={(event) => { setPeriod(event.target.value); setOffset(0); }}
          aria-label="Filter periode"
        />
        {(q || period) ? (
          <button type="button" className="btn" onClick={() => { setQ(""); setPeriod(""); setOffset(0); }}>
            Reset filter
          </button>
        ) : null}
      </div>
      {message ? (
        <p className="app-notice-bubble app-notice-error" role="status">
          {message}
        </p>
      ) : null}
      <div className="card" style={{ overflowX: "auto" }}>
        <table
          className="data-table"
          style={{ width: "100%", borderCollapse: "collapse" }}
        >
          <thead>
            <tr>
              <th align="left">Karyawan</th>
              <th align="left">Periode</th>
              <th align="right">Cair</th>
              <th align="right">Fee</th>
              <th align="right">Potong gaji</th>
              <th align="left">Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ padding: 18, color: "var(--text3)" }}>
                  Tidak ada pengajuan.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <strong>{row.employee_name || row.employee_id}</strong>
                    <div style={{ fontSize: 11, color: "var(--text3)" }}>
                      {row.employee_code} · {row.client_name}
                    </div>
                  </td>
                  <td>{row.period}</td>
                  <td align="right">{IDR.format(row.amount || 0)}</td>
                  <td align="right">{IDR.format(row.fee || 0)}</td>
                  <td align="right">{IDR.format(row.repayment || 0)}</td>
                  <td>{row.status}</td>
                  <td>
                    {row.status === "SUBMITTED" ? (
                      <span style={{ display: "flex", gap: 6 }}>
                        <button
                          type="button"
                          className="btn btn-primary"
                          disabled={Boolean(busy)}
                          onClick={() => void act(row.id, "APPROVE")}
                        >
                          Setujui
                        </button>
                        <button
                          type="button"
                          className="btn"
                          disabled={Boolean(busy)}
                          onClick={() => void act(row.id, "REJECT")}
                        >
                          Tolak
                        </button>
                      </span>
                    ) : row.status === "APPROVED" ? (
                      <button
                        type="button"
                        className="btn"
                        disabled={Boolean(busy)}
                        onClick={() => void act(row.id, "DISBURSE")}
                      >
                        Tandai cair
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <div className="portal-toolbar" style={{ justifyContent: "space-between" }}>
        <span style={{ fontSize: 12, color: "var(--text3)" }}>
          {page.total ? `${offset + 1}–${Math.min(offset + rows.length, page.total)} dari ${page.total}` : "0 data"}
        </span>
        <span style={{ display: "flex", gap: 8 }}>
          <button type="button" className="btn" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - page.limit))}>
            Sebelumnya
          </button>
          <button type="button" className="btn" disabled={!page.hasMore} onClick={() => setOffset(page.nextOffset)}>
            Berikutnya
          </button>
        </span>
      </div>
    </section>
  );
}
