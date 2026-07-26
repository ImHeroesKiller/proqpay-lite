'use client';

export default function Sidebar() {
  return (
    <aside style={{
      width: '56px',
      background: 'var(--bg-surface)',
      borderRight: '1px solid var(--border)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      padding: '14px 0',
      gap: '6px',
      flexShrink: 0,
      height: '100vh',
      position: 'sticky',
      top: 0,
    }}>
      <div style={{
        width: '34px',
        height: '34px',
        borderRadius: '10px',
        background: 'linear-gradient(135deg, var(--accent), var(--violet))',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontWeight: 800,
        fontSize: '13px',
        color: '#fff',
        marginBottom: '10px',
        boxShadow: '0 4px 12px rgba(91, 94, 240, 0.35)',
      }}>
        PQ
      </div>

      <NavBtn active icon="▦" title="Dashboard" />
      <NavBtn icon="💬" title="Chat with IDA" />
      <NavBtn icon="👥" title="Employees" />
      <NavBtn icon="🏢" title="Clients" />
      <NavBtn icon="📊" title="Reports" />

      <div style={{ flex: 1 }} />

      <NavBtn icon="⚙️" title="Settings" />
    </aside>
  );
}

function NavBtn({ icon, title, active = false }: { icon: string; title: string; active?: boolean }) {
  return (
    <button
      title={title}
      style={{
        width: '40px',
        height: '40px',
        borderRadius: '11px',
        border: 'none',
        background: active ? 'var(--accent-soft)' : 'transparent',
        color: active ? 'var(--accent)' : 'var(--text3)',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '17px',
        transition: 'all 0.2s ease',
        position: 'relative',
      }}
    >
      {icon}
      {active && (
        <span style={{
          position: 'absolute',
          left: '-8px',
          top: '50%',
          transform: 'translateY(-50%)',
          width: '3px',
          height: '20px',
          borderRadius: '0 3px 3px 0',
          background: 'var(--accent)',
        }} />
      )}
    </button>
  );
}
