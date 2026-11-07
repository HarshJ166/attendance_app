import { useState } from 'react';
import { distance, istToday, longDate, placeLabel, REASON, time, useLoad, type Status, type Today } from '../api';
import { CheckinPanel } from '../components/CheckinPanel';
import { StatusChip } from '../components/StatusChip';
import { TrendChart } from '../components/TrendChart';

const FILTERS: { key: 'all' | Status | 'late'; label: string }[] = [
  { key: 'all', label: 'Everyone' },
  { key: 'present', label: 'Present' },
  { key: 'late', label: 'Late' },
  { key: 'flagged', label: 'HR check' },
  { key: 'not_yet', label: 'Not yet' },
  { key: 'absent', label: 'Absent' },
];

export function Dashboard({ onReviewed }: { onReviewed: () => void }) {
  const [date, setDate] = useState(istToday());
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['key']>('all');
  const [open, setOpen] = useState<number | null>(null);
  const today = useLoad<Today>(`/admin/today?date=${date}`);
  const trend = useLoad<{ days: { day: string; weekday: number; headcount: number; present: number; late: number }[] }>('/admin/trend?days=30');
  const t = today.data;

  const rows = (t?.people ?? []).filter((p) => {
    if (filter === 'all') return true;
    if (filter === 'late') return !!p.attendance && p.attendance.late_min > 0 && p.status !== 'rejected';
    if (filter === 'present') return p.status === 'present' || p.status === 'flagged';
    return p.status === filter;
  });
  const isToday = date === istToday();

  return (
    <div className="page">
      <div className="toolbar">
        <div style={{ display: 'grid', gap: 4 }}>
          <h1>{isToday ? 'Today' : longDate(date)}</h1>
          {t ? <div className="muted small">Shift starts {t.settings.shift_start}, late after {t.settings.grace_min} min grace</div> : null}
        </div>
        <label className="field">
          Date
          <input className="input" type="date" value={date} max={istToday()} onChange={(e) => e.target.value && setDate(e.target.value)} />
        </label>
      </div>

      {today.error ? <div className="notice error">{today.error.message}</div> : null}

      {t ? (
        <div className="card summary" aria-live="polite">
          {t.summary.expected === 0 && t.summary.off > 0 ? (
            <>Sunday: weekly off.</>
          ) : (
            <>
              <b>{t.summary.present}</b> of <b>{t.summary.expected}</b> present
              {' · '}<b>{t.summary.late}</b> late
              {' · '}<b>{t.summary.flagged}</b> for HR check
              {' · '}<b>{isToday ? t.summary.not_yet : t.summary.absent}</b> {isToday ? 'not marked yet' : 'absent'}
              {t.summary.blocked_attempts ? <> · <b>{t.summary.blocked_attempts}</b> blocked {t.summary.blocked_attempts === 1 ? 'attempt' : 'attempts'}</> : null}
            </>
          )}
        </div>
      ) : today.loading ? <div className="card muted">Loading…</div> : null}

      <section className="card" style={{ display: 'grid', gap: 12 }}>
        <h2>Attendance, last 30 days</h2>
        {trend.data ? <TrendChart days={trend.data.days} /> : trend.error ? <div className="notice error">{trend.error.message}</div> : <div className="muted">Loading…</div>}
      </section>

      <section style={{ display: 'grid', gap: 12 }}>
        <div className="toolbar">
          <h2>Check-ins</h2>
          <div className="filters" role="group" aria-label="Filter by status">
            {FILTERS.map((f) => (
              <button key={f.key} className="filter" aria-pressed={filter === f.key} onClick={() => setFilter(f.key)}>{f.label}</button>
            ))}
          </div>
        </div>

        <div className="table-wrap">
          <table className="list">
            <thead>
              <tr>
                <th><span className="visually-hidden">Photo</span></th>
                <th>Name</th>
                <th>Check-in</th>
                <th>Status</th>
                <th>Place</th>
                <th>Distance</th>
                <th><span className="visually-hidden">Details</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const a = p.attendance;
                return (
                  <tr key={p.user.id} aria-selected={open != null && open === a?.id} onClick={() => a && setOpen(a.id)} style={a ? undefined : { cursor: 'default' }}>
                    <td>{a ? <img className="thumb" src={a.thumb_url} alt="" loading="lazy" /> : <div className="thumb" />}</td>
                    <td className="who">
                      <b>{p.user.name || p.user.email}</b>
                      <span>{[p.user.employee_code, p.user.designation].filter(Boolean).join(' · ') || p.user.email}</span>
                    </td>
                    <td className="num">
                      {a ? time(a.marked_at) : '–'}
                      {a && a.late_min > 0 && p.status !== 'rejected' ? <div><span className="chip late small">Late {a.late_min}m</span></div> : null}
                    </td>
                    <td><StatusChip status={p.status} /></td>
                    <td>{a ? placeLabel(a.site_name, a.site_kind) : '–'}</td>
                    <td className="num">{a ? (a.site_kind === 'home' ? 'at home' : distance(a.distance_m)) : '–'}</td>
                    <td>{a ? <button className="btn secondary small" onClick={(e) => { e.stopPropagation(); setOpen(a.id); }}>View</button> : null}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {t && rows.length === 0 ? (
            <div className="empty">{filter === 'all' ? 'No employees yet.' : isToday && filter !== 'absent' ? 'Nobody here yet today.' : 'Nobody in this group.'}</div>
          ) : null}
        </div>
      </section>

      {t && t.attempts.length ? (
        <section style={{ display: 'grid', gap: 12 }}>
          <h2>Blocked attempts</h2>
          <p className="muted small" style={{ margin: 0 }}>The app refused these check-ins. No photo was kept.</p>
          <div className="table-wrap">
            <table className="list">
              <thead><tr><th>Time</th><th>Name</th><th>Reason</th><th>Nearest place</th><th>Distance</th><th><span className="visually-hidden">Map</span></th></tr></thead>
              <tbody>
                {t.attempts.map((x) => (
                  <tr key={x.id} style={{ cursor: 'default' }}>
                    <td className="num">{time(x.at)}</td>
                    <td>{x.name}</td>
                    <td><span className="chip blocked"><span className="g" aria-hidden="true">✗</span>{REASON[x.reason] ?? x.reason}</span></td>
                    <td>{x.site_name ? placeLabel(x.site_name, x.site_kind) : '–'}</td>
                    <td className="num">{distance(x.distance_m)}</td>
                    <td><a className="small" href={`https://www.google.com/maps/search/?api=1&query=${x.lat},${x.lng}`} target="_blank" rel="noreferrer">Map ↗</a></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {open != null ? (
        <CheckinPanel id={open} onClose={() => setOpen(null)} onReviewed={() => { today.reload(); onReviewed(); }} />
      ) : null}
    </div>
  );
}
