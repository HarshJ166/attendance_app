import { useAuth0 } from '@auth0/auth0-react';
import { useState } from 'react';
import { API_URL, useLoad } from '../api';
import { CheckinPanel } from '../components/CheckinPanel';
import { CELL, thisMonth } from '../calendar';
import { MonthSwitch } from '../components/MonthSwitch';

type Day = { day: string; weekday: number; kind: string; rejected: boolean; late_min: number; attendance_id: number | null };
type Person = {
  user: { id: number; name: string; email: string | null; employee_code: string | null; designation: string | null };
  days: Day[];
  summary: { present: number; absent: number; flagged: number; late: number; percent: number | null };
};

export function Register() {
  const [month, setMonth] = useState(thisMonth());
  const { data, error, loading, reload } = useLoad<{ month: string; people: Person[] }>(`/admin/register?month=${month}`);
  const { getAccessTokenSilently } = useAuth0();
  const [open, setOpen] = useState<number | null>(null);
  const [dl, setDl] = useState<{ busy?: boolean; err?: string }>({});

  // The CSV needs the HR token, so fetch it and hand the browser a file (a plain link can't send the token).
  async function download() {
    setDl({ busy: true });
    try {
      const res = await fetch(`${API_URL}/admin/export.csv?month=${month}`, { headers: { authorization: `Bearer ${await getAccessTokenSilently()}` } });
      if (!res.ok) throw new Error('Export failed. Try again.');
      const url = URL.createObjectURL(await res.blob());
      const a = Object.assign(document.createElement('a'), { href: url, download: `geomark-attendance-${month}.csv` });
      a.click();
      URL.revokeObjectURL(url);
      setDl({});
    } catch (e) {
      setDl({ err: (e as Error).message });
    }
  }

  const days = data?.people[0]?.days ?? [];

  return (
    <div className="page" style={{ maxWidth: 'none' }}>
      <div className="toolbar" style={{ alignItems: 'center' }}>
        <div style={{ display: 'grid', gap: 4 }}>
          <h1>Register</h1>
          <span className="muted small">Everyone’s month at a glance. Click a marked day for the selfie and map.</span>
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <MonthSwitch month={month} onChange={setMonth} />
          <button className="btn" onClick={() => void download()} disabled={dl.busy || !data}>{dl.busy ? 'Preparing…' : 'Download CSV (Excel)'}</button>
        </div>
      </div>
      {dl.err ? <div className="notice error">{dl.err}</div> : null}
      {error ? <div className="notice error">{error.message}</div> : null}
      {loading ? <div className="card muted">Loading…</div> : null}
      {data ? (
        <div className="table-wrap">
          <table className="list register">
            <thead>
              <tr>
                <th className="sticky">Employee</th>
                {days.map((d) => (
                  <th key={d.day} className={`num ${d.weekday === 0 ? 'sun' : ''}`} title={d.day}>
                    {Number(d.day.slice(8))}<div className="small" style={{ fontWeight: 400 }}>{'SMTWTFS'[d.weekday]}</div>
                  </th>
                ))}
                <th className="num">Present</th><th className="num">Absent</th><th className="num">Late</th><th className="num">%</th>
              </tr>
            </thead>
            <tbody>
              {data.people.map((p) => (
                <tr key={p.user.id} style={{ cursor: 'default' }}>
                  <th className="sticky who" scope="row">
                    <a href={`#/employees/${p.user.id}`} style={{ color: 'inherit' }}><b>{p.user.name}</b></a>
                    <span>{p.user.employee_code ?? p.user.designation ?? ''}</span>
                  </th>
                  {p.days.map((d) => {
                    const look = CELL[d.rejected ? 'absent' : d.kind] ?? CELL.future;
                    const label = `${p.user.name}, ${d.day}: ${d.rejected ? 'Rejected by HR' : look.word}${d.late_min ? `, late ${d.late_min} min` : ''}`;
                    return (
                      <td key={d.day} className={`reg-cell ${look.cls}`}>
                        {d.attendance_id ? (
                          <button onClick={() => setOpen(d.attendance_id)} aria-label={label} title={label}>
                            {d.rejected ? '✗' : look.glyph}{d.late_min ? <span className="late-dot" aria-hidden="true" /> : null}
                          </button>
                        ) : (
                          <span title={label} aria-label={label}>{look.glyph === 'off' ? '–' : look.glyph}</span>
                        )}
                      </td>
                    );
                  })}
                  <td className="num">{p.summary.present}</td>
                  <td className="num">{p.summary.absent}</td>
                  <td className="num">{p.summary.late}</td>
                  <td className="num"><b>{p.summary.percent ?? '–'}{p.summary.percent != null ? '%' : ''}</b></td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.people.length === 0 ? <div className="empty">No employees in this month.</div> : null}
        </div>
      ) : null}
      <div className="key"><span>✓ present</span><span>! HR check</span><span>✗ absent or rejected</span><span><i style={{ background: 'var(--warn)', width: 8, height: 8 }} />late</span><span>– Sunday off</span></div>
      <span className="small muted">CSV opens in Excel with one row per person per day: status, check-in time (IST, 12-hour), late minutes, place, distance, address and HR notes.</span>
      {open != null ? <CheckinPanel id={open} onClose={() => setOpen(null)} onReviewed={reload} /> : null}
    </div>
  );
}
