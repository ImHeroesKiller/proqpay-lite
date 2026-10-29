'use client';

import Link from 'next/link';
import {WorkspaceTitle} from '@/components/layout/WorkspacePrimitives';
import { useCallback, useEffect, useMemo, useState } from 'react';
import ReconcileCloseWorkspace from '@/components/ReconcileCloseWorkspace';
import {workspaceStepCompletion} from '@/lib/workspace-progress';
import OperatingWorkspace, { type WorkspaceFilterState } from '@/components/OperatingWorkspace';
import type {AppView} from '@/components/Sidebar';
import {PAYROLL_STAGE_VIEW,payrollStage,type PayrollStage} from '@/lib/workspace-navigation';
import {routeValue,subscribeRoute,workspaceRouteFilters,patchWorkspaceFilters,patchRoute} from '@/lib/route-state';
import { listAllOperatingSubmissions } from '@/lib/operating-model-api';

type Stage = PayrollStage;

type Props = {
  role:string;
  period:string;
  gatewayCanView:boolean;
  initialStage?:Stage;
  initialPanel?:'PAYRUNS'|'EXCEPTIONS';
  onNavigate:(view:AppView)=>void;
};

const stageMeta:Record<Stage,{step:string;title:string;description:string;url:string}> = {
  PAYROLL: {
    step:'1',
    title:'Data & Payroll',
    description:'Upload, readiness, issue, dan proses payroll.',
    url:'payroll',
  },
  PAYMENT: {
    step:'2',
    title:'Approval & Payment',
    description:'PI, approval Controller, liquidity, dan Process Payment.',
    url:'payment',
  },
  CLOSE: {
    step:'3',
    title:'Reconcile & Close',
    description:'Proof, reconciliation, billing, AR, dan close period.',
    url:'close',
  },
};

const stageFromUrl=payrollStage;

function urlFilters():WorkspaceFilterState {return workspaceRouteFilters();}

export default function UnifiedPayrollWorkspace({
  role,
  period,
  gatewayCanView,
  initialStage='PAYROLL',
  initialPanel='PAYRUNS',
  onNavigate,
}:Props) {
  const initialUrlStage=typeof window==='undefined'?null:stageFromUrl(routeValue('stage'));
  const [stage,setStage]=useState<Stage>(initialUrlStage || initialStage);
  const [filters,setFilters]=useState<WorkspaceFilterState>(urlFilters);
  const [workspacePeriod,setWorkspacePeriod]=useState(()=>typeof window==='undefined'?'ALL':routeValue('workspacePeriod')||'ALL');
  const [masters,setMasters]=useState<{clients:any[];projects:any[]}>({clients:[],projects:[]});
  const [submissions,setSubmissions]=useState<any[]>([]);
  const [submissionsReady,setSubmissionsReady]=useState(false);

  const canUpload=useMemo(()=>['SUPER_ADMIN','PAYROLL_PROCESSOR','CLIENT_USER'].includes(role),[role]);
  const isController=role==='PAYROLL_CONTROLLER';

  useEffect(()=>{
    const fromUrl=stageFromUrl(routeValue('stage'));
    setStage(fromUrl || initialStage);
  },[initialStage]);

  useEffect(()=>{
    let cancelled=false;
    void Promise.all([listAllOperatingSubmissions(),fetch('/api/client-projects',{cache:'no-store'}).then(async response=>response.ok?response.json():null).catch(()=>null)])
      .then(([result,master])=>{if(!cancelled){setSubmissions(result.submissions || []);if(master)setMasters({clients:master.clients||[],projects:master.projects||[]});setSubmissionsReady(true);}})
      .catch(()=>{if(!cancelled)setSubmissionsReady(false);});
    return ()=>{cancelled=true;};
  },[]);

  useEffect(()=>{
    const onRoute=()=>{
      setStage(stageFromUrl(routeValue('stage')) || initialStage);
      setFilters(workspaceRouteFilters());
      setWorkspacePeriod(routeValue('workspacePeriod')||'ALL');
    };
    return subscribeRoute(onRoute);
  },[initialStage]);

  const changeStage=useCallback((next:Stage)=>{
    if(next===stage && initialPanel!=='EXCEPTIONS')return;
    // Parent is the single owner of route and sidebar state; do not pushState
    // only in the child while leaving the parent on an old view.
    onNavigate(PAYROLL_STAGE_VIEW[next]); // parent updates URL, stage, sidebar and Back/Forward once
    setStage(next);
  },[onNavigate,stage,initialPanel]);

  const patchFilters=useCallback((patch:Partial<WorkspaceFilterState>)=>{
    const next=patchWorkspaceFilters(filters,patch);
    setFilters(next);
  },[filters]);

  const filterSubmissions=submissions;
  const clients=useMemo(()=>{
    const map=new Map<string,string>();
    masters.clients.forEach(row=>map.set(String(row.id),String(row.name||row.id)));
    filterSubmissions.forEach((row)=>map.set(String(row.client_id),String(row.client_name || row.client_id)));
    return [...map.entries()].sort((a,b)=>a[1].localeCompare(b[1]));
  },[filterSubmissions,masters.clients]);
  const projects=useMemo(()=>{
    const map=new Map<string,string>();
    masters.projects.filter(row=>filters.clientId==='ALL'||String(row.client_id||row.clientId)===filters.clientId).forEach(row=>map.set(String(row.id),String(row.name||row.id)));
    filterSubmissions
      .filter((row)=>filters.clientId==='ALL' || String(row.client_id)===filters.clientId)
      .forEach((row)=>{if(row.project_id)map.set(String(row.project_id),String(row.project_name || row.project_id));});
    return [...map.entries()].sort((a,b)=>a[1].localeCompare(b[1]));
  },[filterSubmissions,filters.clientId,masters.projects]);

  const completion=workspaceStepCompletion(submissions.filter(row=>(workspacePeriod==='ALL'||row.period===workspacePeriod)&&(filters.clientId==='ALL'||row.client_id===filters.clientId)&&(filters.projectId==='ALL'||row.project_id===filters.projectId)));

  return (
    <section className="unified-payroll-workspace">
      <header className="unified-payroll-head">
        <WorkspaceTitle eyebrowClassName="workspace-eyebrow" eyebrow="END-TO-END PAYROLL" title={stage==='PAYMENT'?'Approval & Payment':stage==='CLOSE'?'Reconcile & Close':'Payroll Workspace'}
          description={isController?'Selesaikan keputusan payroll, payment, reconciliation, dan close dari satu workspace.':'Siapkan payroll, selesaikan exception, dan kirim Payment Instruction tanpa berpindah-pindah halaman.'} />
        {canUpload ? (
          <Link className="btn btn-primary" href={`/data-intake?period=${encodeURIComponent(period)}`}>
            Upload Payroll Data
          </Link>
        ) : null}
      </header>

      <nav className={`payroll-stage-nav${stage==='PAYMENT'?' payroll-stage-nav-compact':''}`} aria-label="Tahap payroll">
        {(Object.keys(stageMeta) as Stage[]).map((key)=>{
          const meta=stageMeta[key];
          return (
            <button
              key={key}
              type="button"
              className={stage===key?'active':''}
              aria-current={stage===key?'step':undefined}
              onKeyDown={event=>{const keys=Object.keys(stageMeta) as Stage[];const index=keys.indexOf(key);const next=event.key==='ArrowRight'?(index+1)%keys.length:event.key==='ArrowLeft'?(index+keys.length-1)%keys.length:-1;if(next>=0){event.preventDefault();changeStage(keys[next]);event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('button')[next]?.focus();}}}
              onClick={()=>changeStage(key)}
            >
              <b aria-label={completion[key]?`Tahap ${meta.step} selesai`:`Tahap ${meta.step}`}>{completion[key]?'✓':meta.step}</b>
              <span><strong>{meta.title}</strong><small>{meta.description}</small></span>
            </button>
          );
        })}
      </nav>

      <div className={`payroll-shared-filter${stage==='PAYMENT'?' payroll-shared-filter-payments':' card'}`} aria-label="Filter Payroll Workspace">
        <label><span>Periode</span><select aria-label="Periode workspace" value={workspacePeriod} onChange={event=>{setWorkspacePeriod(event.target.value);patchRoute({workspacePeriod:event.target.value==='ALL'?null:event.target.value});}}><option value="ALL">Semua periode</option>{[...new Set([...submissions.map(row=>String(row.period||'')),workspacePeriod==='ALL'?'':workspacePeriod])].filter(Boolean).sort().reverse().map(value=><option key={value} value={value}>{value}</option>)}</select></label>
        <label><span>Klien</span><select value={filters.clientId} onChange={(event)=>patchFilters({clientId:event.target.value})}><option value="ALL">Semua klien</option>{filters.clientId!=='ALL'&&!clients.some(([id])=>id===filters.clientId)?<option value={filters.clientId}>Klien terpilih (tidak tersedia)</option>:null}{clients.map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label>
        <label><span>Project</span><select value={filters.projectId} disabled={!projects.length} onChange={(event)=>patchFilters({projectId:event.target.value})}><option value="ALL">Semua project</option>{filters.projectId!=='ALL'&&!projects.some(([id])=>id===filters.projectId)?<option value={filters.projectId}>Project terpilih (tidak tersedia)</option>:null}{projects.map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label>
        <label className="payroll-shared-search"><span>Pencarian</span><input value={filters.query} onChange={(event)=>patchFilters({query:event.target.value})} placeholder="Klien, project, pay run, PI…" /></label>
        <button type="button" className="btn btn-quiet workspace-reset" onClick={()=>{patchFilters({clientId:'ALL',projectId:'ALL',query:''});setWorkspacePeriod('ALL');patchRoute({workspacePeriod:null,submissionId:null,dashboardStage:null});}}>Reset filter</button>
      </div>
      {submissionsReady&&((filters.clientId!=='ALL'&&!clients.some(([id])=>id===filters.clientId))||(filters.projectId!=='ALL'&&!projects.some(([id])=>id===filters.projectId)))?<p className="workspace-filter-note" role="status">Pilihan filter belum tersedia pada scope ini. Ubah pilihan atau gunakan Reset filter.</p>:null}

      {stage==='PAYROLL' ? (
        <div className="unified-payroll-stage">
          {initialPanel==='EXCEPTIONS'?<>
            <div className="control-panel-title"><div><span>DATA READINESS</span><h2>Exception Center</h2></div><button type="button" className="btn" onClick={()=>changeStage('PAYROLL')}>Kembali ke Payroll</button></div>
            <OperatingWorkspace mode="actions" period={workspacePeriod} filters={filters} embedded />
          </>:<>
          <OperatingWorkspace mode="payruns" period={workspacePeriod} filters={filters} embedded />
          </>}
        </div>
      ) : null}

      {stage==='PAYMENT' ? (
        <div className="unified-payroll-stage">
          <h2 className="visually-hidden">Payment Instructions, disbursement, dan funding</h2>

          <OperatingWorkspace mode="payments" period={workspacePeriod} filters={filters} embedded gatewayCanView={gatewayCanView} />
        </div>
      ) : null}

      {stage==='CLOSE' ? <ReconcileCloseWorkspace period={workspacePeriod} filters={filters} clientNames={Object.fromEntries(clients)} projectNames={Object.fromEntries(projects)}/> : null}
    </section>
  );
}
