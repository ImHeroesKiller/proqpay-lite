export default function Home() {
  return (
    <main style={{ padding: '40px', fontFamily: 'Inter, sans-serif' }}>
      <h1 style={{ fontSize: '28px', fontWeight: 700, marginBottom: '12px' }}>
        ProQPay Lite
      </h1>
      <p style={{ color: '#5a6478', marginBottom: '24px' }}>
        AI Payroll Operating System — Coming soon to full dashboard.
      </p>
      <div style={{
        padding: '20px',
        background: '#f7f8fb',
        borderRadius: '12px',
        border: '1px solid #eaeef4'
      }}>
        <p style={{ margin: 0, fontSize: '14px' }}>
          Repository berhasil dibuat dengan Next.js 16 + static export untuk GitHub Pages.
          <br />
          Dashboard, IDA, dan seluruh fitur akan diporting secara bertahap.
        </p>
      </div>
    </main>
  );
}
