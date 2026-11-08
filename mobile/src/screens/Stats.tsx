import { useState } from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';
import type { CalendarDay } from '../api';
import { MonthHeader, thisMonth, useMonth } from '../month';
import { Screen, T } from '../ui';
import { color, font, space } from '../theme';

const minutesOfDay = (iso: string) => {
  const d = new Date(iso);
  return d.getHours() * 60 + d.getMinutes();
};
const asClock = (min: number) => {
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};

/** Consecutive present working days, counting back from the latest finished-or-marked day. Sundays don't break it. */
function streak(days: CalendarDay[]): number {
  let n = 0;
  for (let i = days.length - 1; i >= 0; i--) {
    const k = days[i].kind;
    if (k === 'future' || k === 'today' || k === 'off') continue;
    if (k === 'present' || k === 'flagged') n++;
    else break;
  }
  return n;
}

export function Stats({ getToken }: { getToken: () => Promise<string> }) {
  const [month, setMonth] = useState(thisMonth());
  const { data, error, loading } = useMonth(month, getToken);

  let content = null;
  if (data) {
    const present = data.summary.present + data.summary.flagged; // flagged days were still attended
    const worked = present + data.summary.absent;
    const pct = worked ? Math.round((present / worked) * 100) : null;
    const times = data.days.filter((d) => d.marked_at).map((d) => minutesOfDay(d.marked_at!));
    const avg = times.length ? times.reduce((x, y) => x + y, 0) / times.length : null;
    const rows: [string, string][] = [
      ['Days present', String(present)],
      ['Days absent', String(data.summary.absent)],
      ['Marked for HR to check', String(data.summary.flagged)],
      ['Late check-ins', String(data.summary.late)],
      ['Usual check-in time', avg != null ? asClock(avg) : '–'],
      ['Earliest check-in', times.length ? asClock(Math.min(...times)) : '–'],
      ['Latest check-in', times.length ? asClock(Math.max(...times)) : '–'],
      ['Current streak', `${streak(data.days)} working ${streak(data.days) === 1 ? 'day' : 'days'}`],
    ];

    content = (
      <>
        {/* Hero figure: body sans, tabular, ≥48px (dataviz: hero number) */}
        <View style={{ gap: space.xs }}>
          <T kind="small">Attendance this month</T>
          <T style={{ fontFamily: font.bodyBold, fontSize: 56, lineHeight: 62, color: color.ink, fontVariant: ['tabular-nums'] }}>
            {pct != null ? `${pct}%` : '–'}
          </T>
          <T kind="small">{worked ? `${present} of ${worked} working days so far` : 'No working days yet this month'}</T>
        </View>

        {/* One series, one meter: present share of working days. Thin, fully rounded, on a neutral track. */}
        {pct != null ? (
          <View
            accessible
            accessibilityRole="progressbar"
            accessibilityValue={{ min: 0, max: 100, now: pct }}
            accessibilityLabel={`Attendance ${pct} percent`}
            style={{ height: 8, borderRadius: 4, backgroundColor: color.mutedTint, overflow: 'hidden' }}
          >
            <View style={{ width: `${pct}%`, height: 8, borderRadius: 4, backgroundColor: color.present }} />
          </View>
        ) : null}

        <View style={{ borderTopWidth: 1, borderTopColor: color.line }}>
          {rows.map(([label, value]) => (
            <View key={label} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 56, borderBottomWidth: 1, borderBottomColor: color.line }}>
              <T style={{ color: color.muted }}>{label}</T>
              <T style={{ fontFamily: font.bodyBold, fontVariant: ['tabular-nums'] }}>{value}</T>
            </View>
          ))}
        </View>
        <T kind="small">Sundays and holidays{data.summary.holidays ? ` (${data.summary.holidays} this month)` : ''} are not counted.</T>
      </>
    );
  }

  return (
    <Screen tabbed>
      <ScrollView contentContainerStyle={{ gap: space.lg, paddingBottom: space.xl }} showsVerticalScrollIndicator={false}>
        <T kind="title">Stats</T>
        <MonthHeader month={month} onChange={setMonth} />
        {error ? <T style={{ color: color.danger }}>{error}</T> : null}
        {loading ? <ActivityIndicator color={color.present} style={{ marginVertical: space.xxl }} /> : null}
        {content}
      </ScrollView>
    </Screen>
  );
}
