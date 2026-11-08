import { useState } from 'react';
import { distance, placeLabel, shortDate, time, useLoad } from '../api';
import { CheckinPanel } from '../components/CheckinPanel';

type Item = {
  id: number; day: string; marked_at: string; flags: string[]; late_min: number; accuracy_m: number;
  site_name: string | null; site_kind: string | null; distance_m: number | null; name: string; employee_code: string | null; thumb_url: string;
};
const FLAG: Record<string, string> = { low_accuracy: 'Weak GPS signal' };

export function Review({ onReviewed }: { onReviewed: () => void }) {
  const { data, error, loading, reload } = useLoad<{ items: Item[] }>('/admin/review');
  const [open, setOpen] = useState<number | null>(null);

  return (
    <div className="page">
      <div style={{ display: 'grid', gap: 4 }}>
        <h1>Review</h1>
        <p className="muted" style={{ margin: 0 }}>Check-ins the system marked for a human look, oldest first. Open one to see the selfie and map, then approve or reject.</p>
      </div>
      {error ? <div className="notice error">{error.message}</div> : null}
      {loading ? <div className="card muted">Loading…</div> : null}
      {data && data.items.length === 0 ? <div className="card empty">Nothing to review. Every check-in from the last 60 days is settled.</div> : null}
      {data && data.items.length ? (
        <div className="table-wrap">
          <table className="list">
            <thead><tr><th><span className="visually-hidden">Photo</span></th><th>Name</th><th>Day</th><th>Why</th><th>Place</th><th><span className="visually-hidden">Open</span></th></tr></thead>
            <tbody>
              {data.items.map((x) => (
                <tr key={x.id} aria-selected={open === x.id} onClick={() => setOpen(x.id)}>
                  <td><img className="thumb" src={x.thumb_url} alt="" loading="lazy" /></td>
                  <td className="who"><b>{x.name}</b><span>{x.employee_code ?? ''}</span></td>
                  <td className="num">{shortDate(x.day)}<div className="muted small">{time(x.marked_at)}</div></td>
                  <td>{x.flags.map((f) => FLAG[f] ?? f).join(', ')} <span className="muted small">(±{Math.round(x.accuracy_m)} m)</span></td>
                  <td>{placeLabel(x.site_name, x.site_kind)}<div className="muted small num">{x.site_kind === 'home' ? '' : distance(x.distance_m)}</div></td>
                  <td><button className="btn secondary small" onClick={(e) => { e.stopPropagation(); setOpen(x.id); }}>Review</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {open != null ? (() => {
        const ids = data?.items.map((x) => x.id) ?? [];
        const pos = ids.indexOf(open);
        return (
          <CheckinPanel id={open} onClose={() => setOpen(null)} onReviewed={() => { reload(); onReviewed(); }}
            nav={{ label: pos >= 0 ? `${pos + 1} of ${ids.length}` : 'Reviewed', prev: pos > 0 ? () => setOpen(ids[pos - 1]) : null, next: pos >= 0 && pos < ids.length - 1 ? () => setOpen(ids[pos + 1]) : null }} />
        );
      })() : null}
    </div>
  );
}
