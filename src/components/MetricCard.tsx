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
    <button
      type="button"
      className="card metric-card"
      onClick={onClick}
      disabled={!onClick}
      style={{ '--metric-accent': accent } as React.CSSProperties}
    >
      <div className="metric-card-topline">
        <div className="metric-card-icon">
          {icon}
        </div>
        <span className="metric-card-label">{label}</span>
      </div>

      <strong className="metric-card-value">{value}</strong>
      <span className="metric-card-note">{sub}</span>

      {sparkData && sparkData.length > 1 && (
        <div className="metric-card-sparkline">
          <Sparkline data={sparkData} color={accent} height={40} />
        </div>
      )}
      <i className="metric-card-glow" aria-hidden="true" />
    </button>
  );
}
