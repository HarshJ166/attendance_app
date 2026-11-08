import L from 'leaflet';
import { useEffect, useRef, useState } from 'react';
import { useApi } from '../api';

export type Pin = { lat: number; lng: number; radius_m: number };

/**
 * Pick a place: search an address OR click the map (drag the pin to fine-tune), then set the radius.
 * The circle on the map is exactly the area where check-ins will be allowed.
 */
export function PlacePicker({ value, onChange }: { value: Pin | null; onChange: (p: Pin) => void }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<{ marker: L.Marker; circle: L.Circle } | null>(null);
  const latest = useRef({ value, onChange });
  useEffect(() => {
    latest.current = { value, onChange }; // map callbacks read the newest value without re-creating the map
  });
  const api = useApi();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<{ label: string; lat: number; lng: number; source?: string }[] | null>(null);
  const [searchMsg, setSearchMsg] = useState<string | null>(null);

  // Create the map once.
  useEffect(() => {
    if (!el.current) return;
    const m = L.map(el.current).setView([19.0760, 72.8777], 11); // Mumbai until a pin exists
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap contributors' }).addTo(m);
    m.on('click', (e: L.LeafletMouseEvent) => {
      const { value: v, onChange: set } = latest.current;
      set({ lat: +e.latlng.lat.toFixed(6), lng: +e.latlng.lng.toFixed(6), radius_m: v?.radius_m ?? 150 });
    });
    map.current = m;
    return () => {
      m.remove();
      map.current = null;
      layer.current = null;
    };
  }, []);

  // Draw / move the pin and circle whenever the value changes.
  useEffect(() => {
    const m = map.current;
    if (!m || !value) return;
    if (!layer.current) {
      const marker = L.marker([value.lat, value.lng], {
        draggable: true,
        icon: L.divIcon({ className: '', html: '<div class="pick-pin"></div>', iconSize: [22, 22], iconAnchor: [11, 11] }),
      }).addTo(m);
      marker.on('dragend', () => {
        const p = marker.getLatLng();
        const { value: v, onChange: set } = latest.current;
        set({ lat: +p.lat.toFixed(6), lng: +p.lng.toFixed(6), radius_m: v?.radius_m ?? 150 });
      });
      const circle = L.circle([value.lat, value.lng], { radius: value.radius_m, color: '#0b6b4b', weight: 2, fillOpacity: 0.12 }).addTo(m);
      layer.current = { marker, circle };
      m.fitBounds(L.latLng(value.lat, value.lng).toBounds(value.radius_m * 2), { padding: [40, 40], maxZoom: 17, animate: false });
    } else {
      layer.current.marker.setLatLng([value.lat, value.lng]);
      layer.current.circle.setLatLng([value.lat, value.lng]).setRadius(value.radius_m);
    }
  }, [value]);

  // Not a <form>: this sits inside the place editor's form, and nested forms make Enter submit the outer one.
  async function search() {
    if (!q.trim()) return;
    setSearchMsg(null);
    const r = await api<{ results: { label: string; lat: number; lng: number; source: string }[]; message?: string }>(`/admin/geocode?q=${encodeURIComponent(q)}`).catch(() => ({ results: [], message: 'Search failed. Paste coordinates or click on the map instead.' }));
    // A pasted pin (coordinates / Google link) is exact: jump straight to it.
    if (r.results.length === 1 && (r.results[0].source === 'coordinates' || r.results[0].source === 'google')) {
      choose(r.results[0]);
      setSearchMsg(`Pin placed from ${r.results[0].source === 'google' ? 'the Google Maps link' : 'the coordinates'}.`);
      return;
    }
    setResults(r.results);
    if (r.message) setSearchMsg(r.message);
    else if (!r.results.length) setSearchMsg('No match. Paste coordinates or a Google Maps link, or click on the map.');
  }

  function choose(r: { lat: number; lng: number }) {
    onChange({ lat: +r.lat.toFixed(6), lng: +r.lng.toFixed(6), radius_m: value?.radius_m ?? 150 });
    map.current?.setView([r.lat, r.lng], 17, { animate: false });
    setResults(null);
  }

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div role="search" style={{ display: 'flex', gap: 8 }}>
        <input
          className="input" style={{ flex: 1 }} value={q} onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void search(); } }}
          placeholder="Address, coordinates (19.2066, 72.8357) or a Google Maps link" aria-label="Search address, or paste coordinates or a Google Maps link"
        />
        <button className="btn secondary" type="button" onClick={() => void search()} disabled={!q.trim()}>Search</button>
      </div>
      {results && results.length ? (
        <ul className="picker-results">
          {results.map((r) => (
            <li key={`${r.lat},${r.lng}`}><button type="button" onClick={() => choose(r)}>{r.label} <span className="muted small">· {r.source === 'mappls' ? 'Mappls' : r.source === 'osm' ? 'OpenStreetMap' : 'pin'}</span></button></li>
          ))}
        </ul>
      ) : null}
      {searchMsg ? <div className="small muted">{searchMsg}</div> : null}
      <div className="small muted">Tip: in Google Maps, long-press the entrance, copy the numbers or use Share → Copy link, and paste here.</div>
      <div ref={el} className="map" style={{ height: 340, cursor: 'crosshair' }} aria-label="Map: click to place the pin, drag it to adjust" />
      <div className="small muted">{value ? `Pin at ${value.lat.toFixed(5)}, ${value.lng.toFixed(5)}. Drag it to adjust.` : 'Click on the map to drop the pin.'}</div>
      <label className="field">
        Allowed area: <span className="num">{value?.radius_m ?? 150} m</span> around the pin
        <input
          type="range" min={25} max={1000} step={25}
          value={value?.radius_m ?? 150}
          disabled={!value}
          onChange={(e) => value && onChange({ ...value, radius_m: Number(e.target.value) })}
        />
        <span className="small muted" style={{ fontWeight: 400 }}>Indoors, GPS drifts 20–100 m. 150 m suits most offices; homes can be 75–100 m.</span>
      </label>
    </div>
  );
}
