"use client";

import { useEffect } from "react";
import type { FormEvent, ReactNode } from "react";
import { createPortal } from "react-dom";

export function WorkspaceHeader({
  eyebrow,
  title,
  description,
  meta,
  action,
  className = "",
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  meta?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <section className={`ui-workspace-header ${className}`.trim()}>
      <div className="ui-workspace-header-copy">
        {eyebrow ? <span className="ui-eyebrow">{eyebrow}</span> : null}
        <h1>{title}</h1>
        {description ? <p>{description}</p> : null}
        {meta ? <div className="ui-header-meta">{meta}</div> : null}
      </div>
      {action ? <div className="ui-workspace-header-actions">{action}</div> : null}
    </section>
  );
}

export function MetricGrid({ children, compact = false }: { children: ReactNode; compact?: boolean }) {
  return <div className={`ui-metric-grid${compact ? " ui-metric-grid-compact" : ""}`}>{children}</div>;
}

export function MetricCard({
  label,
  value,
  note,
  tone = "neutral",
}: {
  label: ReactNode;
  value: ReactNode;
  note?: ReactNode;
  tone?: "neutral" | "accent" | "success" | "warning" | "danger";
}) {
  return (
    <div className={`card ui-metric-card ui-tone-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {note ? <small>{note}</small> : null}
    </div>
  );
}

export function SectionCard({
  title,
  detail,
  action,
  children,
  className = "",
}: {
  title?: ReactNode;
  detail?: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <section className={`card ui-section-card ${className}`.trim()}>
      {(title || detail || action) ? (
        <div className="ui-section-card-head">
          <div>
            {title ? <h2>{title}</h2> : null}
            {detail ? <p>{detail}</p> : null}
          </div>
          {action ? <div className="ui-section-card-action">{action}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function FilterBar({
  title = "Filter & pencarian",
  detail,
  action,
  children,
  className = "",
}: {
  title?: ReactNode;
  detail?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`card ui-filter-bar ${className}`.trim()}>
      <div className="ui-filter-bar-head">
        <div>
          <strong>{title}</strong>
          {detail ? <span>{detail}</span> : null}
        </div>
        {action}
      </div>
      <div className="ui-filter-grid">{children}</div>
    </section>
  );
}

export function Notice({
  title,
  children,
  tone = "info",
  action,
  role,
}: {
  title?: ReactNode;
  children: ReactNode;
  tone?: "info" | "success" | "warning" | "error";
  action?: ReactNode;
  role?: "status" | "alert";
}) {
  return (
    <div className={`app-notice-bubble ui-notice ui-notice-${tone}`} role={role || (tone === "error" ? "alert" : "status")}>
      <div>
        {title ? <strong>{title}</strong> : null}
        <span>{children}</span>
      </div>
      {action}
    </div>
  );
}

export function StatusBadge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "success" | "warning" | "danger" | "accent";
}) {
  return <span className={`ui-status-badge ui-status-${tone}`}>{children}</span>;
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title: ReactNode;
  body?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="ui-state ui-empty-state">
      <strong>{title}</strong>
      {body ? <span>{body}</span> : null}
      {action}
    </div>
  );
}

export function LoadingState({
  title,
  body,
}: {
  title: ReactNode;
  body?: ReactNode;
}) {
  return (
    <div className="card ui-state ui-loading-state" aria-busy="true">
      <span className="ui-loading-dot" aria-hidden="true" />
      <strong>{title}</strong>
      {body ? <span>{body}</span> : null}
    </div>
  );
}

export function DataTable({
  headers,
  rows,
  className = "",
}: {
  headers: ReactNode[];
  rows: ReactNode[][];
  className?: string;
}) {
  return (
    <div className={`ui-table-wrap ${className}`.trim()}>
      <table className="ui-data-table">
        <thead>
          <tr>{headers.map((header, index) => <th key={index}>{header}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function FormField({
  label,
  help,
  children,
  className = "",
}: {
  label: ReactNode;
  help?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={`ui-form-field ${className}`.trim()}>
      <span>{label}</span>
      {children}
      {help ? <small>{help}</small> : null}
    </label>
  );
}

export function FormGrid({ children }: { children: ReactNode }) {
  return <div className="ui-form-grid">{children}</div>;
}

export function Tabs({
  items,
  value,
  onChange,
  ariaLabel = "Navigasi bagian",
}: {
  items: Array<{ value: string; label: ReactNode }>;
  value: string;
  onChange: (value: string) => void;
  ariaLabel?: string;
}) {
  return (
    <div className="ui-tabs" role="tablist" aria-label={ariaLabel}>
      {items.map((item) => (
        <button
          key={item.value}
          type="button"
          role="tab"
          aria-selected={value === item.value}
          className={value === item.value ? "active" : ""}
          onClick={() => onChange(item.value)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

export function ModalShell({
  title,
  children,
  onClose,
  className = "",
}: {
  title: ReactNode;
  children: ReactNode;
  onClose: () => void;
  className?: string;
}) {
  useEffect(() => {
    if (typeof document === "undefined") return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="ui-modal-backdrop" onMouseDown={onClose}>
      <section
        className={`card ui-modal ${className}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === "string" ? title : undefined}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="ui-modal-head">
          <h2>{title}</h2>
          <button type="button" className="btn" aria-label="Tutup dialog" onClick={onClose}>✕</button>
        </div>
        {children}
      </section>
    </div>,
    document.body,
  );
}

export function FormActions({
  onSubmit,
  submitLabel,
  children,
}: {
  onSubmit: () => void;
  submitLabel: string;
  children: ReactNode;
}) {
  return (
    <form
      className="ui-form-stack"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      {children}
      <div className="ui-form-actions">
        <button className="btn btn-primary" type="submit">{submitLabel}</button>
      </div>
    </form>
  );
}


export function ActionBar({
  children,
  meta,
  sticky = false,
  className = "",
}: {
  children: ReactNode;
  meta?: ReactNode;
  sticky?: boolean;
  className?: string;
}) {
  return (
    <div className={`ui-action-bar${sticky ? " ui-action-bar-sticky" : ""} ${className}`.trim()}>
      <div className="ui-action-bar-meta">{meta}</div>
      <div className="ui-action-bar-actions">{children}</div>
    </div>
  );
}

export function Pagination({
  page,
  pageCount,
  total,
  from,
  to,
  onPrevious,
  onNext,
  previousDisabled,
  nextDisabled,
  compact = false,
}: {
  page?: number;
  pageCount?: number;
  total?: number;
  from?: number;
  to?: number;
  onPrevious: () => void;
  onNext: () => void;
  previousDisabled?: boolean;
  nextDisabled?: boolean;
  compact?: boolean;
}) {
  const label = typeof from === "number" && typeof to === "number" && typeof total === "number"
    ? `${from}–${to} dari ${total}`
    : typeof page === "number" && typeof pageCount === "number"
      ? `Halaman ${page} dari ${pageCount}`
      : typeof total === "number"
        ? `${total} data`
        : "";
  return (
    <nav className={`ui-pagination${compact ? " ui-pagination-compact" : ""}`} aria-label="Navigasi halaman">
      <span aria-live="polite">{label}</span>
      <div>
        <button type="button" className="btn" disabled={Boolean(previousDisabled)} onClick={onPrevious}>Sebelumnya</button>
        <button type="button" className="btn" disabled={Boolean(nextDisabled)} onClick={onNext}>Berikutnya</button>
      </div>
    </nav>
  );
}

export function DataTableState({
  loading,
  empty,
  loadingTitle = "Memuat data…",
  loadingBody,
  emptyTitle = "Belum ada data",
  emptyBody,
  onRetry,
  error,
}: {
  loading?: boolean;
  empty?: boolean;
  loadingTitle?: ReactNode;
  loadingBody?: ReactNode;
  emptyTitle?: ReactNode;
  emptyBody?: ReactNode;
  onRetry?: () => void;
  error?: ReactNode;
}) {
  if (error) {
    return <Notice tone="error" title="Gagal memuat data" action={onRetry ? <button type="button" className="btn" onClick={onRetry}>Coba lagi</button> : undefined}>{error}</Notice>;
  }
  if (loading) return <LoadingState title={loadingTitle} body={loadingBody} />;
  if (empty) return <EmptyState title={emptyTitle} body={emptyBody} />;
  return null;
}
