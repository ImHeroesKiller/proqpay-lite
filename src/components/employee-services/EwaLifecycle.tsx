"use client";

import type { EwaRow } from "@/lib/employee-services";
import { ewaMeta, formatPortalDate } from "@/lib/employee-services";

const IDR = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
});

export function EwaStatusBadge({ status }: { status?: string }) {
  const meta = ewaMeta(status);
  return (
    <span className={`status-pill ewa-tone-${meta.tone}`} aria-label={`Status: ${meta.label}`}>
      {meta.label}
    </span>
  );
}

export function EwaLifecycleProgress({ status }: { status?: string }) {
  const meta = ewaMeta(status);
  return (
    <div className="ewa-progress" aria-label={`Tahap ${meta.step} dari 5: ${meta.label}`}>
      {[1, 2, 3, 4, 5].map((step) => (
        <span key={step} className={step <= meta.step ? "done" : ""} aria-hidden="true" />
      ))}
    </div>
  );
}

export function EwaDetailPanel({
  row,
  onClose,
}: {
  row: EwaRow;
  onClose: () => void;
}) {
  const meta = ewaMeta(row.status);
  return (
    <div
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 150,
        background: "rgba(10,15,25,.38)",
        display: "flex",
        justifyContent: "flex-end",
      }}
    >
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="ewa-detail-title"
        style={{
          width: "min(500px,100%)",
          height: "100%",
          overflow: "auto",
          background: "var(--card,#fff)",
          borderLeft: "1px solid var(--border)",
          boxShadow: "-18px 0 40px rgba(0,0,0,.14)",
          padding: 20,
        }}
      >
        <div className="ewa-detail-head">
          <div>
            <strong id="ewa-detail-title">{row.id}</strong>
            <div className="ewa-muted">
              {row.employee_name || row.employee_id} · {meta.label}
            </div>
          </div>
          <button type="button" className="btn" onClick={onClose} aria-label="Tutup detail advance">
            Tutup
          </button>
        </div>
        <EwaLifecycleProgress status={row.status} />
        <p className="ewa-lifecycle-note">{meta.note}</p>
        <div className="ewa-detail-grid">
          <div><span>Diajukan</span>{formatPortalDate(row.created_at)}</div>
          <div><span>Disetujui</span>{formatPortalDate(row.approved_at)} · {row.approved_by || "—"}</div>
          <div><span>Dicairkan</span>{formatPortalDate(row.disbursed_at)} · {row.disbursed_by || "—"}</div>
          <div><span>Bukti transaksi</span>{row.disbursement_source || "—"} · {row.disbursement_reference || "—"}</div>
          <div><span>Rekening tujuan</span>{row.destination_bank_name || "—"} · •••• {row.destination_account_last4 || "—"}</div>
          <div><span>Nilai</span>{IDR.format(row.amount || 0)} + fee {IDR.format(row.fee || 0)}</div>
        </div>
      </aside>
    </div>
  );
}
