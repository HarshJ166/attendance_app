import { useState } from 'react';
import { shortDate } from '../api';

type Day = { day: string; weekday: number; headcount: number; present: number; late: number };

/**
 * Attendance % per working day (one series → no legend; the title names it).
 * Thin bars with a 4px rounded top on the baseline, 2px gaps, recessive grid, hover/focus tooltip,
 * and a table view for screen readers (dataviz rules). Sundays are shown as gaps labelled "off".
 */
export function TrendChart({ days }: { days: Day[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 960, H = 220, top = 12, bottom = 28, left = 36;
  const plotH = H - top - bottom;
  const slot = (W - left) / days.length;
  const bar = Math.min(18, slot - 2);
  const pct = (d: Day) => (d.headcount ? Math.round((d.present / d.headcount) * 100) : 0);
  const y = (p: number) => top + plotH - (p / 100) * plotH;
  const working = days.filter((d) => d.weekday !== 0 && d.headcount > 0);
  const avg = working.length ? Math.round(working.reduce((s, d) => s + pct(d), 0) / working.length) : null;
  const h = hover != null ? days[hover] : null;

  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Attendance over the last ${days.length} days. Average ${avg ?? 0}% on working days.`}>
        {[0, 50, 100].map((g) => (
          <g key={g}>
            <line x1={left} x2={W} y1={y(g)} y2={y(g)} stroke="#d9e0dc" strokeWidth={1} strokeDasharray={g === 0 ? undefined : '2 4'} />
            <text x={left - 8} y={y(g) + 4} textAnchor="end" fontSize={12} fill="#52615a">{g}%</text>
          </g>
        ))}
        {days.map((d, i) => {
          const x = left + i * slot + (slot - bar) / 2;
          const off = d.weekday === 0;
          const p = pct(d);
          const barTop = y(p);
          const height = Math.max(0, top + plotH - barTop);
          return (
            <g
              key={d.day}
              tabIndex={0}
              role="img"
              aria-label={`${shortDate(d.day)}: ${off ? 'Sunday off' : `${d.present} of ${d.headcount} present, ${p}%, ${d.late} late`}`}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
            >
              <rect x={left + i * slot} y={top} width={slot} height={plotH} fill="transparent" />
              {off ? (
                <text x={x + bar / 2} y={top + plotH - 4} textAnchor="middle" fontSize={10} fill="#52615a">off</text>
              ) : height > 0 ? (
                <path
                  d={`M${x},${top + plotH} V${barTop + 4} Q${x},${barTop} ${x + 4},${barTop} H${x + bar - 4} Q${x + bar},${barTop} ${x + bar},${barTop + 4} V${top + plotH} Z`}
                  fill={hover === i ? '#08533a' : '#0b6b4b'}
                />
              ) : null}
              {i % Math.ceil(days.length / 10) === 0 || i === days.length - 1 ? (
                <text x={x + bar / 2} y={H - 8} textAnchor="middle" fontSize={12} fill="#52615a">{Number(d.day.slice(8))}</text>
              ) : null}
            </g>
          );
        })}
      </svg>
      {h && hover != null ? (
        <div className="tip" style={{ left: `${((left + hover * slot + slot / 2) / W) * 100}%`, top: `${(y(h.weekday === 0 ? 0 : pct(h)) / H) * 100}%` }}>
          <b>{shortDate(h.day)}</b>
          <br />
          {h.weekday === 0 ? 'Sunday · weekly off' : `${h.present} of ${h.headcount} present (${pct(h)}%) · ${h.late} late`}
        </div>
      ) : null}
      <details className="small" style={{ marginTop: 8 }}>
        <summary className="muted">Show as table</summary>
        <table className="list" style={{ marginTop: 8 }}>
          <thead><tr><th>Day</th><th>Present</th><th>Headcount</th><th>%</th><th>Late</th></tr></thead>
          <tbody>
            {days.map((d) => (
              <tr key={d.day} style={{ cursor: 'default' }}>
                <td>{shortDate(d.day)}</td>
                <td className="num">{d.weekday === 0 ? 'off' : d.present}</td>
                <td className="num">{d.headcount}</td>
                <td className="num">{d.weekday === 0 ? '' : `${pct(d)}%`}</td>
                <td className="num">{d.weekday === 0 ? '' : d.late}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
