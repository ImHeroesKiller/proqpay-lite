'use client';

import PaymentGatewayIntegrationPanel from '@/components/PaymentGatewayIntegrationPanel';
import ApiEndpointMonitor from '@/components/ApiEndpointMonitor';

export default function IntegrationsWorkspace({ canManage, canView }: { canManage:boolean; canView:boolean }) {
  return <section style={{ display:'grid', gap:16 }}>
    <div>
      <span className="workspace-eyebrow">CONNECTED SYSTEMS</span>
      <h2 style={{ fontSize:22, fontWeight:720, margin:'4px 0 0' }}>Integrations</h2>
      <p style={{ color:'var(--text3)', fontSize:13, marginTop:5 }}>
        Pantau status Payment Gateway dan aktivitas aplikasi eksternal yang mengakses endpoint ProQPay.
      </p>
    </div>
    <PaymentGatewayIntegrationPanel canManage={canManage} canView={canView} />
    <ApiEndpointMonitor />
  </section>;
}
