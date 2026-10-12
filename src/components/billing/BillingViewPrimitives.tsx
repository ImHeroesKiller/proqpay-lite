"use client";

import {billingDateLabel} from '@/lib/billing-ui';
import {
  DataTable as UiDataTable, EmptyState as UiEmptyState,
  FormActions as UiFormActions, FormField as UiFormField,
  MetricCard as UiMetricCard, ModalShell as UiModalShell,
  SectionCard as UiSectionCard, StatusBadge as UiStatusBadge,
} from '@/components/ui/UnifiedSystem';

export function Modal({ title, close, children }: any) {
  return <UiModalShell title={title} onClose={close} className="billing-modal">{children}</UiModalShell>;
}

export function Panel({ title, detail, action, children }: any) {
  return <UiSectionCard title={title} detail={detail} action={action}>{children}</UiSectionCard>;
}
export function Metric({ label, value, note, danger = false }: any) {
  return <UiMetricCard label={label} value={value} note={note} tone={danger ? "danger" : "neutral"} />;
}
export function Table({ headers, rows }: any) {
  return <UiDataTable headers={headers} rows={rows} />;
}
export function Empty({ text }: any) {
  return <UiEmptyState title={text} />;
}
export function Badge({ text }: any) {
  const good = /PAID|ISSUED|APPROVED|CURRENT|NON_PKP|CLEAR/.test(text);
  const bad = /REJECT|OVERDUE|DISPUT|BLOCKED/.test(text);
  const warn = /PENDING|WARNING|REVIEW/.test(text);
  return (
    <UiStatusBadge tone={good ? "success" : bad ? "danger" : warn ? "warning" : "neutral"}>
      {String(text || "-").replaceAll("_", " ")}
    </UiStatusBadge>
  );
}
export function Form({ submit, buttonText, children }: any) {
  return <UiFormActions onSubmit={submit} submitLabel={buttonText}>{children}</UiFormActions>;
}
export function Field({ label, value, onChange, type = "text", required }: any) {
  return (
    <UiFormField label={label}>
      <input
        type={type}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        required={required ?? ["email", "date"].includes(type)}
      />
    </UiFormField>
  );
}
export function Select({ label, value, onChange, options }: any) {
  return (
    <UiFormField label={label}>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o: string) => <option key={o}>{o}</option>)}
      </select>
    </UiFormField>
  );
}
export function Info({ label, value }: any) {
  return <div className="ui-info-row"><span>{label}</span><strong>{value}</strong></div>;
}
export const date = billingDateLabel;
export const csvCell = (v: any) => `"${String(v ?? "").replaceAll('"', '""')}"`;
export const muted: any = { color: "var(--text3)", fontSize: 11 };
export const grid2: any = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))",
  gap: 12,
};
export const th: any = {
  textAlign: "left",
  padding: "10px 12px",
  background: "var(--bg-subtle)",
  color: "var(--text2)",
  fontSize: 10,
  textTransform: "uppercase",
  whiteSpace: "nowrap",
};
export const td: any = { padding: "11px 12px", verticalAlign: "middle" };
export const button: any = {
  border: 0,
  borderRadius: 8,
  background: "var(--accent)",
  color: "var(--accent-contrast)",
  padding: "7px 10px",
  fontSize: 11,
  fontWeight: 650,
  cursor: "pointer",
  whiteSpace: "nowrap",
};
export const secondary: any = {
  ...button,
  background: "var(--bg-surface)",
  color: "var(--text2)",
  border: "1px solid var(--border)",
};
export const linkButton: any = {
  border: 0,
  background: "transparent",
  color: "var(--accent)",
  fontWeight: 700,
  cursor: "pointer",
  padding: 0,
};
export const iconButton: any = {
  border: 0,
  background: "var(--bg-subtle)",
  color: "var(--text)",
  borderRadius: 8,
  width: 32,
  height: 32,
  cursor: "pointer",
};
export const input: any = {
  width: "100%",
  boxSizing: "border-box",
  border: "1px solid var(--border)",
  borderRadius: 8,
  background: "var(--bg-surface)",
  color: "var(--text)",
  padding: "9px 10px",
  fontSize: 12,
};
export const labelStyle: any = {
  display: "grid",
  gap: 6,
  fontSize: 11,
  fontWeight: 650,
  color: "var(--text2)",
};
export const tabStyle = (active: boolean): any => ({
  border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`,
  borderRadius: 9,
  background: active ? "var(--accent-soft)" : "var(--bg-surface)",
  color: active ? "var(--accent)" : "var(--text2)",
  padding: "9px 12px",
  fontSize: 12,
  fontWeight: 650,
  cursor: "pointer",
  whiteSpace: "nowrap",
});
