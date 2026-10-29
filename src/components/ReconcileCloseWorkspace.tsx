'use client';
import {useEffect,useState} from 'react';
import OperatingWorkspace,{type WorkspaceFilterState} from '@/components/OperatingWorkspace';
import BillingWorkspace from '@/components/BillingWorkspace';
import CanonicalTransactionRegister from '@/components/CanonicalTransactionRegister';
import WorkspaceTabs from '@/components/layout/WorkspaceTabs';
import {patchRoute,routeValue,subscribeRoute} from '@/lib/route-state';
const panels=[{value:'RECONCILIATION',label:'Reconciliation'},{value:'SETTLEMENT',label:'Settlement & Close'},{value:'BILLING',label:'Billing & AR'}];
function currentPanel(){const value=routeValue('closePanel');return panels.some(panel=>panel.value===value)?value!:routeValue('dashboardStage')==='CLOSE'?'SETTLEMENT':'RECONCILIATION';}
export default function ReconcileCloseWorkspace({period,filters,clientNames,projectNames}:{period:string;filters:WorkspaceFilterState;clientNames:Record<string,string>;projectNames:Record<string,string>}){
  const [panel,setPanel]=useState(currentPanel);
  const [actor,setActor]=useState<any>(null);
  const [error,setError]=useState('');
  const [retry,setRetry]=useState(0);
  useEffect(()=>subscribeRoute(()=>setPanel(currentPanel())),[]);
  useEffect(()=>{const controller=new AbortController();setError('');void fetch('/api/me',{cache:'no-store',signal:controller.signal}).then(async response=>{const body=await response.json();if(!response.ok||!body.user)throw new Error(body.error||'Sesi tidak tersedia');if(!controller.signal.aborted)setActor(body.user);}).catch(error=>{if(!controller.signal.aborted)setError(error instanceof Error?error.message:'Gagal memuat sesi');});return()=>controller.abort();},[retry]);
  if(error)return <div className="workspace-inline-error" role="alert"><strong>Workspace belum dapat dimuat</strong><p>{error}</p><button type="button" className="btn" onClick={()=>setRetry(value=>value+1)}>Coba lagi</button></div>;
  if(!actor)return <p role="status">Memuat Reconcile & Close…</p>;
  return <section className="reconcile-close-workspace"><WorkspaceTabs items={panels} value={panel} onChange={value=>{setPanel(value);patchRoute({closePanel:value});}} label="Reconcile & Close" panelId="close-work-panel"/><div id="close-work-panel" role="tabpanel" aria-labelledby={`close-work-panel-${panel}`} tabIndex={0}>
    {panel==='RECONCILIATION'?<>
      <CanonicalTransactionRegister actor={actor} clientId={filters.clientId==='ALL'?'':filters.clientId} projectId={filters.projectId==='ALL'?'':filters.projectId} period={period==='ALL'?'':period} query={filters.query} clientNames={clientNames} projectNames={projectNames}/>
      <details className="workspace-secondary"><summary>Bukti bayar dan rekonsiliasi PI</summary><OperatingWorkspace mode="reconcile" period={period} filters={filters} embedded/></details>
    </>:null}
    {panel==='SETTLEMENT'?<BillingWorkspace actor={actor} period={period} filters={filters} focusSubmissionId={routeValue('submissionId')||''} surface="SETTLEMENT" embedded/>:null}
    {panel==='BILLING'?<BillingWorkspace actor={actor} period={period} filters={filters} focusSubmissionId={routeValue('submissionId')||''} surface="BILLING" embedded/>:null}
  </div></section>;
}
