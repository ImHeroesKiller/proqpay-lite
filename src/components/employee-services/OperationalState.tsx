"use client";

export function EmployeeServiceState({
  loading,
  error,
  empty,
  loadingText = "Memuat Employee Services…",
  emptyTitle,
  emptyBody,
  onRetry,
  onReset,
}: {
  loading: boolean;
  error?: string;
  empty: boolean;
  loadingText?: string;
  emptyTitle: string;
  emptyBody: string;
  onRetry: () => void;
  onReset?: () => void;
}) {
  if (loading) {
    return (
      <div className="card employee-service-state" role="status" aria-live="polite" aria-busy="true">
        <strong>{loadingText}</strong>
      </div>
    );
  }
  if (error) {
    return (
      <div className="app-notice-bubble app-notice-error employee-service-state" role="alert">
        <span>{error}</span>
        <button type="button" className="btn" onClick={onRetry}>Coba lagi</button>
      </div>
    );
  }
  if (empty) {
    return (
      <div className="card employee-service-state employee-service-empty" role="status">
        <strong>{emptyTitle}</strong>
        <p>{emptyBody}</p>
        {onReset ? <button type="button" className="btn" onClick={onReset}>Reset filter</button> : null}
      </div>
    );
  }
  return null;
}
