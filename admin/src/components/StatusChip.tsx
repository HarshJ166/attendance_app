// Every status = glyph + word on a tint, never colour alone (DESIGN.md).
const LOOK: Record<string, { glyph: string; word: string }> = {
  present: { glyph: '✓', word: 'Present' },
  flagged: { glyph: '!', word: 'HR check' },
  rejected: { glyph: '✗', word: 'Rejected' },
  absent: { glyph: '✗', word: 'Absent' },
  not_yet: { glyph: '·', word: 'Not yet' },
  off: { glyph: '–', word: 'Off' },
};

export function StatusChip({ status }: { status: string }) {
  const l = LOOK[status] ?? { glyph: '', word: status };
  return (
    <span className={`chip ${status}`}>
      <span className="g" aria-hidden="true">{l.glyph}</span>
      {l.word}
    </span>
  );
}
