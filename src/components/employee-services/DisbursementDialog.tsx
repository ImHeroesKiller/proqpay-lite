"use client";

import { useEffect, useState } from "react";
import type { EwaRow } from "@/lib/employee-services";
import {
  FormField as UiFormField,
  FormGrid as UiFormGrid,
  MetricCard as UiMetricCard,
  MetricGrid as UiMetricGrid,
  ModalShell as UiModalShell,
  Notice as UiNotice,
} from "@/components/ui/UnifiedSystem";

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

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [busy, onClose]);

  return (
    <UiModalShell
      title={`Pencairan Advance Salary · ${row.employee_name || row.employee_id}`}
      onClose={() => { if (!busy) onClose(); }}
      className="es-modal"
    >
      <div className="ewa-dialog-meta">
        {row.employee_code} · {row.client_name} · {row.period}
      </div>

      <UiMetricGrid compact>
        <UiMetricCard label="Nilai advance" value={`Rp ${Number(row.amount || 0).toLocaleString("id-ID")}`} />
        <UiMetricCard label="Rekening tujuan" value={`${row.destination_bank_name || "—"} · •••• ${row.destination_account_last4 || "—"}`} />
      </UiMetricGrid>

      <UiNotice tone="info" title="Maker-checker">
        Approver dan pencatat pencairan harus berbeda. Referensi transaksi menjadi bagian audit trail dan tidak dapat dipakai ulang.
      </UiNotice>

      <UiFormGrid>
        <UiFormField label="Sumber pencairan">
          <select value={source} onChange={(event) => setSource(event.target.value)}>
            <option value="BANK_TRANSFER">Bank Transfer</option>
            <option value="E2PAY">E2Pay</option>
            <option value="OTHER">Lainnya</option>
          </select>
        </UiFormField>
        <UiFormField label="Referensi transaksi">
          <input
            autoFocus
            value={reference}
            placeholder="Contoh: TRX-20260926-001"
            onChange={(event) => setReference(event.target.value)}
          />
        </UiFormField>
        <UiFormField label="Tanggal transaksi">
          <input type="date" value={transactionDate} onChange={(event) => setTransactionDate(event.target.value)} />
        </UiFormField>
      </UiFormGrid>

      {error ? <UiNotice tone="error" title="Pencairan">{error}</UiNotice> : null}

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
    </UiModalShell>
  );
}
