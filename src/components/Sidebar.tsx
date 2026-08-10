'use client';

import { useState } from 'react';
import SettingsModal from './SettingsModal';
import { IconDashboard, IconMessage, IconUsers, IconBuilding, IconChart, IconSettings, IconTerminal, IconWallet } from './Icons';

export type AppView = 'dashboard' | 'operations' | 'employees' | 'clients' | 'reports' | 'logs';

export default function Sidebar({
  view,
  onView,
  onOpenIda,
}: {
  view: AppView;
  onView: (v: AppView) => void;
  onOpenIda: () => void;
}) {
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <>
      <aside
        style={{
          width: 60,
          background: 'var(--bg-surface)',
          borderRight: '1px solid var(--border)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          padding: '16px 0',
          gap: 4,
          flexShrink: 0,
          height: '100vh',
          position: 'sticky',
          top: 0,
          zIndex: 30,
        }}
      >
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: 11,
            background: 'linear-gradient(135deg, var(--accent), var(--violet))',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 800,
            fontSize: 12,
            color: '#fff',
            marginBottom: 14,
          }}
        >
          PQ
        </div>

        <NavBtn active={view === 'dashboard'} icon={<IconDashboard />} title="Dashboard" onClick={() => onView('dashboard')} />
        <NavBtn icon={<IconMessage />} title="Chat IDA" onClick={onOpenIda} />
        <NavBtn active={view === 'operations'} icon={<IconWallet />} title="Payroll Operations" onClick={() => onView('operations')} />
        <NavBtn active={view === 'employees'} icon={<IconUsers />} title="Karyawan" onClick={() => onView('employees')} />
        <NavBtn active={view === 'clients'} icon={<IconBuilding />} title="Klien" onClick={() => onView('clients')} />
        <NavBtn active={view === 'reports'} icon={<IconChart />} title="Laporan" onClick={() => onView('reports')} />
        <NavBtn active={view === 'logs'} icon={<IconTerminal />} title="System Logs" onClick={() => onView('logs')} />

        <div style={{ flex: 1 }} />

        <NavBtn icon={<IconSettings />} title="Pengaturan" onClick={() => setSettingsOpen(true)} />
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
      style={{
        width: 42,
        height: 42,
        borderRadius: 12,
        border: 'none',
        background: active ? 'var(--accent-soft)' : 'transparent',
        color: active ? 'var(--accent)' : 'var(--text3)',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative',
      }}
    >
      {icon}
      {active && (
        <span
          style={{
            position: 'absolute',
            left: -9,
            top: '50%',
            transform: 'translateY(-50%)',
            width: 3,
            height: 18,
            borderRadius: '0 3px 3px 0',
            background: 'var(--accent)',
          }}
        />
      )}
    </button>
  );
}
