import { useState, type ReactNode } from 'react';
import { Image, View, type LayoutChangeEvent } from 'react-native';
import { placeLabel, type Attendance } from './api';
import { distanceM, formatDistance } from './geo';
import { T } from './ui';
import { color, font } from './theme';

// A static map with no map SDK: OpenStreetMap tiles + our own pins/circles on top.
// No Google key, no native module. OSM tile policy: identify the app, show attribution, keep usage light.
// ponytail: fine for occasional viewing by <100 people; switch to a paid tile provider if it grows.
const TILE = 256;
const TILE_HEADERS = { 'User-Agent': 'GeoMark-attendance/1.0' };

const worldPx = (lat: number, lng: number, z: number) => {
  const scale = TILE * 2 ** z;
  const s = Math.sin((lat * Math.PI) / 180);
  return { x: ((lng + 180) / 360) * scale, y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * scale };
};
const metresPerPx = (lat: number, z: number) => (156_543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** z;

/** Office circle, the person's pin + GPS-accuracy ring, and the line between them, for one check-in. */
export function DayMap({ a, height = 240 }: { a: Attendance; height?: number }) {
  const [width, setWidth] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => setWidth(Math.round(e.nativeEvent.layout.width));

  const me = { lat: a.lat, lng: a.lng };
  const office = a.site_lat != null && a.site_lng != null ? { lat: a.site_lat, lng: a.site_lng, r: a.site_radius_m ?? 0 } : null;
  const inside = a.distance_m != null && office ? a.distance_m - a.accuracy_m <= office.r : true;
  const pinColor = inside ? color.present : color.danger;

  let body = null;
  if (width > 0) {
    // Pick the closest zoom where the office circle, the pin and its accuracy ring all fit with a margin.
    const need = (z: number) => {
      const p = worldPx(me.lat, me.lng, z);
      const mpp = metresPerPx(me.lat, z);
      const pts = [{ ...p, r: a.accuracy_m / mpp }];
      if (office) pts.push({ ...worldPx(office.lat, office.lng, z), r: office.r / mpp });
      const minX = Math.min(...pts.map((q) => q.x - q.r)), maxX = Math.max(...pts.map((q) => q.x + q.r));
      const minY = Math.min(...pts.map((q) => q.y - q.r)), maxY = Math.max(...pts.map((q) => q.y + q.r));
      return { fits: maxX - minX <= width - 48 && maxY - minY <= height - 48, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
    };
    let z = 18;
    while (z > 3 && !need(z).fits) z--;
    const { cx, cy } = need(z);
    const left = cx - width / 2, top = cy - height / 2;
    const mpp = metresPerPx(me.lat, z);
    const toScreen = (lat: number, lng: number) => {
      const p = worldPx(lat, lng, z);
      return { x: p.x - left, y: p.y - top };
    };

    const tiles = [];
    for (let tx = Math.floor(left / TILE); tx <= Math.floor((left + width) / TILE); tx++) {
      for (let ty = Math.floor(top / TILE); ty <= Math.floor((top + height) / TILE); ty++) {
        tiles.push(
          <Image
            key={`${tx}-${ty}`}
            source={{ uri: `https://tile.openstreetmap.org/${z}/${tx}/${ty}.png`, headers: TILE_HEADERS }}
            style={{ position: 'absolute', left: tx * TILE - left, top: ty * TILE - top, width: TILE, height: TILE }}
          />,
        );
      }
    }

    const p = toScreen(me.lat, me.lng);
    const o = office ? toScreen(office.lat, office.lng) : null;
    const acc = a.accuracy_m / mpp;
    const officeR = office ? office.r / mpp : 0;
    const line = o ? { len: Math.hypot(p.x - o.x, p.y - o.y), angle: Math.atan2(p.y - o.y, p.x - o.x), mx: (p.x + o.x) / 2, my: (p.y + o.y) / 2 } : null;
    const dist = a.distance_m ?? (office ? Math.round(distanceM(me, office)) : null);

    body = (
      <>
        {tiles}
        {o ? (
          <>
            {/* office radius */}
            <View style={{ position: 'absolute', left: o.x - officeR, top: o.y - officeR, width: officeR * 2, height: officeR * 2, borderRadius: officeR, borderWidth: 2, borderColor: color.present, backgroundColor: 'rgba(11,107,75,0.12)' }} />
            {/* office marker */}
            <View style={{ position: 'absolute', left: o.x - 7, top: o.y - 7, width: 14, height: 14, borderRadius: 3, backgroundColor: color.ink, borderWidth: 2, borderColor: '#fff' }} />
          </>
        ) : null}
        {line && line.len > 24 ? (
          <View style={{ position: 'absolute', left: line.mx - line.len / 2, top: line.my - 1, width: line.len, height: 2, backgroundColor: color.ink, opacity: 0.55, transform: [{ rotate: `${line.angle}rad` }] }} />
        ) : null}
        {/* GPS accuracy ring + person pin (2px white ring keeps it legible over the map) */}
        <View style={{ position: 'absolute', left: p.x - acc, top: p.y - acc, width: acc * 2, height: acc * 2, borderRadius: acc, backgroundColor: inside ? 'rgba(11,107,75,0.18)' : 'rgba(179,38,30,0.18)' }} />
        <View style={{ position: 'absolute', left: p.x - 9, top: p.y - 9, width: 18, height: 18, borderRadius: 9, backgroundColor: pinColor, borderWidth: 3, borderColor: '#fff' }} />
        {dist != null && line ? (
          <View style={{ position: 'absolute', left: Math.min(Math.max(line.mx - 50, 6), width - 106), top: Math.min(Math.max(line.my - 32, 6), height - 34), width: 100, alignItems: 'center' }}>
            <View style={{ backgroundColor: '#fff', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2 }}>
              <T style={{ fontFamily: font.bodyBold, fontSize: 14, lineHeight: 20, color: color.ink }}>{formatDistance(dist)}</T>
            </View>
          </View>
        ) : null}
        <View style={{ position: 'absolute', right: 0, bottom: 0, backgroundColor: 'rgba(255,255,255,0.85)', paddingHorizontal: 6, paddingVertical: 1 }}>
          <T style={{ fontSize: 11, lineHeight: 15, color: color.muted }}>© OpenStreetMap contributors</T>
        </View>
      </>
    );
  }

  return (
    <View style={{ gap: 8 }}>
      <View
        onLayout={onLayout}
        accessible
        accessibilityLabel={`Map: you were ${a.distance_m != null ? formatDistance(a.distance_m) : 'an unknown distance'} from ${a.site_name ?? 'the office'}, GPS accurate to ${Math.round(a.accuracy_m)} metres, ${inside ? 'inside' : 'outside'} the office area.`}
        style={{ height, borderRadius: 12, overflow: 'hidden', backgroundColor: color.mutedTint }}
      >
        {body}
      </View>
      {/* Legend: identity never by colour alone */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
        <Key swatch={<View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: pinColor, borderWidth: 2, borderColor: '#fff' }} />} label={`You (GPS ±${Math.round(a.accuracy_m)} m)`} />
        {office ? <Key swatch={<View style={{ width: 12, height: 12, borderRadius: 2, backgroundColor: color.ink }} />} label={`${placeLabel(a.site_name, a.site_kind)} (${office.r} m area)`} /> : null}
      </View>
    </View>
  );
}

function Key({ swatch, label }: { swatch: ReactNode; label: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      {swatch}
      <T kind="small">{label}</T>
    </View>
  );
}
