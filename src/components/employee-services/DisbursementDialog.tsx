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
      className="es-modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target && !busy) onClose();
      }}
    >
      <section
        className="es-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ewa-disbursement-title"
      >
        <div className="es-modal-head">
          <div>
            <span className="page-eyebrow">Pencairan Advance Salary</span>
            <h2 id="ewa-disbursement-title" className="ewa-dialog-title">
              {row.employee_name || row.employee_id}
            </h2>
            <div className="ewa-dialog-meta">
              {row.employee_code} · {row.client_name} · {row.period}
            </div>
          </div>
          <button type="button" className="btn" onClick={onClose} disabled={busy} aria-label="Tutup pencairan">
            Tutup
          </button>
        </div>

        <div className="card ewa-disbursement-summary">
          <div className="ewa-disbursement-summary-grid">
            <div>
              <span>Nilai advance</span>
              <strong>Rp {Number(row.amount || 0).toLocaleString("id-ID")}</strong>
            </div>
            <div>
              <span>Rekening tujuan</span>
              <strong>{row.destination_bank_name || "—"} · •••• {row.destination_account_last4 || "—"}</strong>
            </div>
          </div>
        </div>

        <p className="ewa-disbursement-note">
          Approver dan pencatat pencairan harus berbeda. Referensi transaksi menjadi bagian audit trail dan tidak dapat dipakai ulang.
        </p>

        <div className="es-form">
          <label >
            Sumber pencairan
            <select value={source} onChange={(event) => setSource(event.target.value)}>
              <option value="BANK_TRANSFER">Bank Transfer</option>
              <option value="E2PAY">E2Pay</option>
              <option value="OTHER">Lainnya</option>
            </select>
          </label>
          <label >
            Referensi transaksi
            <input
              autoFocus
              value={reference}
              placeholder="Contoh: TRX-20260926-001"
              onChange={(event) => setReference(event.target.value)}
            />
          </label>
          <label >
            Tanggal transaksi
            <input type="date" value={transactionDate} onChange={(event) => setTransactionDate(event.target.value)} />
          </label>
        </div>

        {error ? <div className="app-notice-bubble app-notice-error ewa-dialog-error" role="alert">{error}</div> : null}

        <div className="ewa-disbursement-actions">
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
