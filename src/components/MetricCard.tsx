import Sparkline from './Sparkline';

export default function MetricCard({
  label,
  value,
  sub,
  accent,
  icon,
  sparkData,
  onClick,
}: {
  label: string;
  value: string;
  sub: string;
  accent: string;
  icon?: React.ReactNode;
  sparkData?: number[];
  onClick?: () => void;
}) {
  return (
    <div
      className="card metric-card"
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      style={{
        padding: '18px 18px 14px',
        position: 'relative',
        overflow: 'hidden',
        cursor: onClick ? 'pointer' : 'default',
        transition: 'box-shadow 0.22s ease, transform 0.22s ease, border-color 0.22s ease',
      }}
      onMouseEnter={(e) => {
        if (!onClick) return;
        const el = e.currentTarget as HTMLElement;
        el.style.boxShadow = 'var(--shadow-md)';
        el.style.transform = 'translateY(-2px)';
        el.style.borderColor = `color-mix(in srgb, ${accent} 35%, var(--border))`;
      }}
      onMouseLeave={(e) => {
        if (!onClick) return;
        const el = e.currentTarget as HTMLElement;
        el.style.boxShadow = 'var(--shadow-xs)';
        el.style.transform = 'translateY(0)';
        el.style.borderColor = 'var(--border)';
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '10px' }}>
        <div style={{
          width: '36px',
          height: '36px',
          borderRadius: '10px',
          background: `color-mix(in srgb, ${accent} 12%, transparent)`,
          color: accent,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          {icon}
        </div>
        <div style={{
          fontSize: '10px',
          fontWeight: 650,
          color: 'var(--text3)',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          paddingTop: '4px',
        }}>
          {label}
        </div>
      </div>

      <div style={{
        fontSize: '26px',
        fontWeight: 720,
        letterSpacing: '-0.035em',
        lineHeight: 1.15,
        marginBottom: '4px',
        color: 'var(--text)',
      }}>
        {value}
      </div>
      <div style={{ fontSize: '12px', color: 'var(--text3)', marginBottom: sparkData ? '10px' : 0 }}>
        {sub}
      </div>

      {sparkData && sparkData.length > 1 && (
        <div style={{ marginTop: '4px', marginLeft: '-4px', marginRight: '-4px' }}>
          <Sparkline data={sparkData} color={accent} height={40} />
        </div>
      )}

      <div style={{
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        height: '2px',
        background: `linear-gradient(90deg, ${accent}, transparent)`,
        opacity: 0.85,
      }} />
    </div>
  );
}
