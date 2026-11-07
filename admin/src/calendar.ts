// Month helpers and day-cell looks shared by the profile calendar and the register.
const IST_MONTH = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit' }).format(new Date()).slice(0, 7);
export const thisMonth = IST_MONTH;
export const shiftMonth = (month: string, by: number) => {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};
export const monthName = (month: string) => new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en-IN', { timeZone: 'UTC', month: 'long', year: 'numeric' });


export const CELL: Record<string, { glyph: string; word: string; cls: string }> = {
  present: { glyph: '✓', word: 'Present', cls: 'present' },
  flagged: { glyph: '!', word: 'HR check', cls: 'flagged' },
  absent: { glyph: '✗', word: 'Absent', cls: 'absent' },
  off: { glyph: 'off', word: 'Sunday off', cls: 'off' },
  today: { glyph: '·', word: 'Not marked yet', cls: 'not_yet' },
  future: { glyph: '', word: '', cls: 'future' },
  before_joining: { glyph: '', word: 'Before joining', cls: 'future' },
};
