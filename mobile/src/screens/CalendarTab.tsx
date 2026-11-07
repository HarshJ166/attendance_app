import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import { api, placeLabel, type Attendance, type CalendarDay, type DayKind } from '../api';
import { GeoStamp } from '../GeoStamp';
import { clock, MonthHeader, thisMonth, useMonth } from '../month';
import { Screen, T } from '../ui';
import { color, font, space } from '../theme';

const dayName = (day: string) => new Date(`${day}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });

// Every mark has a word and a glyph, never colour alone (DESIGN.md).
export const LOOK: Record<DayKind, { bg: string; fg: string; glyph: string; word: string }> = {
  present: { bg: color.presentTint, fg: color.present, glyph: '✓', word: 'Present' },
  flagged: { bg: color.warnTint, fg: color.warn, glyph: '!', word: 'Present, HR will check' },
  absent: { bg: color.dangerTint, fg: color.danger, glyph: '✗', word: 'Absent' },
  off: { bg: 'transparent', fg: color.muted, glyph: 'off', word: 'Sunday, weekly off' },
  today: { bg: color.surface, fg: color.ink, glyph: '', word: 'Not marked yet today' },
  future: { bg: 'transparent', fg: color.line, glyph: '', word: '' },
  before_joining: { bg: 'transparent', fg: color.line, glyph: '', word: 'Before you joined' },
};

export function CalendarTab({ getToken }: { getToken: () => Promise<string> }) {
  const [month, setMonth] = useState(thisMonth());
  const { data, error, loading } = useMonth(month, getToken);
  const [selected, setSelected] = useState<CalendarDay | null>(null);
  const [detail, setDetail] = useState<{ day: string; a: Attendance | null } | 'loading' | null>(null);

  async function pick(d: CalendarDay) {
    setSelected(d);
    if (d.kind !== 'present' && d.kind !== 'flagged') return setDetail(null);
    setDetail('loading');
    try {
      const r = await api<{ attendance: Attendance | null }>(await getToken(), `/attendance/day/${d.day}`);
      setDetail({ day: d.day, a: r.attendance });
    } catch {
      setDetail(null);
    }
  }

  const sel = selected && selected.day.startsWith(month) ? selected : null; // forget the pick when the month changes
  const lead = data ? (data.days[0].weekday + 6) % 7 : 0; // weeks start on Monday

  return (
    <Screen tabbed>
      <ScrollView contentContainerStyle={{ gap: space.lg, paddingBottom: space.xl }} showsVerticalScrollIndicator={false}>
        <T kind="title">Calendar</T>
        <MonthHeader month={month} onChange={setMonth} />
        {error ? <T style={{ color: color.danger }}>{error}</T> : null}
        {loading ? <ActivityIndicator color={color.present} style={{ marginVertical: space.xxl }} /> : null}

        {data ? (
          <>
            <View>
              <View style={{ flexDirection: 'row' }}>
                {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((w, i) => (
                  <T key={i} kind="small" style={{ flex: 1, textAlign: 'center', fontFamily: font.bodyBold }}>{w}</T>
                ))}
              </View>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                {Array.from({ length: lead }, (_, i) => <View key={`b${i}`} style={{ width: `${100 / 7}%` }} />)}
                {data.days.map((d) => {
                  const look = LOOK[d.kind];
                  const isSel = sel?.day === d.day;
                  const faded = d.kind === 'future' || d.kind === 'before_joining';
                  return (
                    <View key={d.day} style={{ width: `${100 / 7}%`, padding: 2 }}>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`${dayName(d.day)}. ${look.word}${d.marked_at ? ` at ${clock(d.marked_at)}` : ''}`}
                        accessibilityState={{ selected: isSel, disabled: d.kind === 'future' }}
                        disabled={d.kind === 'future'}
                        onPress={() => void pick(d)}
                        style={{
                          aspectRatio: 1, borderRadius: 10, alignItems: 'center', justifyContent: 'center',
                          backgroundColor: look.bg,
                          borderWidth: isSel ? 2 : d.kind === 'today' ? 1.5 : 0,
                          borderColor: isSel ? color.ink : color.present,
                        }}
                      >
                        <T style={{ color: faded ? color.line : color.ink, fontSize: 16, lineHeight: 20, fontVariant: ['tabular-nums'] }}>{Number(d.day.slice(8))}</T>
                        <T style={{ color: look.fg, fontFamily: font.bodyBold, fontSize: look.glyph.length > 1 ? 11 : 14, lineHeight: 16 }}>{look.glyph}</T>
                      </Pressable>
                    </View>
                  );
                })}
              </View>
            </View>

            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.md }}>
              {(['present', 'flagged', 'absent'] as const).map((k) => (
                <View key={k} style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
                  <View style={{ backgroundColor: LOOK[k].bg, borderRadius: 6, width: 22, height: 22, alignItems: 'center', justifyContent: 'center' }}>
                    <T style={{ color: LOOK[k].fg, fontFamily: font.bodyBold, fontSize: 13, lineHeight: 16 }}>{LOOK[k].glyph}</T>
                  </View>
                  <T kind="small">{k === 'flagged' ? 'HR check' : LOOK[k].word}</T>
                </View>
              ))}
              <T kind="small">off = Sunday</T>
            </View>

            {sel ? (
              <View style={{ gap: space.md, borderTopWidth: 1, borderTopColor: color.line, paddingTop: space.lg }}>
                <T style={{ fontFamily: font.display, fontSize: 22, lineHeight: 28 }}>{dayName(sel.day)}</T>
                <T style={{ color: LOOK[sel.kind].fg === color.line ? color.muted : LOOK[sel.kind].fg, fontFamily: font.bodyBold }}>
                  {LOOK[sel.kind].word}
                  {sel.marked_at ? ` · ${clock(sel.marked_at)}` : ''}
                  {sel.site_name ? ` · ${placeLabel(sel.site_name, sel.site_kind)}` : ''}
                </T>
                {sel.late_min ? <T style={{ color: color.warn, fontFamily: font.bodyBold }}>Late by {sel.late_min} min</T> : null}
                {detail === 'loading' ? <ActivityIndicator color={color.present} /> : detail && detail.day === sel.day && detail.a ? <GeoStamp a={detail.a} compact /> : null}
              </View>
            ) : (
              <T kind="small">Tap a day to see the time, place, map and selfie.</T>
            )}
          </>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
