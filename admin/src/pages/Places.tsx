import { useEffect, useRef, useState } from 'react';
import { placeLabel, useApi, useLoad, type Place } from '../api';
import { PlacePicker, type Pin } from '../components/PlacePicker';
import { dot, mountMap } from '../geomap';

type SiteRow = Place & { people: { id: number; name: string }[] };

export function Places() {
  const { data, error, loading, reload } = useLoad<{ sites: SiteRow[] }>('/admin/sites');
  const [editing, setEditing] = useState<SiteRow | 'new' | null>(null);

  return (
    <div className="page">
      <div className="toolbar">
        <div style={{ display: 'grid', gap: 4 }}>
          <h1>Places</h1>
          <p className="muted" style={{ margin: 0 }}>Offices, branches and work-from-home locations. People can mark attendance only inside the places assigned to them.</p>
        </div>
        <button className="btn" onClick={() => setEditing('new')}>Add place</button>
      </div>
      {error ? <div className="notice error">{error.message}</div> : null}
      {loading ? <div className="card muted">Loading…</div> : null}
      {data ? (
        <>
          <AllPlacesMap sites={data.sites} />
          <div className="table-wrap">
            <table className="list">
              <thead><tr><th>Name</th><th>Type</th><th>Area</th><th>Assigned to</th><th><span className="visually-hidden">Edit</span></th></tr></thead>
              <tbody>
                {data.sites.map((s) => (
                  <tr key={s.id} onClick={() => setEditing(s)}>
                    <td><b>{s.name}</b><div className="mono muted">{s.lat.toFixed(5)}, {s.lng.toFixed(5)}</div></td>
                    <td>{s.kind === 'home' ? <span className="chip off">Home (WFH)</span> : <span className="chip present">Office</span>}</td>
                    <td className="num">{s.radius_m} m</td>
                    <td>{s.people.length ? s.people.map((p) => p.name).join(', ') : <span className="muted">Nobody yet</span>}</td>
                    <td><button className="btn secondary small" onClick={(e) => { e.stopPropagation(); setEditing(s); }}>Edit</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data.sites.length === 0 ? <div className="empty">No places yet. Add your office first.</div> : null}
          </div>
        </>
      ) : null}
      {editing ? <PlaceEditor site={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} /> : null}
    </div>
  );
}

function AllPlacesMap({ sites }: { sites: SiteRow[] }) {
  const el = useRef<HTMLDivElement>(null);
  const key = JSON.stringify(sites.map((s) => [s.id, s.lat, s.lng, s.radius_m, s.kind]));
  useEffect(() => {
    if (!el.current || !sites.length) return;
    return mountMap(el.current, { center: sites[0], zoom: 12, scrollZoom: false }, (map) => {
      map.fit(sites.map((s) => ({ ...s, r: s.radius_m })), 16);
      for (const s of sites) {
        const color = s.kind === 'home' ? '#52615a' : '#0b6b4b';
        map.area(s, s.radius_m, { color, fillOpacity: 0.12 });
        // Circles are tiny when zoomed out to show far-apart branches, so every place also gets a labelled pin.
        const label = s.kind === 'home' ? `Home · ${s.name.replace(/ – home$/, '')}` : s.name;
        map.marker(s, dot({ size: 14, fill: color, label, title: `${placeLabel(s.name, s.kind)} · ${s.radius_m} m area` }));
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  if (!sites.length) return null;
  return <div ref={el} className="map" role="img" aria-label={`Map of ${sites.length} places`} />;
}

export function PlaceEditor({ site, presetKind, assignTo, onClose, onSaved }: {
  site: SiteRow | null;
  presetKind?: 'office' | 'home';
  assignTo?: { id: number; name: string };
  onClose: () => void;
  onSaved: (id: number) => void;
}) {
  const api = useApi();
  const [name, setName] = useState(site?.name ?? (assignTo ? `${assignTo.name} – home` : ''));
  const [kind, setKind] = useState<'office' | 'home'>(site?.kind ?? presetKind ?? 'office');
  const [pin, setPin] = useState<Pin | null>(site ? { lat: site.lat, lng: site.lng, radius_m: site.radius_m } : null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!pin) return setErr('Drop the pin on the map first.');
    setBusy(true);
    setErr(null);
    try {
      const payload = { name: name.trim(), kind, ...pin, ...(assignTo && !site ? { user_ids: [assignTo.id] } : {}) };
      const r = site
        ? await api<{ site: Place }>(`/admin/sites/${site.id}`, { method: 'PATCH', body: payload })
        : await api<{ site: Place }>('/admin/sites', { body: payload });
      onSaved(r.site.id);
    } catch (e2) {
      setErr((e2 as Error).message);
      setBusy(false);
    }
  }

  async function remove() {
    if (!site || !window.confirm(`Delete “${site.name}”? People assigned to it lose this place.`)) return;
    setBusy(true);
    try {
      await api(`/admin/sites/${site.id}`, { method: 'DELETE' });
      onSaved(site.id);
    } catch (e2) {
      setErr((e2 as Error).message);
      setBusy(false);
    }
  }

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="panel" role="dialog" aria-modal="true" aria-label={site ? 'Edit place' : 'Add place'}>
        <div className="panel-head">
          <h2>{site ? 'Edit place' : assignTo ? `Home location for ${assignTo.name}` : 'Add place'}</h2>
          <button className="btn secondary small" onClick={onClose}>Close</button>
        </div>
        <form onSubmit={save} style={{ display: 'grid', gap: 16 }}>
          <label className="field">Name<input className="input" value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} placeholder="e.g. Andheri branch" /></label>
          {!assignTo ? (
            <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
              <legend style={{ marginBottom: 6 }}>Type</legend>
              <div className="filters">
                <button type="button" className="filter" aria-pressed={kind === 'office'} onClick={() => setKind('office')}>Office / branch</button>
                <button type="button" className="filter" aria-pressed={kind === 'home'} onClick={() => setKind('home')}>Home (work from home)</button>
              </div>
            </fieldset>
          ) : null}
          {kind === 'home' ? <div className="notice warn small">Home locations are personal data. Only HR can see them, and the employee only sees “Home (WFH)”.</div> : null}
          <PlacePicker value={pin} onChange={setPin} />
          {site?.people.length ? <div className="small muted">Assigned to: {site.people.map((p) => p.name).join(', ')}. Changes apply to their next check-in.</div> : null}
          {err ? <div className="notice error">{err}</div> : null}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn" type="submit" disabled={busy || !name.trim() || !pin}>{busy ? 'Saving…' : 'Save place'}</button>
            {site ? <button className="btn danger" type="button" disabled={busy} onClick={() => void remove()}>Delete</button> : null}
          </div>
        </form>
      </aside>
    </>
  );
}
