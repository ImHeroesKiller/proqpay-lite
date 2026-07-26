'use client';

import { useState } from 'react';
import SettingsModal from './SettingsModal';
import { IconDashboard, IconMessage, IconUsers, IconBuilding, IconChart, IconSettings } from './Icons';

export default function Sidebar() {
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <>
      <aside style={{
        width: '60px',
        background: 'var(--bg-surface)',
        borderRight: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '16px 0',
        gap: '4px',
        flexShrink: 0,
        height: '100vh',
        position: 'sticky',
        top: 0,
      }}>
        <div style={{
          width: '36px',
          height: '36px',
          borderRadius: '11px',
          background: 'linear-gradient(135deg, var(--accent), var(--violet))',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontWeight: 800,
          fontSize: '12px',
          color: '#fff',
          marginBottom: '14px',
          boxShadow: '0 4px 14px rgba(91, 94, 240, 0.35)',
          letterSpacing: '-0.02em',
        }}>
          PQ
        </div>

        <NavBtn active icon={<IconDashboard />} title="Dashboard" />
        <NavBtn icon={<IconMessage />} title="Chat with IDA" />
        <NavBtn icon={<IconUsers />} title="Employees" />
        <NavBtn icon={<IconBuilding />} title="Clients" />
        <NavBtn icon={<IconChart />} title="Reports" />

        <div style={{ flex: 1 }} />

        <NavBtn icon={<IconSettings />} title="Settings" onClick={() => setSettingsOpen(true)} />
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
      onClick={onClick}
      style={{
        width: '42px',
        height: '42px',
        borderRadius: '12px',
        border: 'none',
        background: active ? 'var(--accent-soft)' : 'transparent',
        color: active ? 'var(--accent)' : 'var(--text3)',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transition: 'all 0.2s ease',
        position: 'relative',
      }}
    >
      {icon}
      {active && (
        <span style={{
          position: 'absolute',
          left: '-9px',
          top: '50%',
          transform: 'translateY(-50%)',
          width: '3px',
          height: '18px',
          borderRadius: '0 3px 3px 0',
          background: 'var(--accent)',
        }} />
      )}
    </button>
  );
}
