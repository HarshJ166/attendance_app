import L from 'leaflet';
import { useEffect, useRef } from 'react';
import { distance, placeLabel, time, type Place } from '../api';

const C = { present: '#0b6b4b', ink: '#15201b', danger: '#b3261e', muted: '#52615a' };

const haversine = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const R = 6_371_000, r = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
};

/**
 * Interactive OpenStreetMap: all of the person's places (circles), their pin + GPS accuracy ring,
 * a dashed line to the nearest place with the distance, and that day's blocked attempts.
 */
export function CheckinMap({ person, places, matchedName, attempts = [] }: {
  person: { lat: number; lng: number; accuracy_m: number };
  places: Place[];
  matchedName: string | null;
  attempts?: { at: string; lat: number; lng: number; distance_m: number | null; reason: string }[];
}) {
  const el = useRef<HTMLDivElement>(null);
  // Rebuild only when the data actually changes (callers pass fresh objects on every render).
  const key = JSON.stringify([person, places, matchedName, attempts]);

  useEffect(() => {
    if (!el.current) return;
    // Bounds straight from coordinates + radius (no layers needed), then the first view WITHOUT animation:
    // Leaflet only attaches layers once a view exists, and an animation still running at unmount throws _leaflet_pos.
    const bounds = L.latLng(person.lat, person.lng).toBounds(Math.max(person.accuracy_m, 30) * 2);
    for (const p of places) bounds.extend(L.latLng(p.lat, p.lng).toBounds(p.radius_m * 2));
    for (const a of attempts) bounds.extend([a.lat, a.lng]);
    const map = L.map(el.current, { scrollWheelZoom: false, attributionControl: true }).fitBounds(bounds, { padding: [32, 32], maxZoom: 18, animate: false });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap contributors' }).addTo(map);

    const ranked = places.map((p) => ({ p, d: haversine(person, p) })).sort((a, b) => a.d - b.d);
    const inside = ranked.find((r) => r.d - person.accuracy_m <= r.p.radius_m);
    const pin = inside ? C.present : C.danger;

    for (const { p } of ranked) {
      const isMatch = p.name === matchedName;
      const circle = L.circle([p.lat, p.lng], { radius: p.radius_m, color: isMatch ? C.present : C.ink, weight: 2, opacity: isMatch ? 1 : 0.5, fillOpacity: isMatch ? 0.12 : 0.05 }).addTo(map);
      circle.bindTooltip(`${placeLabel(p.name, p.kind)} · ${p.radius_m} m area`, { direction: 'top' });
      L.circleMarker([p.lat, p.lng], { radius: 5, color: '#fff', weight: 2, fillColor: C.ink, fillOpacity: 1 }).addTo(map);
    }

    const nearest = inside ?? ranked[0];
    if (nearest && nearest.d > 15) {
      L.polyline([[nearest.p.lat, nearest.p.lng], [person.lat, person.lng]], { color: C.ink, weight: 2, dashArray: '6 6', opacity: 0.7 })
        .addTo(map)
        .bindTooltip(distance(nearest.d), { permanent: true, direction: 'center', className: 'dist-label' });
    }

    L.circle([person.lat, person.lng], { radius: person.accuracy_m, stroke: false, fillColor: pin, fillOpacity: 0.18 }).addTo(map);
    L.circleMarker([person.lat, person.lng], { radius: 8, color: '#fff', weight: 3, fillColor: pin, fillOpacity: 1 })
      .addTo(map)
      .bindTooltip(`Check-in · GPS ±${Math.round(person.accuracy_m)} m`, { direction: 'top' });

    for (const a of attempts) {
      L.circleMarker([a.lat, a.lng], { radius: 6, color: C.danger, weight: 2, fillOpacity: 0 })
        .addTo(map)
        .bindTooltip(`Blocked at ${time(a.at)}${a.distance_m != null ? ` · ${distance(a.distance_m)} away` : ''}`, { direction: 'top' });
    }

    return () => {
      map.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const nearest = places.length ? Math.min(...places.map((p) => haversine(person, p) - p.radius_m)) : null;
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div
        ref={el}
        className="map"
        role="img"
        aria-label={`Map of the check-in. ${nearest != null && nearest > person.accuracy_m ? 'Outside' : 'Inside'} their allowed places. ${places.length} places shown.`}
      />
      <div className="key">
        <span><i style={{ background: C.present }} />Check-in inside a place</span>
        <span><i style={{ background: C.danger }} />Outside</span>
        <span><i style={{ background: C.ink }} />Allowed place (circle = area)</span>
        {attempts.length ? <span><i style={{ border: `2px solid ${C.danger}`, background: 'transparent' }} />Blocked attempt</span> : null}
      </div>
    </div>
  );
}
