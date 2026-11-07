import { useState } from 'react';
import { distance, REASON, time, useApi, useLoad, type Place } from '../api';
import { CheckinPanel } from '../components/CheckinPanel';
import { CELL, thisMonth } from '../calendar';
import { MonthSwitch } from '../components/MonthSwitch';
import { PlaceEditor } from './Places';

type Day = { day: string; weekday: number; kind: string; rejected: boolean; late_min: number; attendance_id: number | null; marked_at: string | null; site_name: string | null; site_kind: string | null; distance_m: number | null };
type Profile = {
  employee: { id: number; name: string; email: string | null; employee_code: string | null; phone: string | null; designation: string | null; role: 'employee' | 'admin'; active: boolean; created_at: string; consented_at: string | null };
  places: Place[];
  month: string;
  days: Day[];
  summary: { present: number; absent: number; flagged: number; late: number; percent: number | null } | null;
  attempts: { at: string; reason: string; distance_m: number | null; site_name: string | null }[];
};


export function EmployeeProfile({ id }: { id: number }) {
  const [month, setMonth] = useState(thisMonth());
  const { data, error, loading, reload } = useLoad<Profile>(`/admin/employees/${id}?month=${month}`);
  const sites = useLoad<{ sites: Place[] }>('/admin/sites');
  const api = useApi();
  const [open, setOpen] = useState<number | null>(null);
  const [addingHome, setAddingHome] = useState(false);
  const [msg, setMsg] = useState<{ ok?: string; err?: string; link?: string }>({});
  const [busy, setBusy] = useState(false);

  async function patch(body: Record<string, unknown>, ok: string) {
    setBusy(true);
    setMsg({});
    try {
      await api(`/admin/employees/${id}`, { method: 'PATCH', body });
      setMsg({ ok });
      reload();
      sites.reload();
    } catch (e) {
      setMsg({ err: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  if (error) return <div className="page"><a href="#/employees">← Employees</a><div className="notice error">{error.message}</div></div>;
  if (loading || !data) return <div className="page"><a href="#/employees">← Employees</a><div className="card muted">Loading…</div></div>;
  const e = data.employee;
  const mine = new Set(data.places.map((p) => p.id));
  const offices = (sites.data?.sites ?? []).filter((s) => s.kind === 'office');
  const homes = data.places.filter((p) => p.kind === 'home');
  const lead = data.days.length ? (data.days[0].weekday + 6) % 7 : 0;

  return (
    <div className="page">
      <a href="#/employees">← Employees</a>
      <div className="toolbar">
        <div style={{ display: 'grid', gap: 4 }}>
          <h1>{e.name}</h1>
          <div className="muted">{[e.designation, e.employee_code, e.role === 'admin' ? 'HR admin' : null].filter(Boolean).join(' · ')}</div>
        </div>
        {e.active ? <span className="chip present">Active</span> : <span className="chip off">Turned off: can’t log in</span>}
      </div>
      {msg.ok ? <div className="notice" style={{ background: 'var(--present-tint)', color: 'var(--present)' }}>{msg.ok}</div> : null}
      {msg.err ? <div className="notice error">{msg.err}</div> : null}
      {msg.link ? (
        <div className="card" style={{ display: 'grid', gap: 8 }}>
          <b>New set-password link (valid 7 days). Send it to {e.name}:</b>
          <textarea className="input mono" readOnly rows={3} value={msg.link} onFocus={(ev) => ev.currentTarget.select()} />
          <div><button className="btn small" onClick={() => void navigator.clipboard.writeText(msg.link!)}>Copy link</button></div>
        </div>
      ) : null}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 24, alignItems: 'start' }}>
        <DetailsForm key={JSON.stringify(e)} e={e} busy={busy} onSave={(b) => void patch(b, 'Details saved.')} />

        <section className="card" style={{ display: 'grid', gap: 12 }}>
          <h2>Can mark attendance at</h2>
          {offices.map((s) => (
            <label key={s.id} style={{ display: 'flex', gap: 10, alignItems: 'center', minHeight: 40 }}>
              <input type="checkbox" checked={mine.has(s.id)} disabled={busy}
                onChange={(ev) => void patch({ site_ids: ev.target.checked ? [...mine, s.id] : [...mine].filter((x) => x !== s.id) }, ev.target.checked ? `Added ${s.name}.` : `Removed ${s.name}.`)} />
              <span>{s.name} <span className="muted small">({s.radius_m} m)</span></span>
            </label>
          ))}
          {homes.map((h) => (
            <div key={h.id} style={{ display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'space-between', minHeight: 40 }}>
              <span>Home (WFH) <span className="muted small">({h.radius_m} m)</span></span>
              <button className="btn danger small" disabled={busy} onClick={() => void patch({ site_ids: [...mine].filter((x) => x !== h.id) }, 'Home location removed.')}>Remove</button>
            </div>
          ))}
          {!homes.length ? <button className="btn secondary small" style={{ justifySelf: 'start' }} onClick={() => setAddingHome(true)}>Add home location (WFH)</button> : null}
          {!data.places.length ? <div className="notice error small">No place assigned: {e.name} can’t mark attendance yet.</div> : null}
        </section>
      </div>

      <section className="card" style={{ display: 'grid', gap: 16 }}>
        <div className="toolbar" style={{ alignItems: 'center' }}>
          <h2>Attendance</h2>
          <MonthSwitch month={month} onChange={setMonth} />
        </div>
        {data.summary ? (
          <div className="summary">
            {data.summary.percent != null ? <><b>{data.summary.percent}%</b> attendance · </> : null}
            <b>{data.summary.present}</b> present · <b>{data.summary.absent}</b> absent · <b>{data.summary.late}</b> late · <b>{data.summary.flagged}</b> for HR check
          </div>
        ) : null}
        <div className="cal" role="grid" aria-label="Month calendar">
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <div key={d} className="cal-head" role="columnheader">{d}</div>)}
          {Array.from({ length: lead }, (_, i) => <div key={`b${i}`} />)}
          {data.days.map((d) => {
            const look = CELL[d.rejected ? 'absent' : d.kind] ?? CELL.future;
            const label = `${d.day}: ${d.rejected ? 'Rejected by HR' : look.word}${d.marked_at ? `, ${time(d.marked_at)}` : ''}${d.late_min ? `, late ${d.late_min} min` : ''}`;
            return d.attendance_id ? (
              <button key={d.day} className={`cal-day ${look.cls}`} onClick={() => setOpen(d.attendance_id)} aria-label={label} title={label}>
                <span className="num">{Number(d.day.slice(8))}</span>
                <span className="g">{d.rejected ? '✗' : look.glyph}</span>
                {d.marked_at ? <span className="t num">{time(d.marked_at)}</span> : null}
                {d.late_min ? <span className="late-dot" aria-hidden="true" /> : null}
              </button>
            ) : (
              <div key={d.day} className={`cal-day ${look.cls}`} aria-label={label} title={label} role="gridcell">
                <span className="num">{Number(d.day.slice(8))}</span>
                <span className="g">{look.glyph}</span>
              </div>
            );
          })}
        </div>
        <div className="key"><span>✓ present</span><span>! HR check</span><span>✗ absent / rejected</span><span><i style={{ background: 'var(--warn)', width: 8, height: 8 }} />late</span><span>off = Sunday</span><span>Click a marked day for the selfie and map</span></div>
      </section>

      {data.attempts.length ? (
        <section style={{ display: 'grid', gap: 12 }}>
          <h2>Blocked attempts (last 30 days)</h2>
          <div className="table-wrap">
            <table className="list">
              <thead><tr><th>When</th><th>Reason</th><th>Nearest place</th><th>Distance</th></tr></thead>
              <tbody>
                {data.attempts.map((t) => (
                  <tr key={t.at} style={{ cursor: 'default' }}>
                    <td className="num">{new Date(t.at).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short' })}, {time(t.at)}</td>
                    <td>{REASON[t.reason] ?? t.reason}</td>
                    <td>{t.site_name ?? '–'}</td>
                    <td className="num">{distance(t.distance_m)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <section className="card" style={{ display: 'grid', gap: 12 }}>
        <h2>Account</h2>
        <div className="small muted">
          Login: {e.email} · Joined {new Date(e.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}
          {' · '}Consent {e.consented_at ? `given ${new Date(e.consented_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}` : 'not given yet'}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn secondary" disabled={busy} onClick={async () => {
            setMsg({});
            try { const r = await api<{ set_password_link: string }>(`/admin/employees/${id}/password-link`, { body: {} }); setMsg({ link: r.set_password_link }); }
            catch (err) { setMsg({ err: (err as Error).message }); }
          }}>New set-password link</button>
          {e.role !== 'admin' ? (
            <button className="btn secondary" disabled={busy} onClick={() => window.confirm(`Give ${e.name} HR admin access to this panel?`) && void patch({ role: 'admin' }, `${e.name} is now an HR admin.`)}>Make HR admin</button>
          ) : null}
          {e.active ? (
            <button className="btn danger" disabled={busy} onClick={() => window.confirm(`Turn off ${e.name}? They won’t be able to log in. Their history stays.`) && void patch({ active: false }, `${e.name} is turned off and can’t log in.`)}>Turn off (left company)</button>
          ) : (
            <button className="btn" disabled={busy} onClick={() => void patch({ active: true }, `${e.name} is active again.`)}>Turn back on</button>
          )}
        </div>
      </section>

      {open != null ? <CheckinPanel id={open} onClose={() => setOpen(null)} onReviewed={reload} /> : null}
      {addingHome ? (
        <PlaceEditor
          site={null} presetKind="home" assignTo={{ id: e.id, name: e.name }}
          onClose={() => setAddingHome(false)}
          onSaved={() => { setAddingHome(false); setMsg({ ok: 'Home location added. They can now mark attendance from home.' }); reload(); sites.reload(); }}
        />
      ) : null}
    </div>
  );
}

function DetailsForm({ e, busy, onSave }: { e: Profile['employee']; busy: boolean; onSave: (b: Record<string, unknown>) => void }) {
  const [f, setF] = useState({ name: e.name, employee_code: e.employee_code ?? '', phone: e.phone ?? '', designation: e.designation ?? '' });
  const set = (k: keyof typeof f) => (ev: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: ev.target.value });
  const dirty = f.name !== e.name || f.employee_code !== (e.employee_code ?? '') || f.phone !== (e.phone ?? '') || f.designation !== (e.designation ?? '');
  return (
    <form className="card" style={{ display: 'grid', gap: 12 }} onSubmit={(ev) => { ev.preventDefault(); onSave(f); }}>
      <h2>Details</h2>
      <label className="field">Full name<input className="input" value={f.name} onChange={set('name')} required maxLength={80} /></label>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <label className="field">Employee code<input className="input" value={f.employee_code} onChange={set('employee_code')} maxLength={40} /></label>
        <label className="field">Phone<input className="input" type="tel" value={f.phone} onChange={set('phone')} maxLength={30} /></label>
      </div>
      <label className="field">Designation<input className="input" value={f.designation} onChange={set('designation')} maxLength={80} /></label>
      <div><button className="btn" type="submit" disabled={busy || !dirty}>Save details</button></div>
      <span className="small muted">Email is their login and can’t be changed here.</span>
    </form>
  );
}
