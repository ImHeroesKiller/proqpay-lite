"use client";

import {
  EmptyState as UiEmptyState,
  LoadingState as UiLoadingState,
  Notice as UiNotice,
} from "@/components/ui/UnifiedSystem";

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
    return <UiLoadingState title={loadingText} />;
  }
  if (error) {
    return (
      <UiNotice
        tone="error"
        title="Employee Services"
        action={<button type="button" className="btn" onClick={onRetry}>Coba lagi</button>}
      >
        {error}
      </UiNotice>
    );
  }
  if (empty) {
    return (
      <UiEmptyState
        title={emptyTitle}
        body={emptyBody}
        action={onReset ? <button type="button" className="btn" onClick={onReset}>Reset filter</button> : null}
      />
    );
  }
  return null;
}
