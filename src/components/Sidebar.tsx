'use client';

import dynamic from 'next/dynamic';
import { IconDashboard, IconUsers, IconBuilding, IconChart, IconSettings, IconTerminal, IconWallet, IconMessage, IconFile } from './Icons';

const SettingsModal = dynamic(() => import('./SettingsModal'));

export type AppView = 'dashboard' | 'operations' | 'exceptions' | 'payments' | 'billing' | 'integrations' | 'employees' | 'clients' | 'reports' | 'logs' | 'ewa' | 'portalAudit' | 'portalSettings';

const ROLE_VIEWS: Record<string, AppView[]> = {
  SUPER_ADMIN: ['dashboard','operations','exceptions','payments','billing','integrations','employees','clients','reports','logs','ewa','portalAudit','portalSettings'],
  PAYROLL_PROCESSOR: ['dashboard','operations','exceptions','payments','billing','integrations','employees','clients','reports','ewa','portalAudit','portalSettings'],
  PAYROLL_CONTROLLER: ['dashboard','operations','exceptions','payments','billing','reports','ewa','portalAudit','portalSettings'],
  CLIENT_USER: ['dashboard','operations','payments','billing','reports'],
};

export function allowedViewsForRole(role?:string) { return ROLE_VIEWS[role || ''] || ['dashboard']; }

type Props = { view:AppView; onView:(view:AppView)=>void; onOpenIda:()=>void; onOpenHelp:()=>void; role?:string; compact?:boolean; mobileOpen?:boolean; onMobileClose:()=>void; settingsOpen:boolean; onSettingsOpen:(open:boolean)=>void; lastSyncAt?:number };

export default function Sidebar({view,onView,onOpenIda,onOpenHelp,role,compact=false,mobileOpen=false,onMobileClose,settingsOpen,onSettingsOpen,lastSyncAt}:Props) {
  const allowed=new Set(allowedViewsForRole(role));
  const go=(next:AppView)=>{onView(next);onMobileClose();};
  const canIntake=['SUPER_ADMIN','PAYROLL_PROCESSOR','CLIENT_USER'].includes(role||'');
  return <>
    <button type="button" className={`sidebar-backdrop${mobileOpen?' open':''}`} aria-label="Tutup navigasi" onClick={onMobileClose} />
    <aside className={`app-sidebar${compact?' app-sidebar-compact':''}${mobileOpen?' mobile-open':''}`} aria-label="Navigasi utama">
      <div className="sidebar-brand">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="sidebar-brand-logo" src="/assets/proqpay-logo.jpg" alt="ProQPay Lite" />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="sidebar-brand-icon" src="/assets/proqpay-192.png" alt="ProQPay Lite" />
        <button type="button" className="sidebar-mobile-close" aria-label="Tutup navigasi" onClick={onMobileClose}>✕</button>
      </div>
      <NavGroup label="Payroll"><NavBtn active={view==='dashboard'} icon={<IconDashboard/>} title="Dashboard" onClick={()=>go('dashboard')} />{canIntake?<a className="sidebar-nav-button" href="/data-intake" title="Data Intake"><IconFile/><span>Data Intake</span></a>:null}{allowed.has('operations')?<NavBtn active={view==='operations'} icon={<IconWallet/>} title={role==='CLIENT_USER'?'Payroll Status':'Pay Runs'} onClick={()=>go('operations')} />:null}{allowed.has('exceptions')?<NavBtn active={view==='exceptions'} icon={<IconMessage/>} title="Data Readiness" onClick={()=>go('exceptions')} />:null}</NavGroup>
      {allowed.has('ewa')||allowed.has('portalAudit')||allowed.has('portalSettings')?<NavGroup label="Employee portal">{allowed.has('ewa')?<NavBtn active={view==='ewa'} icon={<IconWallet/>} title="Advance Salary" onClick={()=>go('ewa')} />:null}{allowed.has('portalSettings')?<NavBtn active={view==='portalSettings'} icon={<IconSettings/>} title="Portal Settings" onClick={()=>go('portalSettings')} />:null}{allowed.has('portalAudit')?<NavBtn active={view==='portalAudit'} icon={<IconTerminal/>} title="Portal Audit" onClick={()=>go('portalAudit')} />:null}</NavGroup>:null}
      <NavGroup label="Payment & Finance">{allowed.has('payments')?<NavBtn active={view==='payments'} icon={<IconFile/>} title={role==='CLIENT_USER'?'Payment Status':'Payment Instructions'} onClick={()=>go('payments')} />:null}{allowed.has('billing')?<NavBtn active={view==='billing'} icon={<IconWallet/>} title={role==='CLIENT_USER'?'Invoices':'Billing & AR'} onClick={()=>go('billing')} />:null}{allowed.has('reports')?<NavBtn active={view==='reports'} icon={<IconChart/>} title="Reports" onClick={()=>go('reports')} />:null}</NavGroup>
      <NavGroup label="Master Data">{allowed.has('clients')?<NavBtn active={view==='clients'} icon={<IconBuilding/>} title="Clients & Projects" onClick={()=>go('clients')} />:null}{allowed.has('employees')?<NavBtn active={view==='employees'} icon={<IconUsers/>} title="Employees" onClick={()=>go('employees')} />:null}</NavGroup>
      {role==='SUPER_ADMIN'?<NavGroup label="Administration">{allowed.has('integrations')?<NavBtn active={view==='integrations'} icon={<IconTerminal/>} title="Integrations" onClick={()=>go('integrations')} />:null}<NavBtn active={view==='logs'} icon={<IconTerminal/>} title="Audit Logs" onClick={()=>go('logs')} /><NavBtn active={settingsOpen} icon={<IconSettings/>} title="Settings" onClick={()=>{onSettingsOpen(true);onMobileClose();}} /></NavGroup>:null}
      <div className="sidebar-spacer" />
      <button type="button" className="sidebar-ida" onClick={()=>{onOpenIda();onMobileClose();}}><IconMessage/><span>Ask IDA</span></button>
      <div className="sidebar-system-meta"><span><i/>Production · Connected</span><small>Lite · {syncLabel(lastSyncAt)}</small><button type="button" onClick={()=>{onOpenHelp();onMobileClose();}}>Support</button></div>
    </aside>
    <SettingsModal open={settingsOpen} onClose={()=>onSettingsOpen(false)} />
  </>;
}

function NavGroup({label,children}:{label:string;children:React.ReactNode}) { return <nav className="sidebar-group" aria-label={label}><div className="sidebar-label">{label}</div>{children}</nav>; }
function NavBtn({icon,title,active=false,onClick}:{icon:React.ReactNode;title:string;active?:boolean;onClick:()=>void}) { return <button title={title} type="button" onClick={onClick} className={`sidebar-nav-button${active?' sidebar-nav-active':''}`} aria-current={active?'page':undefined}>{icon}<span>{title}</span></button>; }
function syncLabel(value?:number) { if(!value)return 'Belum sinkron'; const minutes=Math.max(0,Math.round((Date.now()-value)/60000)); return minutes<1?'Sync baru saja':`Sync ${minutes}m lalu`; }