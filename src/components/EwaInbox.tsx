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
  estimated_net_salary?: number;
  payroll_net_amount?: number;
  salary_source_period?: string;
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
  const [actorRole, setActorRole] = useState("");

  const load = useCallback(async () => {
    const response = await fetch(
      `/api/ewa?status=${encodeURIComponent(status)}`,
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    setRows(data.requests || []);
    setPending(Number(data.pending || 0));
    setActorRole(String(data.actorRole || ""));
  }, [status]);

  useEffect(() => {
    void load().catch((error) =>
      setMessage(error instanceof Error ? error.message : "Gagal memuat"),
    );
  }, [load]);

  async function act(id: string, action: string) {
    if (busy) return;
    setBusy(id + action);
    setMessage("");
    try {
      const response = await fetch("/api/ewa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action }),
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

  return (
    <section className="portal-workspace">
      <div className="page-heading">
        <div>
          <span className="page-eyebrow">Employee portal</span>
          <h1>Advance Salary</h1>
          <p>
            Pengajuan EWA dari portal karyawan. Persetujuan dan pencairan tidak
            mengubah PI atau billing. Potongan masuk ke pay run saat input
            difinalisasi.
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
          "",
        ].map((value) => (
          <button
            key={value || "ALL"}
            type="button"
            className={`btn${status === value ? " btn-primary" : ""}`}
            onClick={() => setStatus(value)}
          >
            {value || "Semua"}
          </button>
        ))}
      </div>
      {message ? (
        <div className="app-notice-bubble app-notice-error" role="alert"><strong>Perlu perhatian</strong><span>{message}</span><button type="button" aria-label="Tutup pesan" onClick={() => setMessage("")}>✕</button></div>
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
              <th align="right">Estimasi gaji</th>
              <th align="right">Payroll periode</th>
              <th align="right">Setelah advance</th>
              <th align="left">Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={10} style={{ padding: 18, color: "var(--text3)" }}>
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
                  <td align="right">{IDR.format(row.estimated_net_salary || 0)}<div style={{fontSize:10,color:"var(--text3)"}}>{row.salary_source_period || "master compensation"}</div></td>
                  <td align="right">{IDR.format(row.payroll_net_amount || 0)}<div style={{fontSize:10,color:"var(--text3)"}}>{row.period}</div></td>
                  <td align="right"><strong>{IDR.format(Math.max(0, (row.payroll_net_amount || row.estimated_net_salary || 0) - (row.repayment || 0)))}</strong></td>
                  <td>{row.status}</td>
                  <td>
                    {row.status === "SUBMITTED" && ["SUPER_ADMIN", "PAYROLL_CONTROLLER"].includes(actorRole) ? (
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
                    ) : row.status === "APPROVED" && ["SUPER_ADMIN", "PAYROLL_PROCESSOR"].includes(actorRole) ? (
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
    </section>
  );
}
