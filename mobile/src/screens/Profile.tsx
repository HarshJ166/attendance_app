import Constants from 'expo-constants';
import { Linking, Pressable, ScrollView, View } from 'react-native';
import { placeLabel, type Me } from '../api';
import { mapUrl } from '../geo';
import { Button, Screen, T } from '../ui';
import { color, font, space } from '../theme';

const date = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });

export function Profile({ me, onLogout }: { me: Me; onLogout: () => void }) {
  const initials = me.name.split(' ').map((p) => p[0]).join('').slice(0, 2).toUpperCase() || '?';
  const role = me.roles.includes('admin') ? 'Admin (HR)' : 'Employee';
  const rows: [string, string][] = [
    ['Email', me.email ?? '–'],
    ['Role', role],
    ['Member since', date(me.created_at)],
    ['Consent given', me.consented_at ? date(me.consented_at) : '–'],
  ];

  return (
    <Screen tabbed>
      <ScrollView contentContainerStyle={{ gap: space.lg, paddingBottom: space.xl }} showsVerticalScrollIndicator={false}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.lg }}>
          <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: color.presentTint, alignItems: 'center', justifyContent: 'center' }}>
            <T style={{ fontFamily: font.displayBold, fontSize: 26, lineHeight: 32, color: color.present }}>{initials}</T>
          </View>
          <View style={{ flex: 1 }}>
            <T kind="title">{me.name || 'Your profile'}</T>
            <T kind="small">{role}</T>
          </View>
        </View>

        <View style={{ borderTopWidth: 1, borderTopColor: color.line }}>
          {rows.map(([label, value]) => (
            <View key={label} style={{ paddingVertical: space.md, minHeight: 56, borderBottomWidth: 1, borderBottomColor: color.line, gap: 2 }}>
              <T kind="small">{label}</T>
              <T>{value}</T>
            </View>
          ))}
        </View>

        <View style={{ gap: space.sm }}>
          <T style={{ fontFamily: font.bodyBold }}>Where you can mark attendance</T>
          {me.sites.length ? (
            me.sites.map((p) => (
              <View key={p.id} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 56, borderBottomWidth: 1, borderBottomColor: color.line }}>
                <View style={{ flex: 1 }}>
                  <T>{placeLabel(p.name, p.kind)}</T>
                  <T kind="small">Within {p.radius_m} m</T>
                </View>
                <Pressable accessibilityRole="link" accessibilityLabel={`Open ${placeLabel(p.name, p.kind)} on map`} onPress={() => void Linking.openURL(mapUrl(p.lat, p.lng))} style={{ minHeight: 48, justifyContent: 'center', paddingLeft: space.md }}>
                  <T style={{ color: color.present, fontFamily: font.bodyBold }}>Map</T>
                </Pressable>
              </View>
            ))
          ) : (
            <T style={{ color: color.danger }}>No place assigned yet. Please contact HR.</T>
          )}
        </View>

        <View style={{ backgroundColor: color.mutedTint, borderRadius: 12, padding: space.lg, gap: space.xs }}>
          <T style={{ fontFamily: font.bodyBold }}>Your privacy</T>
          <T kind="small">
            GeoMark uses the camera and your location only when you tap Mark attendance. Selfies are deleted automatically after 90 days.
          </T>
        </View>

        <Button label="Log out" kind="secondary" onPress={onLogout} />
        <T kind="small" style={{ textAlign: 'center' }}>GeoMark {Constants.expoConfig?.version ?? ''}</T>
      </ScrollView>
    </Screen>
  );
}
