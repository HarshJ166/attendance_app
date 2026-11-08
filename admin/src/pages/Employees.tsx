import { useEffect, useState } from 'react';
import { placeLabel, time, useApi, useLoad, type Place } from '../api';
import { Icon } from '../components/Icon';
import { Avatar } from '../components/Avatar';
import { ImportEmployees } from '../components/ImportEmployees';

type Emp = {
  id: number; name: string; email: string | null; employee_code: string | null; phone: string | null; designation: string | null;
  role: 'employee' | 'admin'; active: boolean; created_at: string; photo_url: string | null; places: { id: number; name: string; kind: 'office' | 'home' }[]; last_check_in: string | null;
};

export function Employees() {
  const { data, error, loading, reload } = useLoad<{ employees: Emp[] }>('/admin/employees');
  const sites = useLoad<{ sites: Place[] }>('/admin/sites');
  const api = useApi();
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [q, setQ] = useState('');
  const [place, setPlace] = useState('');
  const [desig, setDesig] = useState('');
  const [access, setAccess] = useState('');
  const [status, setStatus] = useState('active');
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [bulkPlace, setBulkPlace] = useState('');
  const [bulkMsg, setBulkMsg] = useState<{ ok?: string; err?: string }>({});
  const all = data?.employees ?? [];
  const designations = [...new Set(all.map((e) => e.designation).filter(Boolean) as string[])].sort();
  const needle = q.trim().toLowerCase();
  const list = all.filter((e) =>
    (status === '' || (status === 'active') === e.active) &&
    (!place || (place === 'none' ? e.places.length === 0 : e.places.some((p) => String(p.id) === place))) &&
    (!desig || e.designation === desig) &&
    (!access || e.role === access) &&
    (!needle || [e.name, e.email, e.employee_code, e.designation].some((v) => v?.toLowerCase().includes(needle))));
  const shown = new Set(list.map((e) => e.id));
  const selected = [...picked].filter((id) => shown.has(id));
  const allShownPicked = list.length > 0 && list.every((e) => picked.has(e.id));

  async function bulk(action: 'add' | 'remove') {
    setBulkMsg({});
    try {
      const r = await api<{ place: string; changed: number }>('/admin/employees/bulk-places', { body: { user_ids: selected, site_id: Number(bulkPlace), action } });
      setBulkMsg({ ok: action === 'add' ? `${r.place} added for ${r.changed} ${r.changed === 1 ? 'person' : 'people'}.` : `${r.place} removed from ${r.changed} ${r.changed === 1 ? 'person' : 'people'}.` });
      setPicked(new Set());
      reload();
    } catch (e) {
      setBulkMsg({ err: (e as Error).message });
    }
  }

  return (
    <div className="page">
      <div className="toolbar">
        <div style={{ display: 'grid', gap: 4 }}>
          <h1>Employees</h1>
          {data ? <div className="muted small">{all.filter((e) => e.active).length} active{all.some((e) => !e.active) ? ` · ${all.filter((e) => !e.active).length} turned off` : ''}</div> : null}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn secondary" onClick={() => setImporting(true)}><Icon name="upload" size={18} />Import CSV</button>
          <button className="btn" onClick={() => setAdding(true)}>Add employee</button>
        </div>
      </div>

      <div className="filter-bar">
        <label className="search" style={{ flex: 2 }}>
          <Icon name="search" size={18} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, email, code…" aria-label="Search employees" />
        </label>
        <select className="input" value={place} onChange={(e) => setPlace(e.target.value)} aria-label="Filter by place">
          <option value="">All places</option>
          {(sites.data?.sites ?? []).map((s) => <option key={s.id} value={s.id}>{placeLabel(s.name, s.kind)}{s.kind === 'home' ? ` · ${s.name}` : ''}</option>)}
          <option value="none">No place assigned</option>
        </select>
        <select className="input" value={desig} onChange={(e) => setDesig(e.target.value)} aria-label="Filter by designation">
          <option value="">All designations</option>
          {designations.map((d) => <option key={d}>{d}</option>)}
        </select>
        <select className="input" value={access} onChange={(e) => setAccess(e.target.value)} aria-label="Filter by access">
          <option value="">Everyone</option>
          <option value="employee">Employees</option>
          <option value="admin">HR admins</option>
        </select>
        <select className="input" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status">
          <option value="active">Active</option>
          <option value="inactive">Turned off</option>
          <option value="">Active + turned off</option>
        </select>
      </div>

      {selected.length ? (
        <div className="bulk-bar" role="region" aria-label="Bulk actions">
          <b className="num">{selected.length} selected</b>
          <select className="input" value={bulkPlace} onChange={(e) => setBulkPlace(e.target.value)} aria-label="Place for selected people">
            <option value="">Choose a place…</option>
            {(sites.data?.sites ?? []).filter((s) => s.kind === 'office').map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <button className="btn small" disabled={!bulkPlace} onClick={() => void bulk('add')}>Add place</button>
          <button className="btn danger small" disabled={!bulkPlace} onClick={() => void bulk('remove')}>Remove place</button>
          <button className="link-btn" onClick={() => setPicked(new Set())}>Clear</button>
        </div>
      ) : null}
      {bulkMsg.ok ? <div className="notice" style={{ background: 'var(--present-tint)', color: 'var(--present)' }}>{bulkMsg.ok}</div> : null}
      {bulkMsg.err ? <div className="notice error">{bulkMsg.err}</div> : null}

      {error ? <div className="notice error">{error.message}</div> : null}
      {loading ? <div className="card muted">Loading…</div> : null}
      {data ? (
        <div className="table-wrap">
          <table className="list">
            <thead>
              <tr>
                <th style={{ width: 44 }}>
                  <input type="checkbox" aria-label="Select everyone shown" checked={allShownPicked}
                    onChange={(e) => setPicked(e.target.checked ? new Set([...picked, ...list.map((x) => x.id)]) : new Set([...picked].filter((id) => !shown.has(id))))} />
                </th>
                <th>Name</th><th>Designation</th><th>Can mark attendance at</th><th>Last check-in</th><th>Status</th>
              </tr>
            </thead>
            <tbody>
              {list.map((e) => (
                <tr key={e.id} aria-selected={picked.has(e.id)} onClick={() => { location.hash = `#/employees/${e.id}`; }}>
                  <td onClick={(ev) => ev.stopPropagation()}>
                    <input type="checkbox" aria-label={`Select ${e.name}`} checked={picked.has(e.id)}
                      onChange={(ev) => { const n = new Set(picked); if (ev.target.checked) n.add(e.id); else n.delete(e.id); setPicked(n); }} />
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                      <Avatar name={e.name || e.email || '?'} url={e.photo_url} />
                      <div className="who">
                        <b><a href={`#/employees/${e.id}`} onClick={(ev) => ev.stopPropagation()} style={{ color: 'inherit' }}>{e.name || e.email}</a></b>
                        <span>{[e.employee_code, e.email].filter(Boolean).join(' · ')}</span>
                      </div>
                    </div>
                  </td>
                  <td>{e.designation ?? <span className="muted">–</span>}{e.role === 'admin' ? <div><span className="chip off small">HR admin</span></div> : null}</td>
                  <td>{e.places.length ? e.places.map((p) => placeLabel(p.name, p.kind)).join(', ') : <span className="chip absent">No place: can’t check in</span>}</td>
                  <td className="num">{e.last_check_in ? `${new Date(e.last_check_in).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short' })}, ${time(e.last_check_in)}` : <span className="muted">Never</span>}</td>
                  <td>{e.active ? <span className="chip present">Active</span> : <span className="chip off">Turned off</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {list.length === 0 ? <div className="empty">{all.length ? 'Nobody matches these filters.' : 'No employees yet. Add the first one, or import a CSV.'}</div> : null}
        </div>
      ) : null}
      {adding ? <AddEmployee onClose={() => setAdding(false)} onAdded={reload} /> : null}
      {importing ? <ImportEmployees sites={sites.data?.sites ?? []} existing={all} onClose={() => setImporting(false)} onDone={reload} /> : null}
    </div>
  );
}

function AddEmployee({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const api = useApi();
  const sites = useLoad<{ sites: Place[] }>('/admin/sites');
  const [f, setF] = useState({ name: '', email: '', employee_code: '', phone: '', designation: '', role: 'employee' as 'employee' | 'admin' });
  const [placeIds, setPlaceIds] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ name: string; email: string; password: string | null; link: string | null; id: number } | null>(null);
  const [copied, setCopied] = useState(false);
  const offices = (sites.data?.sites ?? []).filter((s) => s.kind === 'office');

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ employee: { id: number; name: string; email: string }; password: string | null; set_password_link: string | null }>('/admin/employees', {
        body: { ...f, site_ids: placeIds },
      });
      setDone({ name: r.employee.name, email: r.employee.email, password: r.password, link: r.set_password_link, id: r.employee.id });
      onAdded();
    } catch (e2) {
      setErr((e2 as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="panel" role="dialog" aria-modal="true" aria-label="Add employee">
        <div className="panel-head"><h2>{done ? 'Employee added' : 'Add employee'}</h2><button className="btn secondary small" onClick={onClose}>Close</button></div>
        {done ? (
          <div style={{ display: 'grid', gap: 16 }}>
            <div className="notice" style={{ background: 'var(--present-tint)', color: 'var(--present)' }}>✓ {done.name} can now be set up.</div>
            {done.password ? (
              <>
                <p style={{ margin: 0 }}>Tell {done.name} to install the GeoMark app and log in with:</p>
                <div className="card mono" style={{ display: 'grid', gap: 4 }}>
                  <span>Email: {done.email}</span>
                  <span>Password: {done.password}</span>
                </div>
                <p className="small muted" style={{ margin: 0 }}>This is the company default password. They can change it any time in the app: Profile → Change password.</p>
              </>
            ) : (
              <>
                <p style={{ margin: 0 }}>Send this <b>one-time link</b> to {done.name} (WhatsApp or email). They open it, choose a password, then log in to the GeoMark app with their email. The link works for 7 days.</p>
                <textarea className="input mono" readOnly value={done.link ?? ''} rows={4} onFocus={(e) => e.currentTarget.select()} aria-label="Set-password link" />
              </>
            )}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="btn" onClick={() => { void navigator.clipboard.writeText(done.password ? `GeoMark login\nEmail: ${done.email}\nPassword: ${done.password}` : done.link ?? ''); setCopied(true); }}>{copied ? 'Copied' : done.password ? 'Copy login details' : 'Copy link'}</button>
              <a className="btn secondary" href={`#/employees/${done.id}`} onClick={onClose}>Open profile</a>
            </div>
            {done.link ? <p className="small muted" style={{ margin: 0 }}>This link isn’t shown again. If it’s lost or expires, make a new one from their profile.</p> : null}
          </div>
        ) : (
          <form onSubmit={submit} style={{ display: 'grid', gap: 14 }}>
            <label className="field">Full name<input className="input" value={f.name} onChange={set('name')} required maxLength={80} autoComplete="off" /></label>
            <label className="field">Email (their login)<input className="input" type="email" value={f.email} onChange={set('email')} required autoComplete="off" /></label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <label className="field">Employee code<input className="input" value={f.employee_code} onChange={set('employee_code')} maxLength={40} placeholder="optional" /></label>
              <label className="field">Phone<input className="input" type="tel" value={f.phone} onChange={set('phone')} maxLength={30} placeholder="optional" /></label>
            </div>
            <label className="field">Designation<input className="input" value={f.designation} onChange={set('designation')} maxLength={80} placeholder="e.g. Field sales" /></label>
            <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
              <legend style={{ marginBottom: 6 }}>Can mark attendance at</legend>
              {offices.length ? offices.map((s) => (
                <label key={s.id} style={{ display: 'flex', gap: 8, alignItems: 'center', fontWeight: 400, minHeight: 36 }}>
                  <input type="checkbox" checked={placeIds.includes(s.id)} onChange={(e) => setPlaceIds(e.target.checked ? [...placeIds, s.id] : placeIds.filter((x) => x !== s.id))} />
                  {s.name} <span className="muted small">({s.radius_m} m)</span>
                </label>
              )) : <span className="small muted" style={{ fontWeight: 400 }}>No offices yet. Add one under Places.</span>}
              <span className="small muted" style={{ fontWeight: 400 }}>A home location (WFH) can be added from their profile after saving.</span>
            </fieldset>
            <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
              <legend style={{ marginBottom: 6 }}>Access</legend>
              <div className="filters">
                <button type="button" className="filter" aria-pressed={f.role === 'employee'} onClick={() => setF({ ...f, role: 'employee' })}>Employee (app only)</button>
                <button type="button" className="filter" aria-pressed={f.role === 'admin'} onClick={() => setF({ ...f, role: 'admin' })}>HR admin (app + this panel)</button>
              </div>
            </fieldset>
            {err ? <div className="notice error">{err}</div> : null}
            <div><button className="btn" type="submit" disabled={busy}>{busy ? 'Creating login…' : 'Add employee'}</button></div>
          </form>
        )}
      </aside>
    </>
  );
}
