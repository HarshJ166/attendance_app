import { Image, Linking, View } from 'react-native';
import { placeLabel, type Attendance } from './api';
import { DayMap } from './DayMap';
import { formatDistance, mapUrl } from './geo';
import { Button, T } from './ui';
import { color, font, space } from './theme';

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });

/**
 * The selfie with its "geo stamp": time, place, coordinates, distance from the office.
 * Drawn from the server's record (not burned into the file), so editing the photo can't fake it.
 */
export function GeoStamp({ a, compact = false }: { a: Attendance; compact?: boolean }) {
  const flagged = a.status === 'flagged';
  const label = placeLabel(a.site_name, a.site_kind);
  const place = a.site_kind === 'home' ? `At ${label}` : a.distance_m != null ? `${formatDistance(a.distance_m)} from ${label}` : label;
  const lines = [
    when(a.marked_at),
    a.address,
    `${a.lat.toFixed(5)}, ${a.lng.toFixed(5)}  ·  GPS ±${Math.round(a.accuracy_m)} m`,
  ].filter(Boolean) as string[];

  return (
    <View style={{ alignSelf: 'stretch', gap: space.md }}>
      <View
        accessible
        accessibilityLabel={`Attendance selfie. ${lines.join('. ')}. ${place}`}
        style={{ borderRadius: 12, overflow: 'hidden', backgroundColor: color.ink, aspectRatio: compact ? 4 / 3 : 3 / 4 }}
      >
        {a.photo_url ? (
          <Image source={{ uri: a.photo_url }} style={{ flex: 1 }} resizeMode="cover" />
        ) : (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <T style={{ color: '#fff' }}>Photo not available</T>
          </View>
        )}
        <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(21,32,27,0.78)', padding: space.md, gap: 2 }}>
          <T style={{ color: flagged ? '#FFD38A' : '#9FE0BE', fontFamily: font.bodyBold, fontSize: 16 }}>
            {flagged ? '! ' : '✓ '}
            {place}
          </T>
          {lines.map((l) => (
            <T key={l} style={{ color: '#fff', fontSize: 14, lineHeight: 19 }} numberOfLines={2}>{l}</T>
          ))}
        </View>
      </View>
      <DayMap a={a} />
      <Button label="Open in Google Maps" kind="secondary" onPress={() => void Linking.openURL(mapUrl(a.lat, a.lng))} />
    </View>
  );
}
