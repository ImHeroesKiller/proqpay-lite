"use client";

import { useState } from "react";
import type { EwaRow } from "@/lib/employee-services";

type Props = {
  row: EwaRow;
  busy: boolean;
  error?: string;
  onClose: () => void;
  onConfirm: (input: { source: string; reference: string; transactionDate: string }) => void;
};

export default function DisbursementDialog({ row, busy, error, onClose, onConfirm }: Props) {
  const [source, setSource] = useState("BANK_TRANSFER");
  const [reference, setReference] = useState("");
  const [transactionDate, setTransactionDate] = useState(new Date().toISOString().slice(0, 10));
  const valid = Boolean(source.trim() && reference.trim() && /^\\d{4}-\\d{2}-\\d{2}$/.test(transactionDate));

  return (
    <div
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target && !busy) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 160,
        background: "rgba(10,15,25,.42)",
        display: "grid",
        placeItems: "center",
        padding: 16,
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="ewa-disbursement-title"
        style={{
          width: "min(520px, 100%)",
          maxHeight: "90vh",
          overflow: "auto",
          background: "var(--card,#fff)",
          border: "1px solid var(--border)",
          borderRadius: 18,
          boxShadow: "0 24px 64px rgba(0,0,0,.18)",
          padding: 20,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
          <div>
            <span className="page-eyebrow">Pencairan Advance Salary</span>
            <h2 id="ewa-disbursement-title" style={{ margin: "4px 0" }}>
              {row.employee_name || row.employee_id}
            </h2>
            <div style={{ fontSize: 12, color: "var(--text3)" }}>
              {row.employee_code} · {row.client_name} · {row.period}
            </div>
          </div>
          <button type="button" className="btn" onClick={onClose} disabled={busy} aria-label="Tutup pencairan">
            Tutup
          </button>
        </div>

        <div className="card" style={{ marginTop: 16, padding: 14 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <div style={{ fontSize: 10, color: "var(--text3)" }}>Nilai advance</div>
              <strong>Rp {Number(row.amount || 0).toLocaleString("id-ID")}</strong>
            </div>
            <div>
              <div style={{ fontSize: 10, color: "var(--text3)" }}>Rekening tujuan</div>
              <strong>{row.destination_bank_name || "—"} · •••• {row.destination_account_last4 || "—"}</strong>
            </div>
          </div>
        </div>

        <p style={{ fontSize: 12, color: "var(--text3)", lineHeight: 1.5 }}>
          Approver dan pencatat pencairan harus berbeda. Referensi transaksi menjadi bagian audit trail dan tidak dapat dipakai ulang.
        </p>

        <div style={{ display: "grid", gap: 12 }}>
          <label style={{ display: "grid", gap: 6, fontSize: 12, fontWeight: 650 }}>
            Sumber pencairan
            <select value={source} onChange={(event) => setSource(event.target.value)}>
              <option value="BANK_TRANSFER">Bank Transfer</option>
              <option value="E2PAY">E2Pay</option>
              <option value="OTHER">Lainnya</option>
            </select>
          </label>
          <label style={{ display: "grid", gap: 6, fontSize: 12, fontWeight: 650 }}>
            Referensi transaksi
            <input
              autoFocus
              value={reference}
              placeholder="Contoh: TRX-20260926-001"
              onChange={(event) => setReference(event.target.value)}
            />
          </label>
          <label style={{ display: "grid", gap: 6, fontSize: 12, fontWeight: 650 }}>
            Tanggal transaksi
            <input type="date" value={transactionDate} onChange={(event) => setTransactionDate(event.target.value)} />
          </label>
        </div>

        {error ? <div className="app-notice-bubble app-notice-error" role="alert" style={{ marginTop: 12 }}>{error}</div> : null}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 18 }}>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>Batal</button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!valid || busy}
            onClick={() => onConfirm({ source, reference: reference.trim(), transactionDate })}
          >
            {busy ? "Memproses…" : "Konfirmasi pencairan"}
          </button>
        </div>
      </section>
    </div>
  );
}
