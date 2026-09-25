"use client";

import { useCallback, useEffect, useState } from "react";

type LoginRow = {
  id: string;
  employee_id_input?: string;
  employee_id?: string;
  employee_name?: string;
  employee_code?: string;
  ip?: string;
  success: number;
  reason?: string;
  created_at: string;
};

type EventRow = {
  id: string;
  timestamp: string;
  username?: string;
  role?: string;
  action: string;
  detail?: string;
  entity?: string;
  entity_id?: string;
};

export default function PortalAudit() {
  const [logins, setLogins] = useState<LoginRow[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [failed, setFailed] = useState(0);
  const [tab, setTab] = useState<"logins" | "events">("logins");
  const [message, setMessage] = useState("");
  const [q, setQ] = useState("");
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState({ total: 0, hasMore: false, nextOffset: 0, limit: 50 });

  const load = useCallback(async () => {
    const params = new URLSearchParams({ kind: tab, offset: String(offset), limit: "50" });
    if (q.trim()) params.set("q", q.trim());
    const response = await fetch(`/api/portal-audit?${params.toString()}`);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    setLogins(data.logins || []);
    setEvents(data.events || []);
    setFailed(Number(data.failedLogins || 0));
    setPage({
      total: Number(data.page?.total || 0),
      hasMore: Boolean(data.page?.hasMore),
      nextOffset: Number(data.page?.nextOffset || 0),
      limit: Number(data.page?.limit || 50),
    });
  }, [tab, q, offset]);

  useEffect(() => {
    void load().catch((error) =>
      setMessage(error instanceof Error ? error.message : "Gagal memuat"),
    );
  }, [load]);

  return (
    <section className="portal-workspace">
      <div className="page-heading">
        <div>
          <span className="page-eyebrow">Employee portal</span>
          <h1>Portal Audit</h1>
          <p>
            Login ESS dan jejak advance salary. Tidak membaca atau mengubah pay
            run, PI, atau billing.
          </p>
        </div>
        <span className="status-pill">{failed} login gagal</span>
      </div>
      <div className="portal-toolbar">
        <button
          type="button"
          className={`btn${tab === "logins" ? " btn-primary" : ""}`}
          onClick={() => { setTab("logins"); setOffset(0); }}
        >
          Login
        </button>
        <button
          type="button"
          className={`btn${tab === "events" ? " btn-primary" : ""}`}
          onClick={() => { setTab("events"); setOffset(0); }}
        >
          Advance & kredensial
        </button>
      </div>
      <div className="portal-toolbar">
        <input
          value={q}
          onChange={(event) => { setQ(event.target.value); setOffset(0); }}
          placeholder={tab === "logins" ? "Cari karyawan, input, atau IP" : "Cari aksi, actor, detail, atau entity ID"}
          aria-label="Cari audit portal"
        />
        {q ? (
          <button type="button" className="btn" onClick={() => { setQ(""); setOffset(0); }}>
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
        {tab === "logins" ? (
          <table
            className="data-table"
            style={{ width: "100%", borderCollapse: "collapse" }}
          >
            <thead>
              <tr>
                <th align="left">Waktu</th>
                <th align="left">Karyawan</th>
                <th align="left">Input</th>
                <th align="left">IP</th>
                <th align="left">Hasil</th>
              </tr>
            </thead>
            <tbody>
              {logins.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    style={{ padding: 18, color: "var(--text3)" }}
                  >
                    Belum ada percobaan login.
                  </td>
                </tr>
              ) : (
                logins.map((row) => (
                  <tr key={row.id}>
                    <td>
                      {String(row.created_at || "")
                        .replace("T", " ")
                        .slice(0, 19)}
                    </td>
                    <td>
                      <strong>
                        {row.employee_name || row.employee_id || "—"}
                      </strong>
                      <div style={{ fontSize: 11, color: "var(--text3)" }}>
                        {row.employee_code}
                      </div>
                    </td>
                    <td>{row.employee_id_input}</td>
                    <td>{row.ip}</td>
                    <td>
                      {Number(row.success) ? "OK" : row.reason || "GAGAL"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        ) : (
          <table
            className="data-table"
            style={{ width: "100%", borderCollapse: "collapse" }}
          >
            <thead>
              <tr>
                <th align="left">Waktu</th>
                <th align="left">Aksi</th>
                <th align="left">Oleh</th>
                <th align="left">Detail</th>
              </tr>
            </thead>
            <tbody>
              {events.length === 0 ? (
                <tr>
                  <td
                    colSpan={4}
                    style={{ padding: 18, color: "var(--text3)" }}
                  >
                    Belum ada jejak portal.
                  </td>
                </tr>
              ) : (
                events.map((row) => (
                  <tr key={row.id}>
                    <td>
                      {String(row.timestamp || "")
                        .replace("T", " ")
                        .slice(0, 19)}
                    </td>
                    <td>{row.action}</td>
                    <td>
                      {row.username} · {row.role}
                    </td>
                    <td>
                      {row.detail}
                      {row.entity_id ? ` · ${row.entity_id}` : ""}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}
      </div>
      <div className="portal-toolbar" style={{ justifyContent: "space-between" }}>
        <span style={{ fontSize: 12, color: "var(--text3)" }}>
          {page.total ? `${offset + 1}–${Math.min(offset + (tab === "logins" ? logins.length : events.length), page.total)} dari ${page.total}` : "0 data"}
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
