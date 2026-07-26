export default function MetricCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub: string;
  accent: string;
}) {
  return (
    <div
      className="card"
      style={{
        padding: '18px',
        position: 'relative',
        overflow: 'hidden',
        cursor: 'pointer',
        transition: 'box-shadow 0.25s ease, transform 0.25s ease',
      }}
    >
      <div
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          height: '3px',
          background: accent,
          opacity: 0.7,
        }}
      />
      <div
        style={{
          fontSize: '11px',
          fontWeight: 600,
          color: 'var(--text2)',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          marginBottom: '6px',
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: '24px',
          fontWeight: 700,
          letterSpacing: '-0.03em',
          marginBottom: '4px',
        }}
      >
        {value}
      </div>
      <div style={{ fontSize: '12px', color: 'var(--text3)' }}>{sub}</div>
    </div>
  );
}
