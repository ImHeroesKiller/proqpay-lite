'use client';

export default function RegionMap({ employees }: { employees: any[] }) {
  const byRegion: Record<string, number> = {};
  (employees || []).forEach((e: any) => {
    if (e.region) byRegion[e.region] = (byRegion[e.region] || 0) + 1;
  });

  const regions = Object.entries(byRegion).sort((a, b) => b[1] - a[1]);
  const maxCount = Math.max(...regions.map(([, c]) => c), 1);
  const total = employees?.length || 0;

  return (
    <div className="card" style={{ padding: '20px' }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: '16px'
      }}>
        <div style={{
          fontSize: '11px', fontWeight: 600, color: 'var(--text2)',
          textTransform: 'uppercase', letterSpacing: '0.05em'
        }}>
          Employee Distribution — Indonesia
        </div>
        <span style={{
          fontSize: '11px', fontWeight: 600, color: 'var(--text3)',
          padding: '3px 10px', background: 'var(--bg-subtle)',
          border: '1px solid var(--border)', borderRadius: 'var(--r-pill)'
        }}>
          {total} emp
        </span>
      </div>

      {regions.length === 0 ? (
        <div style={{ fontSize: '13px', color: 'var(--text3)', padding: '20px 0', textAlign: 'center' }}>
          No region data
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {regions.map(([region, count]) => {
            const pct = (count / maxCount) * 100;
            const intensity =
              count >= 3 ? 'var(--orange)' :
              count >= 2 ? 'var(--amber)' :
              'var(--accent)';
            return (
              <div key={region} style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={{
                  width: '130px', fontSize: '12px', fontWeight: 600,
                  color: 'var(--text)', flexShrink: 0, whiteSpace: 'nowrap',
                  overflow: 'hidden', textOverflow: 'ellipsis'
                }}>
                  {region}
                </div>
                <div style={{
                  flex: 1, height: '22px', background: 'var(--bg-sunk)',
                  borderRadius: 'var(--r-sm)', overflow: 'hidden', position: 'relative'
                }}>
                  <div style={{
                    height: '100%', width: `${pct}%`,
                    background: `linear-gradient(90deg, ${intensity}, color-mix(in srgb, ${intensity} 70%, transparent))`,
                    borderRadius: 'var(--r-sm)',
                    transition: 'width 0.4s ease',
                    minWidth: count > 0 ? '24px' : 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
                    paddingRight: '8px'
                  }}>
                    <span style={{
                      fontSize: '10px', fontWeight: 700, color: '#fff',
                      textShadow: '0 1px 2px rgba(0,0,0,0.2)'
                    }}>
                      {count}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div style={{
        marginTop: '16px', paddingTop: '12px', borderTop: '1px solid var(--border-soft)',
        display: 'flex', gap: '16px', fontSize: '11px', color: 'var(--text3)'
      }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
          <span style={{ width: '10px', height: '10px', borderRadius: '3px', background: 'var(--accent)' }} /> 1 emp
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
          <span style={{ width: '10px', height: '10px', borderRadius: '3px', background: 'var(--amber)' }} /> 2 emp
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
          <span style={{ width: '10px', height: '10px', borderRadius: '3px', background: 'var(--orange)' }} /> 3+ emp
        </span>
      </div>
    </div>
  );
}
