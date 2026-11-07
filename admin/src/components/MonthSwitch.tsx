import { monthName, thisMonth, shiftMonth } from '../calendar';

export function MonthSwitch({ month, onChange }: { month: string; onChange: (m: string) => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }} role="group" aria-label="Month">
      <button className="btn secondary small" onClick={() => onChange(shiftMonth(month, -1))} aria-label="Previous month">‹</button>
      <b style={{ minWidth: 150, textAlign: 'center', fontFamily: 'var(--display)', fontSize: 18 }}>{monthName(month)}</b>
      <button className="btn secondary small" onClick={() => onChange(shiftMonth(month, 1))} disabled={month >= thisMonth()} aria-label="Next month">›</button>
    </div>
  );
}
