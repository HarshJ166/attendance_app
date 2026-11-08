import { useEffect, useRef, useState } from 'react';
import { useApi } from '../api';
import { mountMap, type GeoMap, type Handle } from '../geomap';

export type Pin = { lat: number; lng: number; radius_m: number };

/**
 * Pick a place: search an address OR click the map (drag the pin to fine-tune), then set the radius.
 * The circle on the map is exactly the area where check-ins will be allowed.
 */
export function PlacePicker({ value, onChange }: { value: Pin | null; onChange: (p: Pin) => void }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<GeoMap | null>(null);
  const [ready, setReady] = useState(false); // the map loads async (Mappls SDK)
  const layer = useRef<{ marker: Handle; circle: Handle } | null>(null);
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
    const v = latest.current.value;
    const stop = mountMap(el.current, { center: v ?? { lat: 19.076, lng: 72.8777 }, zoom: v ? 17 : 11 }, (m) => { // Mumbai until a pin exists
      m.onClick((p) => {
        const { value: cur, onChange: set } = latest.current;
        set({ lat: +p.lat.toFixed(6), lng: +p.lng.toFixed(6), radius_m: cur?.radius_m ?? 150 });
      });
      map.current = m;
      setReady(true);
    });
    return () => {
      stop();
      map.current = null;
      layer.current = null;
      setReady(false);
    };
  }, []);

  // Draw / move the pin and circle whenever the value changes.
  useEffect(() => {
    const m = map.current;
    if (!m || !value) return;
    if (!layer.current) {
      const circle = m.area(value, value.radius_m, { color: '#0b6b4b', fillOpacity: 0.12 });
      const marker = m.marker(value, '<div class="pick-pin"></div>', (p) => {
        const { value: v, onChange: set } = latest.current;
        set({ lat: +p.lat.toFixed(6), lng: +p.lng.toFixed(6), radius_m: v?.radius_m ?? 150 });
      });
      layer.current = { marker, circle };
      m.fit([{ ...value, r: value.radius_m }], 17);
    } else {
      layer.current.marker.move(value);
      layer.current.circle.move(value, value.radius_m);
    }
  }, [value, ready]);

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
    map.current?.fit([{ ...r, r: value?.radius_m ?? 150 }], 17); // whole allowed area in view
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
