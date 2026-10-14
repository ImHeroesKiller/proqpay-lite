'use client';

import {useEffect,useState} from 'react';
import PaymentGatewayIntegrationPanel from '@/components/PaymentGatewayIntegrationPanel';
import ApiEndpointMonitor from '@/components/ApiEndpointMonitor';
import {patchRoute,routeParams,subscribeRoute} from '@/lib/route-state';

type IntegrationTab='gateway'|'api';
function currentTab():IntegrationTab{
  return routeParams().get('integrationTab')==='api'?'api':'gateway';
}

export default function IntegrationsWorkspace({canManage,canView,onOpenAuditCorrelation}:{canManage:boolean;canView:boolean;onOpenAuditCorrelation?:(correlationId:string)=>void}){
  const [tab,setTab]=useState<IntegrationTab>('gateway');
  useEffect(()=>{
    const sync=()=>setTab(currentTab());
    sync();
    return subscribeRoute(sync);
  },[]);
  function selectTab(next:IntegrationTab){
    setTab(next);
    patchRoute({integrationTab:next==='gateway'?null:next},'push');
  }
  return <section className="integration-workspace" style={{display:'grid',gap:16}}>
    <header>
      <span className="workspace-eyebrow">CONNECTED SYSTEMS</span>
      <h2 style={{fontSize:22,fontWeight:720,margin:'4px 0 0'}}>Integrations</h2>
      <p style={{color:'var(--text3)',fontSize:13,marginTop:5}}>
        Kelola gateway pembayaran dan pantau aktivitas API dalam halaman terpisah.
      </p>
    </header>
    <div role="tablist" aria-label="Kategori Integrasi" style={{display:'flex',gap:8,flexWrap:'wrap',borderBottom:'1px solid var(--border)',paddingBottom:10}}>
      <button type="button" id="integration-tab-gateway" role="tab" aria-selected={tab==='gateway'} aria-controls="integration-panel-gateway" tabIndex={tab==='gateway'?0:-1} className={tab==='gateway'?'btn btn-primary':'btn'} onClick={()=>selectTab('gateway')} onKeyDown={e=>{if(e.key==='ArrowRight'||e.key==='ArrowLeft'){e.preventDefault();selectTab('api');document.getElementById('integration-tab-api')?.focus();}}}>Payment Gateway</button>
      <button type="button" id="integration-tab-api" role="tab" aria-selected={tab==='api'} aria-controls="integration-panel-api" tabIndex={tab==='api'?0:-1} className={tab==='api'?'btn btn-primary':'btn'} onClick={()=>selectTab('api')} onKeyDown={e=>{if(e.key==='ArrowRight'||e.key==='ArrowLeft'){e.preventDefault();selectTab('gateway');document.getElementById('integration-tab-gateway')?.focus();}}}>API Monitor</button>
    </div>
    {tab==='gateway'?<div role="tabpanel" id="integration-panel-gateway" aria-labelledby="integration-tab-gateway" tabIndex={0}>
      <PaymentGatewayIntegrationPanel canManage={canManage} canView={canView}/>
    </div>:<div role="tabpanel" id="integration-panel-api" aria-labelledby="integration-tab-api" tabIndex={0}>
      <ApiEndpointMonitor onOpenAuditCorrelation={onOpenAuditCorrelation}/>
    </div>}
  </section>;
}
