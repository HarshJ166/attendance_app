import { useState } from 'react';
import { useApi, useLoad } from '../api';

type S = { shift_start: string; grace_min: number };

export function Settings() {
  const { data, error, loading } = useLoad<{ settings: S }>('/admin/settings');
  return (
    <div className="page" style={{ maxWidth: 640 }}>
      <h1>Settings</h1>
      {error ? <div className="notice error">{error.message}</div> : null}
      {loading ? <div className="card muted">Loading…</div> : null}
      {data ? <ShiftForm initial={data.settings} /> : null}
      <section className="card" style={{ display: 'grid', gap: 8 }}>
        <h2>Fixed rules</h2>
        <ul style={{ margin: 0, paddingLeft: 18 }} className="small">
          <li>Weekly off: Sunday.</li>
          <li>Check-ins outside all of a person’s places, or with a fake-location app, are blocked and logged.</li>
          <li>Selfies are deleted automatically after 90 days.</li>
        </ul>
      </section>
    </div>
  );
}

function ShiftForm({ initial }: { initial: S }) {
  const api = useApi();
  const [shift, setShift] = useState(initial.shift_start);
  const [grace, setGrace] = useState(String(initial.grace_min));
  const [state, setState] = useState<{ busy?: boolean; ok?: string; err?: string }>({});

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setState({ busy: true });
    try {
      const r = await api<{ settings: S }>('/admin/settings', { method: 'PATCH', body: { shift_start: shift, grace_min: Number(grace) } });
      setState({ ok: `Saved. Late now means after ${lateFrom(r.settings)}.` });
    } catch (e2) {
      setState({ err: (e2 as Error).message });
    }
  }

  return (
    <form className="card" onSubmit={save} style={{ display: 'grid', gap: 16 }}>
      <h2>Shift and late rule</h2>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <label className="field">Shift starts<input className="input" type="time" value={shift} onChange={(e) => setShift(e.target.value)} required /></label>
        <label className="field">Grace (minutes)<input className="input" type="number" min={0} max={240} value={grace} onChange={(e) => setGrace(e.target.value)} required style={{ width: 140 }} /></label>
      </div>
      <p className="small muted" style={{ margin: 0 }}>
        Anyone checking in after <b className="num">{lateFrom({ shift_start: shift, grace_min: Number(grace) || 0 })}</b> is marked late.
        Applies from the next check-in; past days keep the late value they were saved with.
      </p>
      {state.ok ? <div className="notice" style={{ background: 'var(--present-tint)', color: 'var(--present)' }}>{state.ok}</div> : null}
      {state.err ? <div className="notice error">{state.err}</div> : null}
      <div><button className="btn" type="submit" disabled={state.busy}>{state.busy ? 'Saving…' : 'Save'}</button></div>
    </form>
  );
}

function lateFrom({ shift_start, grace_min }: S) {
  const [h, m] = shift_start.split(':').map(Number);
  const t = h * 60 + m + grace_min;
  const hh = Math.floor(t / 60) % 24, mm = t % 60;
  return `${((hh + 11) % 12) + 1}:${String(mm).padStart(2, '0')} ${hh < 12 ? 'AM' : 'PM'}`;
}
