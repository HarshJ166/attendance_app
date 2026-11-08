import { useState } from 'react';
import { longDate, useApi, useLoad } from '../api';

type H = { day: string; name: string; added_by: string | null };
const thisYear = () => Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric' }).format(new Date()));

/** Settings → Holidays: list a year, add custom dates, one-click fixed national holidays, remove. */
export function Holidays() {
  const [year, setYear] = useState(thisYear());
  const { data, error, loading, reload } = useLoad<{ holidays: H[] }>(`/admin/holidays?year=${year}`);
  const api = useApi();
  const [day, setDay] = useState('');
  const [name, setName] = useState('');
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>({});
  const [busy, setBusy] = useState(false);

  async function act(fn: () => Promise<string>) {
    setBusy(true);
    setMsg({});
    try {
      setMsg({ ok: await fn() });
      reload();
    } catch (e) {
      setMsg({ err: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  const add = (e: React.FormEvent) => {
    e.preventDefault();
    void act(async () => {
      await api('/admin/holidays', { body: { day, name: name.trim() } });
      const n = name.trim();
      setDay('');
      setName('');
      if (day.slice(0, 4) !== String(year)) setYear(Number(day.slice(0, 4)));
      return `${n} added on ${longDate(day)}. Nobody will be marked absent that day.`;
    });
  };

  return (
    <section className="card" style={{ display: 'grid', gap: 16 }}>
      <div className="toolbar" style={{ alignItems: 'center' }}>
        <div style={{ display: 'grid', gap: 4 }}>
          <h2>Holidays</h2>
          <span className="small muted">Like Sundays: nobody is absent. Anyone who checks in still counts as present.</span>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }} role="group" aria-label="Year">
          <button className="btn secondary small" onClick={() => setYear(year - 1)} aria-label="Previous year">‹</button>
          <b className="num" style={{ minWidth: 48, textAlign: 'center' }}>{year}</b>
          <button className="btn secondary small" onClick={() => setYear(year + 1)} aria-label="Next year">›</button>
        </div>
      </div>

      <form onSubmit={add} style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'end' }}>
        <label className="field">Date<input className="input" type="date" value={day} onChange={(e) => setDay(e.target.value)} required /></label>
        <label className="field" style={{ flex: 1, minWidth: 200 }}>Name<input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Diwali, Holi, Eid, company anniversary" maxLength={80} required /></label>
        <button className="btn" type="submit" disabled={busy || !day || !name.trim()}>Add holiday</button>
      </form>

      {msg.ok ? <div className="notice" style={{ background: 'var(--present-tint)', color: 'var(--present)' }}>{msg.ok}</div> : null}
      {msg.err ? <div className="notice error">{msg.err}</div> : null}
      {error ? <div className="notice error">{error.message}</div> : null}
      {loading ? <div className="muted">Loading…</div> : null}

      {data ? (
        data.holidays.length ? (
          <div className="table-wrap">
            <table className="list">
              <thead><tr><th>Date</th><th>Holiday</th><th>Added by</th><th><span className="visually-hidden">Remove</span></th></tr></thead>
              <tbody>
                {data.holidays.map((h) => (
                  <tr key={h.day} style={{ cursor: 'default' }}>
                    <td className="num">{longDate(h.day)}</td>
                    <td><b>{h.name}</b></td>
                    <td className="muted small">{h.added_by ?? '–'}</td>
                    <td>
                      <button className="btn danger small" disabled={busy}
                        onClick={() => window.confirm(`Remove “${h.name}” (${longDate(h.day)})? People without a check-in that day will count as absent again.`) &&
                          void act(async () => { await api(`/admin/holidays/${h.day}`, { method: 'DELETE' }); return `${h.name} removed.`; })}>
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <div className="empty">No holidays in {year} yet.</div>
      ) : null}

      <div style={{ display: 'grid', gap: 6 }}>
        <div>
          <button className="btn secondary" disabled={busy}
            onClick={() => void act(async () => {
              const r = await api<{ added: { name: string }[] }>('/admin/holidays/fixed', { body: { year } });
              return r.added.length ? `Added ${r.added.map((x) => x.name).join(', ')}.` : `The fixed national holidays for ${year} are already in the list.`;
            })}>
            Add fixed national holidays for {year}
          </button>
        </div>
        <span className="small muted">Republic Day (26 Jan), Maharashtra Day (1 May), Independence Day (15 Aug), Gandhi Jayanti (2 Oct), Christmas (25 Dec). Festival dates (Diwali, Holi, Eid…) change every year, so add those yourself.</span>
      </div>
    </section>
  );
}
