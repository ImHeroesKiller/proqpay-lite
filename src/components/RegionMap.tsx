'use client';

/** Approximate lng/lat centers for display (simplified) */
const REGION_COORDS: Record<string, [number, number]> = {
  'DKI Jakarta': [106.85, -6.2],
  'Jawa Barat': [107.6, -6.9],
  'Jawa Tengah': [110.4, -7.2],
  'DI Yogyakarta': [110.4, -7.8],
  'Jawa Timur': [112.7, -7.5],
  'Banten': [106.1, -6.4],
  'Bali': [115.2, -8.4],
  'Aceh': [95.3, 4.7],
  'Sumatera Utara': [98.7, 3.6],
  'Sumatera Barat': [100.4, -0.9],
  'Riau': [101.4, 0.5],
  'Kepulauan Riau': [104.0, 1.0],
  'Jambi': [103.6, -1.6],
  'Sumatera Selatan': [104.7, -3.0],
  'Bangka Belitung': [106.1, -2.1],
  'Bengkulu': [102.3, -3.8],
  'Lampung': [105.3, -5.4],
  'Kalimantan Barat': [109.3, -0.0],
  'Kalimantan Tengah': [113.9, -1.7],
  'Kalimantan Selatan': [114.6, -3.3],
  'Kalimantan Timur': [116.9, 0.5],
  'Kalimantan Utara': [116.5, 3.0],
  'Sulawesi Utara': [124.8, 1.5],
  'Gorontalo': [123.1, 0.7],
  'Sulawesi Tengah': [119.9, -1.4],
  'Sulawesi Selatan': [119.9, -4.0],
  'Sulawesi Barat': [119.3, -2.7],
  'Sulawesi Tenggara': [122.1, -4.0],
  'Maluku': [128.2, -3.7],
  'Maluku Utara': [127.8, 0.8],
  'Papua Barat': [132.5, -1.5],
  'Papua': [138.5, -4.0],
  'Nusa Tenggara Barat': [116.5, -8.6],
  'Nusa Tenggara Timur': [121.5, -9.0],
};

// Simplified Indonesia archipelago outline (viewBox 0 0 1000 400)
// Approximate mercator-ish projection for Indonesia bbox
function project(lng: number, lat: number): [number, number] {
  const minLng = 95, maxLng = 141, minLat = -11, maxLat = 6;
  const pad = 30;
  const w = 1000 - pad * 2;
  const h = 400 - pad * 2;
  const x = pad + ((lng - minLng) / (maxLng - minLng)) * w;
  const y = pad + ((maxLat - lat) / (maxLat - minLat)) * h;
  return [x, y];
}

export default function RegionMap({ employees }: { employees: any[] }) {
  const byRegion: Record<string, number> = {};
  (employees || []).forEach((e: any) => {
    if (e.region) byRegion[e.region] = (byRegion[e.region] || 0) + 1;
  });

  const regions = Object.entries(byRegion).sort((a, b) => b[1] - a[1]);
  const maxCount = Math.max(...regions.map(([, c]) => c), 1);
  const total = employees?.length || 0;

  const markers = regions
    .map(([region, count]) => {
      const coords = REGION_COORDS[region];
      if (!coords) return null;
      const [x, y] = project(coords[0], coords[1]);
      const r = 6 + (count / maxCount) * 10;
      const fill =
        count >= 3 ? '#f97316' : count >= 2 ? '#f59e0b' : '#5b5ef0';
      return { region, count, x, y, r, fill };
    })
    .filter(Boolean) as { region: string; count: number; x: number; y: number; r: number; fill: string }[];

  return (
    <div className="card" style={{ padding: '20px' }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: '14px'
      }}>
        <div style={{
          fontSize: '11px', fontWeight: 650, color: 'var(--text2)',
          textTransform: 'uppercase', letterSpacing: '0.05em'
        }}>
          Employee Map — Indonesia
        </div>
        <span style={{
          fontSize: '11px', fontWeight: 600, color: 'var(--text3)',
          padding: '3px 10px', background: 'var(--bg-subtle)',
          border: '1px solid var(--border)', borderRadius: 'var(--r-pill)'
        }}>
          {total} emp · {regions.length} region
        </span>
      </div>

      {/* Map */}
      <div style={{
        background: 'linear-gradient(180deg, #eef6ff 0%, #f0f7f4 100%)',
        borderRadius: 'var(--r-md)',
        border: '1px solid var(--border-soft)',
        overflow: 'hidden',
        marginBottom: '14px',
      }}>
        <svg viewBox="0 0 1000 400" style={{ width: '100%', height: 'auto', display: 'block' }}>
          {/* Ocean tint */}
          <rect width="1000" height="400" fill="#e8f4fc" />

          {/* Simplified land masses (stylized blobs) */}
          {/* Sumatra */}
          <ellipse cx="180" cy="160" rx="70" ry="120" fill="#d4e5d8" stroke="#b8d0c0" strokeWidth="1.5" transform="rotate(-15 180 160)" />
          {/* Java */}
          <ellipse cx="380" cy="280" rx="110" ry="28" fill="#d4e5d8" stroke="#b8d0c0" strokeWidth="1.5" transform="rotate(-8 380 280)" />
          {/* Kalimantan */}
          <ellipse cx="480" cy="160" rx="90" ry="70" fill="#d4e5d8" stroke="#b8d0c0" strokeWidth="1.5" />
          {/* Sulawesi */}
          <path d="M580 100 Q600 140 590 180 Q620 160 640 200 Q610 220 600 250 Q580 220 560 200 Q570 160 580 100Z" fill="#d4e5d8" stroke="#b8d0c0" strokeWidth="1.5" />
          {/* Papua */}
          <ellipse cx="820" cy="200" rx="100" ry="55" fill="#d4e5d8" stroke="#b8d0c0" strokeWidth="1.5" transform="rotate(10 820 200)" />
          {/* Bali / Nusa */}
          <ellipse cx="500" cy="310" rx="50" ry="14" fill="#d4e5d8" stroke="#b8d0c0" strokeWidth="1.2" />
          {/* Maluku dots */}
          <circle cx="700" cy="220" r="12" fill="#d4e5d8" stroke="#b8d0c0" strokeWidth="1" />
          <circle cx="720" cy="180" r="10" fill="#d4e5d8" stroke="#b8d0c0" strokeWidth="1" />

          {/* Grid subtle */}
          <g stroke="#c5d9e8" strokeWidth="0.5" opacity="0.4">
            {[100, 200, 300].map(y => <line key={y} x1="0" y1={y} x2="1000" y2={y} />)}
            {[200, 400, 600, 800].map(x => <line key={x} x1={x} y1="0" x2={x} y2="400" />)}
          </g>

          {/* Employee markers */}
          {markers.map((m) => (
            <g key={m.region}>
              <circle
                cx={m.x}
                cy={m.y}
                r={m.r + 4}
                fill={m.fill}
                opacity={0.15}
              />
              <circle
                cx={m.x}
                cy={m.y}
                r={m.r}
                fill={m.fill}
                stroke="#fff"
                strokeWidth="2"
                style={{ cursor: 'default' }}
              >
                <title>{m.region}: {m.count} karyawan</title>
              </circle>
              <text
                x={m.x}
                y={m.y + 1}
                textAnchor="middle"
                dominantBaseline="middle"
                fill="#fff"
                fontSize="10"
                fontWeight="700"
                fontFamily="Inter, sans-serif"
              >
                {m.count}
              </text>
            </g>
          ))}

          {markers.length === 0 && (
            <text x="500" y="200" textAnchor="middle" fill="#94a3b8" fontSize="14" fontFamily="Inter, sans-serif">
              No region data
            </text>
          )}
        </svg>
      </div>

      {/* Legend + list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {regions.slice(0, 6).map(([region, count]) => (
          <div key={region} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{
              width: '8px', height: '8px', borderRadius: '50%', flexShrink: 0,
              background: count >= 3 ? '#f97316' : count >= 2 ? '#f59e0b' : '#5b5ef0',
            }} />
            <span style={{ flex: 1, fontSize: '12.5px', fontWeight: 600, color: 'var(--text)' }}>{region}</span>
            <span style={{
              fontSize: '11px', fontWeight: 700, color: 'var(--accent)',
              background: 'var(--accent-soft)', padding: '2px 8px', borderRadius: '999px',
            }}>{count}</span>
          </div>
        ))}
      </div>

      <div style={{
        marginTop: '12px', paddingTop: '10px', borderTop: '1px solid var(--border-soft)',
        display: 'flex', gap: '14px', fontSize: '11px', color: 'var(--text3)'
      }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
          <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#5b5ef0' }} /> 1
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
          <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#f59e0b' }} /> 2
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
          <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#f97316' }} /> 3+
        </span>
      </div>
    </div>
  );
}
