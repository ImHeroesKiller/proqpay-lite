'use client';

import { useState } from 'react';
import SettingsModal from './SettingsModal';
import { IconDashboard, IconMessage, IconUsers, IconBuilding, IconChart, IconSettings, IconTerminal, IconWallet } from './Icons';

export type AppView = 'dashboard' | 'operations' | 'employees' | 'clients' | 'reports' | 'logs';

export default function Sidebar({
  view,
  onView,
  onOpenIda,
  role,
}: {
  view: AppView;
  onView: (v: AppView) => void;
  onOpenIda: () => void;
  role?: string;
}) {
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <>
      <aside
        className="app-sidebar"
      >
        <div className="sidebar-brand">
          <span>PQ</span>
          <div><strong>ProQPay</strong><small>Payroll operations</small></div>
        </div>

        <div className="sidebar-label">Workspace</div>

        <NavBtn active={view === 'dashboard'} icon={<IconDashboard />} title="Dashboard" onClick={() => onView('dashboard')} />
        <NavBtn icon={<IconMessage />} title="Chat IDA" onClick={onOpenIda} />
        <NavBtn active={view === 'operations'} icon={<IconWallet />} title="Payroll Operations" onClick={() => onView('operations')} />
        {role !== 'CLIENT_USER' && <NavBtn active={view === 'employees'} icon={<IconUsers />} title="Karyawan" onClick={() => onView('employees')} />}
        {['SUPER_ADMIN', 'PAYROLL_PROCESSOR', 'PAYROLL', 'HR'].includes(role || '') && <NavBtn active={view === 'clients'} icon={<IconBuilding />} title="Klien & Project" onClick={() => onView('clients')} />}
        <NavBtn active={view === 'reports'} icon={<IconChart />} title="Laporan" onClick={() => onView('reports')} />
        {role === 'SUPER_ADMIN' && <NavBtn active={view === 'logs'} icon={<IconTerminal />} title="System Logs" onClick={() => onView('logs')} />}

        <div className="sidebar-spacer" />

        {role === 'SUPER_ADMIN' && <NavBtn icon={<IconSettings />} title="Pengaturan" onClick={() => setSettingsOpen(true)} />}
      </aside>

      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </>
  );
}

function NavBtn({
  icon,
  title,
  active = false,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      title={title}
      type="button"
      onClick={onClick}
      className={`sidebar-nav-button${active ? ' sidebar-nav-active' : ''}`}
      aria-current={active ? 'page' : undefined}
    >
      {icon}
      <span>{title}</span>
    </button>
  );
}
