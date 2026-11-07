import { ScrollView, View } from 'react-native';
import type { Attendance, Me } from '../api';
import { GeoStamp } from '../GeoStamp';
import { Button, s, Screen, T } from '../ui';
import { color, font, space } from '../theme';

const greeting = (h = new Date().getHours()) => (h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening');
const today = () => new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });
const clock = (iso: string) => new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true }).toUpperCase();

export function Home({ me, attendance, onMark }: { me: Me; attendance: Attendance | null; onMark: () => void }) {
  const first = me.name.split(' ')[0] || 'there';
  const flagged = attendance?.status === 'flagged';

  return (
    <Screen tabbed footer={!attendance && me.sites.length ? <Button label="Mark attendance" onPress={onMark} /> : null}>
      <View style={{ gap: space.xs }}>
        <T kind="title">{greeting()}, {first}</T>
        <T kind="small">{today()}</T>
      </View>

      {attendance ? (
        // The receipt: status, time, and the geo-stamped selfie.
        <ScrollView contentContainerStyle={{ gap: space.md, paddingVertical: space.md }} showsVerticalScrollIndicator={false}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
            <View style={[s.badge, { backgroundColor: flagged ? color.warnTint : color.presentTint, marginBottom: 0 }]}>
              <T style={[s.badgeGlyph, { color: flagged ? color.warn : color.present }]}>{flagged ? '!' : '✓'}</T>
            </View>
            <View style={{ flex: 1 }}>
              <T kind="status">{flagged ? 'Present, HR will check' : "You're present"}</T>
              <T kind="time" style={{ fontSize: 34, lineHeight: 40 }}>{clock(attendance.marked_at)}</T>
            </View>
          </View>
          {attendance.late_min > 0 ? (
            <View style={{ alignSelf: 'flex-start', backgroundColor: color.warnTint, borderRadius: 8, paddingHorizontal: space.md, paddingVertical: space.xs }}>
              <T kind="small" style={{ color: color.warn, fontFamily: font.bodyBold }}>Late by {attendance.late_min} min</T>
            </View>
          ) : null}
          {flagged ? (
            <View style={{ backgroundColor: color.warnTint, borderRadius: 12, padding: space.md }}>
              <T style={{ color: color.warn }}>Your GPS signal was weak, so HR may double-check this one.</T>
            </View>
          ) : null}
          <GeoStamp a={attendance} />
        </ScrollView>
      ) : (
        <View style={{ flex: 1, justifyContent: 'center', gap: space.sm }}>
          <View style={{ alignSelf: 'flex-start', backgroundColor: color.mutedTint, borderRadius: 8, paddingHorizontal: space.md, paddingVertical: space.xs }}>
            <T kind="small" style={{ fontFamily: font.bodyBold }}>Not marked</T>
          </View>
          <T kind="status">{"Mark today's attendance"}</T>
          {me.sites.length ? (
            <T style={{ color: color.muted }}>
              Be at {me.sites.map((p) => (p.kind === 'home' ? 'home' : p.name)).join(' or ')}. It takes a selfie and checks your location, in about 10 seconds.
            </T>
          ) : (
            <View style={{ backgroundColor: color.dangerTint, borderRadius: 12, padding: space.md }}>
              <T style={{ color: color.danger }}>No office is assigned to you yet. Please contact HR.</T>
            </View>
          )}
        </View>
      )}
    </Screen>
  );
}
