"use client";

import type { EwaRow } from "@/lib/employee-services";
import { ewaMeta, formatPortalDate } from "@/lib/employee-services";
import { ModalShell, StatusBadge as UiStatusBadge } from "@/components/ui/UnifiedSystem";

const IDR = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
});

export function EwaStatusBadge({ status }: { status?: string }) {
  const meta = ewaMeta(status);
  const tone = meta.tone === "danger" ? "danger" : meta.tone === "warning" ? "warning" : meta.tone === "success" ? "success" : "neutral";
  return <UiStatusBadge tone={tone}>{meta.label}</UiStatusBadge>;
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
    <ModalShell title="Detail pengajuan advance" onClose={onClose} className="ewa-approval-detail">
      <div className="ewa-detail-head"><div><strong>{row.employee_name || row.employee_id}</strong><div className="ewa-muted">{row.employee_code} · {row.client_name} · {row.id}</div></div><EwaStatusBadge status={row.status}/></div>
        <EwaLifecycleProgress status={row.status} />
        <p className="ewa-lifecycle-note">{meta.note}</p>
        <div className="ewa-detail-grid es-detail-grid">
          <div><span>Gaji acuan</span>{row.salary_reference_snapshot != null ? IDR.format(row.salary_reference_snapshot) : "—"} · {row.salary_source_period_snapshot || "Belum tercatat"}</div>
          <div><span>Total potong payroll</span>{IDR.format(row.repayment || 0)}</div>
          <div><span>Keputusan klien</span>{row.client_approval_status || "PENDING"} · {row.client_approved_by || "—"}<br/>{formatPortalDate(row.client_decided_at)}</div>
          <div><span>Keputusan Processor</span>{row.decided_by || row.approved_by || "—"}<br/>{formatPortalDate(row.decided_at || row.approved_at)}</div>
          <div><span>Diajukan</span>{formatPortalDate(row.created_at)}</div>
          <div><span>Disetujui</span>{formatPortalDate(row.approved_at)} · {row.approved_by || "—"}</div>
          <div><span>Dicairkan</span>{formatPortalDate(row.disbursed_at)} · {row.disbursed_by || "—"}</div>
          <div><span>Bukti transaksi</span>{row.disbursement_source || "—"} · {row.disbursement_reference || "—"}</div>
          <div><span>Rekening tujuan</span>{row.destination_bank_name || "—"} · •••• {row.destination_account_last4 || "—"}</div>
          <div><span>Nilai</span>{IDR.format(row.amount || 0)} + fee {IDR.format(row.fee || 0)}</div>
        </div>
        {row.client_decision_note || row.decision_note ? <p className="ewa-detail-note"><strong>Catatan keputusan</strong><br/>{row.client_decision_note || row.decision_note}</p> : null}
        <p className="ewa-detail-note">Persetujuan Controller dan eksekusi dana dicatat melalui menu Pembayaran. Transfer tetap menunggu persetujuan, funding, dan limit yang tervalidasi.</p>
    </ModalShell>
  );
}
