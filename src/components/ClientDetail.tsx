'use client';

import { useMemo, useState } from 'react';
import { formatIDRShort } from '@/lib/format';
import ActivityTimeline from './ActivityTimeline';
import PanelPagination from './PanelPagination';
import { buildClientInsights } from '@/lib/client-insights';

function pageOf<T>(items: T[], page: number, size: number) {
  const pageCount = Math.max(1, Math.ceil(items.length / size));
  const safePage = Math.min(page, pageCount);
  return { pageCount, safePage, visible: items.slice((safePage - 1) * size, safePage * size) };
}

export default function ClientDetail({ db, pageSize = 5, onOpenEmployees }: { db: any; pageSize?: number; onOpenEmployees?: (region?: string) => void }) {
  const clients = db.companies?.map((company: any) => company.name) || [];
  const [selected, setSelected] = useState(clients[0] || '');
  const [employeePage, setEmployeePage] = useState(1);
  const [regionPage, setRegionPage] = useState(1);
  const [insightPage, setInsightPage] = useState(1);
  const [billingPage, setBillingPage] = useState(1);

  const info = useMemo(() => {
    const employees = db.employees?.filter((employee: any) => employee.company === selected) || [];
    const regionCounts = new Map<string, number>();
    employees.forEach((employee: any) => {
      const region = employee.region || employee.province;
      if (region) regionCounts.set(region, (regionCounts.get(region) || 0) + 1);
    });
    const regions = [...regionCounts.entries()].sort((a, b) => b[1] - a[1]);
    const invoices = (db.invoices || []).filter((invoice: any) => invoice.company === selected);
    const billing = invoices.map((invoice: any) => ({
      ...invoice,
      ar: (db.arMonitor || []).find((item: any) => item.company === selected && item.invoiceId === invoice.id),
    }));
    return { employees, regions, billing, insights: buildClientInsights(db, selected) };
  }, [db, selected]);

  const employeeData = pageOf(info.employees, employeePage, pageSize);
  const regionData = pageOf(info.regions, regionPage, pageSize);
  const insightData = pageOf(info.insights, insightPage, pageSize);
  const billingData = pageOf(info.billing, billingPage, pageSize);

  function changeClient(value: string) {
    setSelected(value);
    setEmployeePage(1);
    setRegionPage(1);
    setInsightPage(1);
    setBillingPage(1);
  }

  return (
    <section className="client-detail dashboard-animated-section">
      <div className="client-detail-header">
        <div><span className="page-eyebrow">Client intelligence</span><h2>Detail Klien</h2><p>Tenaga kerja, area, insight, billing, dan aktivitas dalam satu konteks.</p></div>
        <label><span>Klien aktif</span><select value={selected} onChange={(event) => changeClient(event.target.value)}>{clients.map((client: string) => <option key={client}>{client}</option>)}</select></label>
      </div>

      <div className="client-detail-grid">
        <div className="card client-detail-panel client-employees-panel">
          <div className="client-panel-heading"><div><span>Workforce</span><h3>Employee List</h3></div><small>{info.employees.length} karyawan</small></div>
          <div className="client-employee-scroll">
            <table className="client-employee-table">
              <thead><tr>{['ID', 'Nama', 'Posisi', 'Status', 'Wilayah', 'Gaji'].map((heading) => <th key={heading}>{heading}</th>)}</tr></thead>
              <tbody key={employeeData.safePage} className="paginated-content">
                {employeeData.visible.map((employee: any) => <tr key={employee.id} onClick={() => onOpenEmployees?.()} tabIndex={0} onKeyDown={(event) => { if (event.key === 'Enter') onOpenEmployees?.(); }}><td>{employee.id}</td><td><strong>{employee.name}</strong></td><td>{employee.position || '-'}</td><td><span className={employee.status === 'TETAP' ? 'client-status active' : 'client-status'}>{employee.status || '-'}</span></td><td>{employee.region || '-'}</td><td>{formatIDRShort(employee.salaryGross)}</td></tr>)}
              </tbody>
            </table>
            {!info.employees.length ? <div className="client-panel-empty">Belum ada karyawan.</div> : null}
          </div>
          <PanelPagination page={employeeData.safePage} pageCount={employeeData.pageCount} total={info.employees.length} label="karyawan" onPage={setEmployeePage} />
        </div>

        <div className="card client-detail-panel">
          <div className="client-panel-heading"><div><span>Coverage</span><h3>Area / Region</h3></div><small>{info.regions.length} wilayah</small></div>
          <div key={regionData.safePage} className="client-region-list paginated-content">
            {regionData.visible.map(([region, count]) => <button type="button" key={region} onClick={() => onOpenEmployees?.(region)}><span><i />{region}</span><strong>{count}</strong></button>)}
            {!info.regions.length ? <div className="client-panel-empty">Wilayah belum tersedia.</div> : null}
          </div>
          <PanelPagination page={regionData.safePage} pageCount={regionData.pageCount} total={info.regions.length} label="wilayah" onPage={setRegionPage} />
        </div>

        <div className="card client-detail-panel insight-panel">
          <div className="client-panel-heading"><div><span>Deterministic insight</span><h3>AI Insight</h3></div><small>{info.insights.length} temuan</small></div>
          <div key={insightData.safePage} className="client-insight-list paginated-content">
            {insightData.visible.map((insight, index) => <div key={`${insight.text}-${index}`}><span>{insight.icon}</span><p>{insight.text}</p></div>)}
            {!info.insights.length ? <div className="client-panel-empty">Belum ada insight.</div> : null}
          </div>
          <PanelPagination page={insightData.safePage} pageCount={insightData.pageCount} total={info.insights.length} label="insight" onPage={setInsightPage} />
        </div>

        <div className="card client-detail-panel billing-panel">
          <div className="client-panel-heading"><div><span>Receivables</span><h3>Billing Information</h3></div><small>{info.billing.length} invoice</small></div>
          <div key={billingData.safePage} className="client-billing-list paginated-content">
            {billingData.visible.map((invoice: any) => <div key={invoice.id}><header><strong>{invoice.id}</strong><span className={invoice.status === 'PAID' ? 'paid' : ''}>{invoice.status}</span></header><dl><div><dt>Nilai invoice</dt><dd>{formatIDRShort(invoice.totalAmount)}</dd></div><div><dt>Outstanding</dt><dd>{formatIDRShort(invoice.ar?.amount || 0)}</dd></div></dl></div>)}
            {!info.billing.length ? <div className="client-panel-empty">Belum ada invoice pada klien ini.</div> : null}
          </div>
          <PanelPagination page={billingData.safePage} pageCount={billingData.pageCount} total={info.billing.length} label="invoice" onPage={setBillingPage} />
        </div>

        <ActivityTimeline logs={db.auditLogs || []} pageSize={pageSize} />
      </div>
    </section>
  );
}
