export default function Home() {
  return (
    <main style={{ padding: '40px', fontFamily: 'Inter, sans-serif', maxWidth: '720px', margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
        <div style={{
          width: '40px', height: '40px', borderRadius: '10px',
          background: 'linear-gradient(135deg, #5b5ef0, #8b5cf6)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'white', fontWeight: 800, fontSize: '14px'
        }}>PQ</div>
        <h1 style={{ fontSize: '28px', fontWeight: 700, letterSpacing: '-0.02em' }}>
          ProQPay <span style={{ color: '#f97316' }}>Lite</span>
        </h1>
      </div>
      <p style={{ color: '#5a6478', marginBottom: '28px', fontSize: '15px' }}>
        AI Payroll Operating System — Conversation-first with IDA AI Assistant
      </p>

      <div style={{
        padding: '20px 24px',
        background: 'white',
        borderRadius: '16px',
        border: '1px solid #eaeef4',
        boxShadow: '0 1px 3px rgba(15,23,42,0.05)',
        marginBottom: '20px'
      }}>
        <h2 style={{ fontSize: '15px', fontWeight: 600, marginBottom: '14px' }}>Porting Progress</h2>
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '14px' }}>
          <li>✅ Next.js 16 + TypeScript + Static Export</li>
          <li>✅ GitHub Pages deploy workflow</li>
          <li>✅ Database engine (`src/lib/database.ts`)</li>
          <li>⏳ IDA Engine (intent + processing)</li>
          <li>⏳ Dashboard Renderer v2</li>
          <li>⏳ Design System CSS</li>
          <li>⏳ Full React components (Sidebar, Topbar, Dashboard, IDA Chat)</li>
        </ul>
      </div>

      <p style={{ fontSize: '13px', color: '#94a3b8' }}>
        Repo: <a href="https://github.com/ImHeroesKiller/proqpay-lite" style={{ color: '#5b5ef0' }}>github.com/ImHeroesKiller/proqpay-lite</a>
      </p>
    </main>
  );
}
