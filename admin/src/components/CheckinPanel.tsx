import { useEffect, useRef, useState } from 'react';
import { distance, longDate, placeLabel, REASON, time, useApi, useLoad, type CheckinDetail } from '../api';
import { CheckinMap } from './CheckinMap';
import { Lightbox } from './Lightbox';
import { StatusChip } from './StatusChip';

const FLAG: Record<string, string> = { low_accuracy: 'Weak GPS signal', face_mismatch: 'Face didn’t match the profile photo' };

/** Side panel: selfie with geo-stamp, facts, map with all their places, blocked attempts, HR review. */
type Nav = { label: string; prev: (() => void) | null; next: (() => void) | null };

export function CheckinPanel({ id, onClose, onReviewed, nav }: { id: number; onClose: () => void; onReviewed: () => void; nav?: Nav }) {
  const { data, error, loading, reload } = useLoad<CheckinDetail>(`/admin/attendance/${id}`);
  const api = useApi();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [zoom, setZoom] = useState<{ src: string; alt: string; caption?: string } | null>(null);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    panel.current?.focus();
  }, [id]);
  useEffect(() => {
    const keys = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return document.querySelector('.lightbox') ? undefined : onClose();
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

            <h3 style={{ margin: '0 0 -12px' }}>Check-in selfie <span className="small muted" style={{ fontFamily: 'var(--body)', fontWeight: 400 }}>· taken {time(a.marked_at)}</span></h3>
            <figure className="stamp" style={{ margin: 0 }}>
              {a.photo_url ? (
                <button className="photo-btn" onClick={() => setZoom({ src: a.photo_url!, alt: `Attendance selfie of ${a.name}`, caption: `${a.name} · ${longDate(a.day)} · ${time(a.marked_at)}` })}
                  aria-label="Open the selfie full screen" title="Click to view full size">
                  <img src={a.photo_url} alt={`Attendance selfie of ${a.name}`} />
                  <span className="zoom-hint" aria-hidden="true">⤢ View full size</span>
                </button>
              ) : <div className="empty" style={{ color: '#fff' }}>Photo not available</div>}
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

            <FaceCompare profileUrl={data.profile_photo_url} score={a.face_score} threshold={data.face_threshold}
              onZoom={() => data.profile_photo_url && setZoom({ src: data.profile_photo_url, alt: `Profile photo of ${a.name}`, caption: `${a.name} · profile photo` })}
              onUseAsProfile={async () => {
                await api(`/admin/employees/${a.user_id}/photo`, { body: { attendance_id: a.id } });
                reload();
              }} />

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
      {zoom ? <Lightbox {...zoom} onClose={() => setZoom(null)} /> : null}
    </>
  );
}

/** Profile photo beside the score, so HR can judge the match by eye too. */
function FaceCompare({ profileUrl, score, threshold, onUseAsProfile, onZoom }: {
  profileUrl: string | null; score: number | null; threshold: number; onUseAsProfile: () => Promise<void>; onZoom: () => void;
}) {
  const [state, setState] = useState<{ busy?: boolean; err?: string; ok?: boolean }>({});
  const use = async () => {
    setState({ busy: true });
    try { await onUseAsProfile(); setState({ ok: true }); } catch (e) { setState({ err: (e as Error).message }); }
  };
  const matched = score !== null && score >= threshold;
  return (
    <section className="face-compare" aria-label="Face check against the profile photo">
      <div className="face-ref">
        {profileUrl ? (
          <button className="photo-btn" onClick={onZoom} aria-label="Open the profile photo full screen" title="Click to view full size">
            <img src={profileUrl} alt="Profile photo" />
          </button>
        ) : <div className="face-ref-empty">No profile photo</div>}
        <span className="small muted">Reference (profile)</span>
      </div>
      <div style={{ display: 'grid', gap: 6, alignContent: 'center' }}>
        {score === null ? (
          <span className="small muted">{profileUrl ? 'Not compared (face service was offline).' : 'Add a profile photo to turn on face matching for this person.'}</span>
        ) : (
          <>
            <span className={`chip ${matched ? 'present' : 'absent'}`}><span className="g" aria-hidden="true">{matched ? '✓' : '!'}</span>{matched ? 'Face matches' : 'Face doesn’t match'}</span>
            <span className="small muted num">Similarity {score.toFixed(2)} (match from {threshold.toFixed(2)})</span>
          </>
        )}
        <button className="btn secondary small" onClick={() => void use()} disabled={state.busy || state.ok} style={{ justifySelf: 'start' }}>
          {state.ok ? 'Profile photo updated' : state.busy ? 'Saving…' : 'Use this selfie as profile photo'}
        </button>
        {state.err ? <span className="small" style={{ color: 'var(--danger)' }}>{state.err}</span> : null}
      </div>
    </section>
  );
}
