'use client';

export type IntegrationFilterValues = {
  q:string;
  appStatus:string;
  eventType:string;
  statusClass:string;
  from:string;
  to:string;
};

export function IntegrationFilterBar({
  value,
  disabled,
  onChange,
  onReset,
}: {
  value:IntegrationFilterValues;
  disabled?:boolean;
  onChange:(patch:Partial<IntegrationFilterValues>)=>void;
  onReset:()=>void;
}) {
  const hasFilters = Boolean(value.q || value.appStatus || value.eventType || value.statusClass || value.from || value.to);
  return <fieldset className="integration-filter-panel" disabled={disabled} aria-label="Filter aktivitas integrasi">
    <legend className="sr-only">Filter aktivitas integrasi</legend>
    <label htmlFor="integration-search"><span>Search</span><input id="integration-search" value={value.q} onChange={(event) => onChange({ q:event.target.value })} placeholder="App, endpoint, correlation ID…" /></label>
    <label htmlFor="integration-app-status"><span>App status</span><select id="integration-app-status" value={value.appStatus} onChange={(event) => onChange({ appStatus:event.target.value })}><option value="">Semua</option><option value="ACTIVE">Trusted</option><option value="OBSERVED">Observed</option><option value="INACTIVE">Inactive</option><option value="REVOKED">Revoked</option></select></label>
    <label htmlFor="integration-event-type"><span>Event type</span><select id="integration-event-type" value={value.eventType} onChange={(event) => onChange({ eventType:event.target.value })}><option value="">Semua</option><option value="CONNECTION">Connection</option><option value="DATA_PULL">Data pull</option><option value="REQUEST">Request</option></select></label>
    <label htmlFor="integration-http-result"><span>HTTP result</span><select id="integration-http-result" value={value.statusClass} onChange={(event) => onChange({ statusClass:event.target.value })}><option value="">Semua</option><option value="SUCCESS">2xx/3xx</option><option value="ERROR">4xx/5xx</option></select></label>
    <label htmlFor="integration-date-from"><span>Dari</span><input id="integration-date-from" type="date" value={value.from} onChange={(event) => onChange({ from:event.target.value })} /></label>
    <label htmlFor="integration-date-to"><span>Sampai</span><input id="integration-date-to" type="date" value={value.to} onChange={(event) => onChange({ to:event.target.value })} /></label>
    <button type="button" className="btn" disabled={!hasFilters || disabled} onClick={onReset}>Reset filter</button>
  </fieldset>;
}
