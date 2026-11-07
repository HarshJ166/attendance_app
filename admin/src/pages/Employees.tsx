import { useEffect, useState } from 'react';
import { placeLabel, time, useApi, useLoad, type Place } from '../api';

type Emp = {
  id: number; name: string; email: string | null; employee_code: string | null; phone: string | null; designation: string | null;
  role: 'employee' | 'admin'; active: boolean; created_at: string; places: { id: number; name: string; kind: 'office' | 'home' }[]; last_check_in: string | null;
};

export function Employees() {
  const { data, error, loading, reload } = useLoad<{ employees: Emp[] }>('/admin/employees');
  const [adding, setAdding] = useState(false);
  const [q, setQ] = useState('');
  const [showLeft, setShowLeft] = useState(false);
  const list = (data?.employees ?? []).filter((e) =>
    (showLeft || e.active) && [e.name, e.email, e.employee_code, e.designation].some((v) => v?.toLowerCase().includes(q.trim().toLowerCase())));

  return (
    <div className="page">
      <div className="toolbar">
        <div style={{ display: 'grid', gap: 4 }}>
          <h1>Employees</h1>
          {data ? <div className="muted small">{data.employees.filter((e) => e.active).length} active{data.employees.some((e) => !e.active) ? ` · ${data.employees.filter((e) => !e.active).length} turned off` : ''}</div> : null}
        </div>
        <button className="btn" onClick={() => setAdding(true)}>Add employee</button>
      </div>
      <div className="toolbar" style={{ alignItems: 'center' }}>
        <input className="input" style={{ maxWidth: 360, flex: 1 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, email, code…" aria-label="Search employees" />
        <label className="small" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input type="checkbox" checked={showLeft} onChange={(e) => setShowLeft(e.target.checked)} /> Show people who left
        </label>
      </div>
      {error ? <div className="notice error">{error.message}</div> : null}
      {loading ? <div className="card muted">Loading…</div> : null}
      {data ? (
        <div className="table-wrap">
          <table className="list">
            <thead><tr><th>Name</th><th>Designation</th><th>Can mark attendance at</th><th>Last check-in</th><th>Status</th></tr></thead>
            <tbody>
              {list.map((e) => (
                <tr key={e.id} onClick={() => { location.hash = `#/employees/${e.id}`; }}>
                  <td className="who">
                    <b><a href={`#/employees/${e.id}`} onClick={(ev) => ev.stopPropagation()} style={{ color: 'inherit' }}>{e.name || e.email}</a></b>
                    <span>{[e.employee_code, e.email].filter(Boolean).join(' · ')}</span>
                  </td>
                  <td>{e.designation ?? <span className="muted">–</span>}{e.role === 'admin' ? <div><span className="chip off small">HR admin</span></div> : null}</td>
                  <td>{e.places.length ? e.places.map((p) => placeLabel(p.name, p.kind)).join(', ') : <span className="chip absent">No place: can’t check in</span>}</td>
                  <td className="num">{e.last_check_in ? `${new Date(e.last_check_in).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short' })}, ${time(e.last_check_in)}` : <span className="muted">Never</span>}</td>
                  <td>{e.active ? <span className="chip present">Active</span> : <span className="chip off">Turned off</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {list.length === 0 ? <div className="empty">{q ? 'Nobody matches that search.' : 'No employees yet. Add the first one.'}</div> : null}
        </div>
      ) : null}
      {adding ? <AddEmployee onClose={() => setAdding(false)} onAdded={reload} /> : null}
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
  const [done, setDone] = useState<{ name: string; link: string; id: number } | null>(null);
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
      const r = await api<{ employee: { id: number; name: string }; set_password_link: string }>('/admin/employees', {
        body: { ...f, site_ids: placeIds },
      });
      setDone({ name: r.employee.name, link: r.set_password_link, id: r.employee.id });
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
            <p style={{ margin: 0 }}>Send this <b>one-time link</b> to {done.name} (WhatsApp or email). They open it, choose a password, then log in to the GeoMark app with their email. The link works for 7 days.</p>
            <textarea className="input mono" readOnly value={done.link} rows={4} onFocus={(e) => e.currentTarget.select()} aria-label="Set-password link" />
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="btn" onClick={() => { void navigator.clipboard.writeText(done.link); setCopied(true); }}>{copied ? 'Copied' : 'Copy link'}</button>
              <a className="btn secondary" href={`#/employees/${done.id}`} onClick={onClose}>Open profile</a>
            </div>
            <p className="small muted" style={{ margin: 0 }}>This link isn’t shown again. If it’s lost or expires, make a new one from their profile.</p>
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
