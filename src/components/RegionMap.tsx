'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Interactive Indonesia province map
 * GeoJSON: superpikar/indonesia-geojson (indonesia-province-simple.json)
 * https://github.com/superpikar/indonesia-geojson
 * Map engine: Leaflet (CDN)
 */

const GEOJSON_URL =
  'https://cdn.jsdelivr.net/gh/superpikar/indonesia-geojson@master/indonesia-province-simple.json';

const LEAFLET_CSS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
const LEAFLET_JS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';

function normalizeName(s: string) {
  return (s || '')
    .toLowerCase()
    .replace(/provinsi|daerah khusus|daerah istimewa|dki|di\s/gi, '')
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

function getFeatureName(props: any): string {
  return (
    props?.Propinsi ||
    props?.PROVINSI ||
    props?.provinsi ||
    props?.name ||
    props?.NAME_1 ||
    props?.state ||
    ''
  );
}

export default function RegionMap({ employees }: { employees: any[] }) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<any>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errorMsg, setErrorMsg] = useState('');

  const byRegion: Record<string, number> = {};
  (employees || []).forEach((e: any) => {
    if (e.region) byRegion[e.region] = (byRegion[e.region] || 0) + 1;
  });
  const regions = Object.entries(byRegion).sort((a, b) => b[1] - a[1]);
  const maxCount = Math.max(...regions.map(([, c]) => c), 1);
  const total = employees?.length || 0;

  // Build lookup: normalized province name -> count
  const countLookup: Record<string, { label: string; count: number }> = {};
  regions.forEach(([label, count]) => {
    countLookup[normalizeName(label)] = { label, count };
  });

  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        // Load Leaflet CSS once
        if (!document.querySelector(`link[href="${LEAFLET_CSS}"]`)) {
          const link = document.createElement('link');
          link.rel = 'stylesheet';
          link.href = LEAFLET_CSS;
          document.head.appendChild(link);
        }

        // Load Leaflet JS
        const L = await loadLeaflet();
        if (cancelled || !mapRef.current) return;

        // Clean previous map
        if (mapInstance.current) {
          mapInstance.current.remove();
          mapInstance.current = null;
        }

        const map = L.map(mapRef.current, {
          zoomControl: true,
          attributionControl: true,
          scrollWheelZoom: false,
        }).setView([-2.5, 118], 4.2);

        L.tileLayer('https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png', {
          attribution: '&copy; OpenStreetMap &copy; CARTO',
          maxZoom: 12,
        }).addTo(map);

        const res = await fetch(GEOJSON_URL);
        if (!res.ok) throw new Error(`GeoJSON HTTP ${res.status}`);
        const geojson = await res.json();

        function styleFeature(feature: any) {
          const name = getFeatureName(feature.properties);
          const hit = countLookup[normalizeName(name)];
          const count = hit?.count || 0;
          let fill = '#e2e8f0';
          if (count >= 3) fill = '#f97316';
          else if (count >= 2) fill = '#f59e0b';
          else if (count >= 1) fill = '#818cf8';

          return {
            fillColor: fill,
            weight: count > 0 ? 1.5 : 0.8,
            opacity: 1,
            color: count > 0 ? '#4338ca' : '#94a3b8',
            fillOpacity: count > 0 ? 0.72 : 0.35,
          };
        }

        function onEachFeature(feature: any, layer: any) {
          const name = getFeatureName(feature.properties);
          const hit = countLookup[normalizeName(name)];
          const count = hit?.count || 0;
          const label = hit?.label || name;

          layer.bindTooltip(
            `<strong>${label}</strong><br/>${count} karyawan`,
            { sticky: true, className: 'map-tooltip' }
          );

          layer.on({
            mouseover: (e: any) => {
              e.target.setStyle({ weight: 2.5, fillOpacity: 0.9 });
              e.target.bringToFront();
            },
            mouseout: (e: any) => {
              geoLayer.resetStyle(e.target);
            },
          });
        }

        const geoLayer = L.geoJSON(geojson, {
          style: styleFeature,
          onEachFeature,
        }).addTo(map);

        try {
          map.fitBounds(geoLayer.getBounds(), { padding: [12, 12], maxZoom: 5 });
        } catch {
          /* ignore */
        }

        mapInstance.current = map;
        setStatus('ready');

        // Fix size after layout
        setTimeout(() => map.invalidateSize(), 100);
      } catch (err: any) {
        console.error('Map load error', err);
        if (!cancelled) {
          setStatus('error');
          setErrorMsg(err?.message || 'Gagal memuat peta');
        }
      }
    }

    init();
    return () => {
      cancelled = true;
      if (mapInstance.current) {
        mapInstance.current.remove();
        mapInstance.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employees]);

  return (
    <div
      className="card"
      style={{
        padding: '18px',
        position: 'relative',
        zIndex: 0,
        isolation: 'isolate',
        overflow: 'hidden',
      }}
    >
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: '12px', gap: '10px', flexWrap: 'wrap',
      }}>
        <div style={{
          fontSize: '11px', fontWeight: 650, color: 'var(--text2)',
          textTransform: 'uppercase', letterSpacing: '0.05em',
        }}>
          Peta Administratif Indonesia
        </div>
        <span style={{
          fontSize: '11px', fontWeight: 600, color: 'var(--text3)',
          padding: '3px 10px', background: 'var(--bg-subtle)',
          border: '1px solid var(--border)', borderRadius: 'var(--r-pill)',
        }}>
          {total} emp · {regions.length} region
        </span>
      </div>

      <div style={{
        position: 'relative',
        zIndex: 0,
        isolation: 'isolate',
        contain: 'paint',
        borderRadius: 'var(--r-md)',
        overflow: 'hidden',
        border: '1px solid var(--border)',
        background: '#eef2f7',
        height: '280px',
      }}>
        <div ref={mapRef} style={{ width: '100%', height: '100%', position: 'relative', zIndex: 0 }} />

        {status === 'loading' && (
          <div style={{
            position: 'absolute', inset: 0, display: 'flex',
            alignItems: 'center', justifyContent: 'center',
            background: 'rgba(247,248,251,0.85)', fontSize: '13px', color: 'var(--text3)',
          }}>
            Memuat peta GeoJSON…
          </div>
        )}
        {status === 'error' && (
          <div style={{
            position: 'absolute', inset: 0, display: 'flex',
            alignItems: 'center', justifyContent: 'center',
            background: 'rgba(247,248,251,0.92)', fontSize: '13px', color: 'var(--error)',
            padding: '16px', textAlign: 'center',
          }}>
            {errorMsg || 'Gagal memuat peta'}
          </div>
        )}
      </div>

      <div style={{
        marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '6px',
      }}>
        {regions.slice(0, 5).map(([region, count]) => (
          <div key={region} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{
              width: '8px', height: '8px', borderRadius: '50%', flexShrink: 0,
              background: count >= 3 ? '#f97316' : count >= 2 ? '#f59e0b' : '#818cf8',
            }} />
            <span style={{ flex: 1, fontSize: '12.5px', fontWeight: 600 }}>{region}</span>
            <span style={{
              fontSize: '11px', fontWeight: 700, color: 'var(--accent)',
              background: 'var(--accent-soft)', padding: '2px 8px', borderRadius: '999px',
            }}>{count}</span>
          </div>
        ))}
      </div>

      <div style={{
        marginTop: '10px', fontSize: '10.5px', color: 'var(--text3)',
      }}>
        Sumber: {' '}
        <a
          href="https://github.com/superpikar/indonesia-geojson"
          target="_blank"
          rel="noreferrer"
        >
          superpikar/indonesia-geojson
        </a>
        {' '}· Leaflet
      </div>
    </div>
  );
}

function loadLeaflet(): Promise<any> {
  if (typeof window !== 'undefined' && (window as any).L) {
    return Promise.resolve((window as any).L);
  }
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${LEAFLET_JS}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve((window as any).L));
      return;
    }
    const script = document.createElement('script');
    script.src = LEAFLET_JS;
    script.async = true;
    script.onload = () => resolve((window as any).L);
    script.onerror = () => reject(new Error('Gagal load Leaflet'));
    document.head.appendChild(script);
  });
}
