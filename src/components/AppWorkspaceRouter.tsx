'use client';

import dynamic from 'next/dynamic';
import { useState } from 'react';
import ModuleErrorBoundary from '@/components/ModuleErrorBoundary';
import type { AppView } from '@/components/Sidebar';
import type { AppSettings } from '@/lib/app-settings';
import type { EmployeeRecord } from '@/lib/employee-ui';

const OperatingWorkspace = dynamic(() => import('@/components/OperatingWorkspace'), { loading:() => <ViewLoading /> });
const EmployeeDirectory = dynamic(() => import('@/components/EmployeeDirectory'), { loading:() => <ViewLoading /> });
const DirectoryManager = dynamic(() => import('@/components/DirectoryManager'), { loading:() => <ViewLoading /> });
const ReportsWorkspace = dynamic(() => import('@/components/ReportsWorkspace'), { loading:() => <ViewLoading /> });
const ClientHome = dynamic(() => import('@/components/ClientHome'), { loading:() => <ViewLoading /> });
const ClientDocumentsWorkspace = dynamic(() => import('@/components/ClientDocumentsWorkspace'), { loading:() => <ViewLoading /> });
const SystemLogs = dynamic(() => import('@/components/SystemLogs'), { loading:() => <ViewLoading /> });
const EwaInbox = dynamic(() => import('@/components/EwaInbox'), { loading:() => <ViewLoading /> });
const PortalSettings = dynamic(() => import('@/components/PortalSettings'), { loading:() => <ViewLoading /> });
const IntegrationsWorkspace = dynamic(() => import('@/components/IntegrationsWorkspace'), { loading:() => <ViewLoading /> });
const PaymentGatewayPaymentPanel = dynamic(() => import('@/components/PaymentGatewayPaymentPanel'), { loading:() => <ViewLoading /> });

type Actor = {
  id:string;
  name?:string;
  email:string;
  role:string;
  permissions:string[];
  clientIds?:string[] | null;
  projectIds?:string[] | null;
};

type DatabaseMirror = {
  employees?:EmployeeRecord[];
  companies?:Array<{id:string;name:string;code?:string}>;
  projects?:Array<{id:string;name:string;company?:string;status?:string}>;
};

type Props = {
  view:AppView;
  actor:Actor;
  period:string;
  db:DatabaseMirror;
  settings:AppSettings;
  gatewayCanView:boolean;
  gatewayCanExecute:boolean;
  onNavigate:(view:AppView)=>void;
  onRefreshCanonical:()=>Promise<void>;
  onOpenAuditCorrelation:(correlationId:string)=>void;
};

export default function AppWorkspaceRouter(props:Props) {
  const [retryKey,setRetryKey]=useState(0);
  const { view,actor,period,db,settings,gatewayCanView,gatewayCanExecute }=props;

  return <div key={view} className="app-view-transition" style={{maxWidth:1180,margin:'0 auto'}}>
    <ModuleErrorBoundary moduleName={view} resetKey={`${view}:${retryKey}`} onRetry={() => setRetryKey((value)=>value+1)}>
      {view === 'dashboard' && (
        actor.role === 'CLIENT_USER'
          ? <ClientHome actor={actor} period={period} onNavigate={props.onNavigate} />
          : <PayrollControlTowerAdapter actor={actor} period={period} onNavigate={props.onNavigate} />
      )}
      {view === 'employees' && <EmployeeDirectory
        employees={db.employees || []}
        actor={actor}
        pageSize={settings.employeePageSize}
        initialRegion="ALL"
        maskSensitiveData={settings.maskSensitiveData}
        onChanged={props.onRefreshCanonical}
      />}
      {view === 'clients' && <DirectoryManager
        actor={actor}
        onChanged={props.onRefreshCanonical}
        existingClients={db.companies || []}
        existingProjects={db.projects || []}
      />}
      {view === 'logs' && <SystemLogs />}
      {view === 'operations' && <OperatingWorkspace mode="payruns" />}
      {view === 'exceptions' && <OperatingWorkspace mode="actions" />}
      {view === 'payments' && <>
        <OperatingWorkspace mode="payments" />
        {gatewayCanView ? <PaymentGatewayPaymentPanel role={actor.role} /> : null}
      </>}
      {view === 'billing' && <OperatingWorkspace mode="billing" />}
      {view === 'integrations' && <IntegrationsWorkspace
        canManage={gatewayCanExecute}
        canView={gatewayCanView}
        onOpenAuditCorrelation={props.onOpenAuditCorrelation}
      />}
      {view === 'ewa' && <EwaInbox />}
      {view === 'portalSettings' && <PortalSettings />}
      {view === 'reports' && (
        actor.role === 'CLIENT_USER'
          ? <ClientDocumentsWorkspace actor={actor} />
          : <ReportsWorkspace />
      )}
    </ModuleErrorBoundary>
  </div>;
}

const PayrollControlTower = dynamic(() => import('@/components/PayrollControlTower'), { loading:() => <ViewLoading /> });

function PayrollControlTowerAdapter({ actor, period, onNavigate }:{
  actor:Actor;
  period:string;
  onNavigate:(view:AppView)=>void;
}) {
  return <PayrollControlTower actor={actor} period={period} onNavigate={onNavigate} />;
}

function ViewLoading() {
  return <div className="card control-loading" role="status">Menyiapkan modul…</div>;
}
