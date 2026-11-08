import { useEffect, useState } from 'react';
import { distance, istToday, longDate, placeLabel, REASON, time, useApi, useLoad, type Today } from '../api';
import { CheckinPanel } from '../components/CheckinPanel';
import { Icon } from '../components/Icon';
import { StatusChip } from '../components/StatusChip';
import { TrendChart } from '../components/TrendChart';

type Filter = 'all' | 'present' | 'late' | 'flagged' | 'not_yet' | 'absent' | 'off_or_holiday';
const REFRESH_MS = 60_000;

export function Dashboard({ onReviewed }: { onReviewed: () => void }) {
  const api = useApi();
  const [date, setDate] = useState(istToday());
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<number | null>(null);
  const [busyRow, setBusyRow] = useState<number | null>(null);
  const [refreshedAt, setRefreshedAt] = useState(() => Date.now());
  const today = useLoad<Today>(`/admin/today?date=${date}`);
  const trend = useLoad<{ days: { day: string; weekday: number; headcount: number; present: number; late: number; holiday: string | null }[] }>('/admin/trend?days=30');
  const t = today.data;
  const isToday = date === istToday();

  // Auto-refresh today's board every minute while the tab is visible and no panel is open.
  const { reload } = today;
  useEffect(() => {
    if (!isToday || open != null) return;
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        reload();
        setRefreshedAt(Date.now());
      }
    }, REFRESH_MS);
    return () => window.clearInterval(id);
  }, [isToday, open, reload]);

  const needle = q.trim().toLowerCase();
  const rows = (t?.people ?? []).filter((p) => {
    const a = p.attendance;
    const match =
      filter === 'all' ? true
      : filter === 'late' ? !!a && a.late_min > 0 && p.status !== 'rejected'
      : filter === 'present' ? p.status === 'present' || p.status === 'flagged'
      : filter === 'off_or_holiday' ? p.status === 'off' || p.status === 'holiday'
      : p.status === filter;
    return match && (!needle || [p.user.name, p.user.email, p.user.employee_code, p.user.designation].some((v) => v?.toLowerCase().includes(needle)));
  });
  const ids = rows.flatMap((p) => (p.attendance ? [p.attendance.id] : []));
  const pos = open != null ? ids.indexOf(open) : -1;

  async function quickApprove(id: number) {
    setBusyRow(id);
    try {
      await api(`/admin/attendance/${id}`, { method: 'PATCH', body: { decision: 'approve', note: 'Approved from the dashboard' } });
      today.reload();
      onReviewed();
    } finally {
      setBusyRow(null);
    }
  }

  const s = t?.summary;
  const notYetKey: Filter = isToday ? 'not_yet' : 'absent';
  const tiles: { key: Filter; label: string; value: number; glyph: string; tone: string; hint?: string }[] = s
    ? [
        { key: 'present', label: 'Present', value: s.present, glyph: '✓', tone: 'present', hint: `of ${s.expected}` },
        { key: 'late', label: 'Late', value: s.late, glyph: '!', tone: 'late' },
        { key: 'flagged', label: 'HR check', value: s.flagged, glyph: '!', tone: 'flagged' },
        { key: notYetKey, label: isToday ? 'Not marked yet' : 'Absent', value: isToday ? s.not_yet : s.absent, glyph: isToday ? '·' : '✗', tone: isToday ? 'not_yet' : 'absent' },
      ]
    : [];

  return (
    <div className="page">
      <div className="toolbar">
        <div style={{ display: 'grid', gap: 4 }}>
          <h1>{isToday ? 'Today' : longDate(date)}</h1>
          {t ? (
            <div className="muted small">
              Shift {t.settings.shift_start}, late after {t.settings.grace_min} min
              {isToday ? <> · Updated {new Date(refreshedAt).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}, refreshes every minute</> : null}
            </div>
          ) : null}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'end' }}>
          <label className="field">
            Date
            <input className="input" type="date" value={date} max={istToday()} onChange={(e) => { if (e.target.value) { setDate(e.target.value); setFilter('all'); } }} />
          </label>
          <button className="btn secondary" onClick={() => { today.reload(); trend.reload(); setRefreshedAt(Date.now()); }} aria-label="Refresh now" title="Refresh now">
            <Icon name="refresh" size={18} />
          </button>
        </div>
      </div>

      {today.error ? <div className="notice error">{today.error.message}</div> : null}
      {!t && today.loading ? <div className="card muted">Loading…</div> : null}

      {t && t.holiday ? (
        <div className="notice" style={{ background: 'var(--muted-tint)' }}>★ <b>Holiday: {t.holiday}.</b> Nobody is marked absent{s?.present ? `; ${s.present} checked in anyway` : ''}.</div>
      ) : t && s && s.expected === 0 && s.off > 0 ? (
        <div className="notice" style={{ background: 'var(--muted-tint)' }}>Sunday: weekly off.{s.present ? ` ${s.present} checked in anyway.` : ''}</div>
      ) : null}

      {s ? (
        <div className="tiles" role="group" aria-label="Today at a glance. Click a tile to filter the list.">
          {tiles.map((tile) => (
            <button key={tile.key} className={`tile ${tile.tone}`} aria-pressed={filter === tile.key} onClick={() => setFilter(filter === tile.key ? 'all' : tile.key)}>
              <span className="tile-label"><span className={`chip ${tile.tone}`}><span className="g" aria-hidden="true">{tile.glyph}</span>{tile.label}</span></span>
              <span className="tile-value num">{tile.value}{tile.hint ? <small> {tile.hint}</small> : null}</span>
            </button>
          ))}
          <a className={`tile blocked ${t!.attempts.length ? '' : 'quiet'}`} href="#blocked" onClick={(e) => { e.preventDefault(); document.getElementById('blocked')?.scrollIntoView({ behavior: 'smooth' }); }}>
            <span className="tile-label"><span className="chip blocked"><span className="g" aria-hidden="true">✗</span>Blocked attempts</span></span>
            <span className="tile-value num">{s.blocked_attempts}</span>
          </a>
        </div>
      ) : null}

      <section style={{ display: 'grid', gap: 12 }}>
        <div className="toolbar" style={{ alignItems: 'center' }}>
          <h2>Check-ins{filter !== 'all' ? <span className="muted small" style={{ fontFamily: 'var(--body)', fontWeight: 400 }}> · filtered <button className="link-btn" onClick={() => setFilter('all')}>show everyone</button></span> : null}</h2>
          <label className="search">
            <Icon name="search" size={18} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, code, designation" aria-label="Search check-ins" />
          </label>
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
                <th><span className="visually-hidden">Actions</span></th>
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
                    <td>
                      {a ? (
                        <div className="row-actions">
                          {p.status === 'flagged' ? (
                            <button className="btn small" disabled={busyRow === a.id} onClick={(e) => { e.stopPropagation(); void quickApprove(a.id); }}
                              title="Counts the day as present. To reject, open the check-in (a reason is needed).">
                              {busyRow === a.id ? 'Saving…' : 'Approve'}
                            </button>
                          ) : null}
                          <button className="btn secondary small" onClick={(e) => { e.stopPropagation(); setOpen(a.id); }}>View</button>
                        </div>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {t && rows.length === 0 ? (
            <div className="empty">{needle ? `Nobody matches “${q.trim()}”.` : filter === 'all' ? 'No employees yet.' : isToday && filter !== 'absent' ? 'Nobody here yet today.' : 'Nobody in this group.'}</div>
          ) : null}
        </div>
      </section>

      {t && t.attempts.length ? (
        <section id="blocked" style={{ display: 'grid', gap: 12, scrollMarginTop: 24 }}>
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

      <details className="card trend-card">
        <summary><h2 style={{ display: 'inline' }}>Attendance trend, last 30 days</h2></summary>
        <div style={{ marginTop: 12 }}>
          {trend.data ? <TrendChart days={trend.data.days} /> : trend.error ? <div className="notice error">{trend.error.message}</div> : <div className="muted">Loading…</div>}
        </div>
      </details>

      {open != null ? (
        <CheckinPanel
          id={open}
          onClose={() => setOpen(null)}
          onReviewed={() => { today.reload(); onReviewed(); }}
          nav={{
            label: pos >= 0 ? `${pos + 1} of ${ids.length}` : '',
            prev: pos > 0 ? () => setOpen(ids[pos - 1]) : null,
            next: pos >= 0 && pos < ids.length - 1 ? () => setOpen(ids[pos + 1]) : null,
          }}
        />
      ) : null}
    </div>
  );
}
