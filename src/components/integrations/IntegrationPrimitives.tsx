'use client';

import type { IntegrationHealthState } from '@/lib/integration-health';
import { integrationHealthLabel } from '@/lib/integration-health';

export function IntegrationHealthPill({ state, label }: { state:IntegrationHealthState; label?:string }) {
  return <span className={`integration-health-pill integration-health-${state.toLowerCase()}`} role="status" aria-label={`Integration health: ${label || integrationHealthLabel(state)}`}>
    {label || integrationHealthLabel(state)}
  </span>;
}

export function IntegrationPagination({
  offset,
  limit,
  total,
  count,
  disabled,
  onPrevious,
  onNext,
}: {
  offset:number;
  limit:number;
  total:number;
  count:number;
  disabled?:boolean;
  onPrevious:()=>void;
  onNext:()=>void;
}) {
  const hasMore = offset + count < total;
  return <nav className="integration-pagination" aria-label="Pagination">
    <button type="button" className="btn" disabled={disabled || offset <= 0} onClick={onPrevious}>Sebelumnya</button>
    <span aria-live="polite">{total ? offset + 1 : 0}–{Math.min(offset + count, total)} dari {total}</span>
    <button type="button" className="btn" disabled={disabled || !hasMore} onClick={onNext}>Berikutnya</button>
  </nav>;
}
