import { useEffect, useRef, useState } from 'react';
import { distance, longDate, placeLabel, REASON, time, useApi, useLoad, type CheckinDetail } from '../api';
import { CheckinMap } from './CheckinMap';
import { StatusChip } from './StatusChip';

const FLAG: Record<string, string> = { low_accuracy: 'Weak GPS signal' };

/** Side panel: selfie with geo-stamp, facts, map with all their places, blocked attempts, HR review. */
type Nav = { label: string; prev: (() => void) | null; next: (() => void) | null };

export function CheckinPanel({ id, onClose, onReviewed, nav }: { id: number; onClose: () => void; onReviewed: () => void; nav?: Nav }) {
  const { data, error, loading, reload } = useLoad<CheckinDetail>(`/admin/attendance/${id}`);
  const api = useApi();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    panel.current?.focus();
  }, [id]);
  useEffect(() => {
    const keys = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return onClose();
      const typing = e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement;
      if (typing) return; // arrows move the caret while writing a note
      if (e.key === 'ArrowLeft' && nav?.prev) { e.preventDefault(); nav.prev(); }
      if (e.key === 'ArrowRight' && nav?.next) { e.preventDefault(); nav.next(); }
    };
    window.addEventListener('keydown', keys);
    return () => window.removeEventListener('keydown', keys);
  }, [onClose, nav]);

  async function decide(decision: 'approve' | 'reject') {
    setBusy(decision);
    setReviewError(null);
    try {
      await api(`/admin/attendance/${id}`, { method: 'PATCH', body: { decision, note: note.trim() || null } });
      setNote('');
      reload();
      onReviewed();
    } catch (e) {
      setReviewError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const a = data?.attendance;

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="panel" role="dialog" aria-modal="true" aria-label="Check-in details" tabIndex={-1} ref={panel}>
        <div className="panel-head">
          <div>
            <h2>{a?.name ?? 'Check-in'}</h2>
            {a ? <div className="muted small">{[a.employee_code, a.email].filter(Boolean).join(' · ')}</div> : null}
          </div>
          <button className="btn secondary small" onClick={onClose} aria-label="Close details">Close</button>
        </div>
        {nav ? (
          <div className="panel-nav">
            <button className="btn secondary small" onClick={() => nav.prev?.()} disabled={!nav.prev} aria-label="Previous check-in">‹ Previous</button>
            <span className="small muted num">{nav.label}<span className="hide-narrow"> · use ← → keys</span></span>
            <button className="btn secondary small" onClick={() => nav.next?.()} disabled={!nav.next} aria-label="Next check-in">Next ›</button>
          </div>
        ) : null}

        {loading ? <div className="muted">Loading…</div> : null}
        {error ? <div className="notice error">{error.message}</div> : null}

        {a && data ? (
          <>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <StatusChip status={a.status} />
              {a.late_min > 0 && a.status !== 'rejected' ? <span className="chip late"><span className="g">!</span>Late {a.late_min} min</span> : null}
            </div>

            <figure className="stamp" style={{ margin: 0 }}>
              {a.photo_url ? <img src={a.photo_url} alt={`Attendance selfie of ${a.name}`} /> : <div className="empty" style={{ color: '#fff' }}>Photo not available</div>}
              <figcaption className="stamp-text">
                <div className={`place ${a.status === 'present' ? 'ok' : 'bad'}`}>
                  {a.status === 'present' ? '✓ ' : '! '}
                  {a.site_kind === 'home' ? 'At Home (WFH)' : `${distance(a.distance_m)} from ${placeLabel(a.site_name, a.site_kind)}`}
                </div>
                <div>{longDate(a.day)} · {time(a.marked_at)}</div>
                {a.address ? <div>{a.address}</div> : null}
                <div className="mono">{a.lat.toFixed(5)}, {a.lng.toFixed(5)} · GPS ±{Math.round(a.accuracy_m)} m</div>
              </figcaption>
            </figure>

            <dl className="facts">
              <dt>Checked in</dt><dd className="num">{time(a.marked_at)}{a.late_min > 0 ? ` (late by ${a.late_min} min)` : ''}</dd>
              <dt>Matched place</dt><dd>{placeLabel(a.site_name, a.site_kind)}</dd>
              <dt>Distance</dt><dd className="num">{distance(a.distance_m)} from its centre</dd>
              <dt>GPS accuracy</dt><dd className="num">±{Math.round(a.accuracy_m)} m</dd>
              {a.flags.length ? <><dt>Needs a check</dt><dd>{a.flags.map((f) => FLAG[f] ?? f).join(', ')}</dd></> : null}
              {a.reviewed_at ? <><dt>HR decision</dt><dd>{a.status === 'rejected' ? 'Rejected' : 'Approved'}{a.reviewed_by_name ? ` by ${a.reviewed_by_name}` : ''}{a.review_note ? `: “${a.review_note}”` : ''}</dd></> : null}
            </dl>

            <section style={{ display: 'grid', gap: 8 }} aria-label="Map">
              <h3>Where they were</h3>
              <CheckinMap person={{ lat: a.lat, lng: a.lng, accuracy_m: a.accuracy_m }} places={data.places} matchedName={a.site_name} attempts={data.attempts} />
              <a className="small" href={`https://www.google.com/maps/search/?api=1&query=${a.lat},${a.lng}`} target="_blank" rel="noreferrer">Open in Google Maps ↗</a>
            </section>

            {data.attempts.length ? (
              <section style={{ display: 'grid', gap: 8 }}>
                <h3>Blocked attempts that day</h3>
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {data.attempts.map((t) => (
                    <li key={t.at} className="small">
                      <span className="num">{time(t.at)}</span>: {REASON[t.reason] ?? t.reason}
                      {t.distance_m != null ? `, ${distance(t.distance_m)} from ${t.site_name ?? 'nearest place'}` : ''}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            <section className="card" style={{ display: 'grid', gap: 12, padding: 16 }} aria-label="HR review">
              <h3>HR decision</h3>
              <p className="small muted" style={{ margin: 0 }}>
                Approve counts the day as present. Reject counts it as absent and needs a reason. The person sees the result in their calendar.
              </p>
              <label className="field">
                Note {a.status !== 'rejected' ? '(required to reject)' : ''}
                <textarea className="input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="e.g. Confirmed with manager, client visit" />
              </label>
              {reviewError ? <div className="notice error">{reviewError}</div> : null}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button className="btn" disabled={!!busy || a.status === 'present'} onClick={() => void decide('approve')}>
                  {busy === 'approve' ? 'Saving…' : a.status === 'present' ? 'Approved' : 'Approve'}
                </button>
                <button className="btn danger" disabled={!!busy || a.status === 'rejected' || !note.trim()} onClick={() => void decide('reject')}>
                  {busy === 'reject' ? 'Saving…' : a.status === 'rejected' ? 'Rejected' : 'Reject'}
                </button>
              </div>
            </section>
          </>
        ) : null}
      </aside>
    </>
  );
}
