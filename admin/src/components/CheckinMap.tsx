import { useEffect, useRef } from 'react';
import { distance, placeLabel, time, type Place } from '../api';
import { chip, dot, mountMap } from '../geomap';

const C = { present: '#0b6b4b', ink: '#15201b', danger: '#b3261e', muted: '#52615a' };

const haversine = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const R = 6_371_000, r = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
};

/**
 * Interactive map (Mappls, else OpenStreetMap): all of the person's places (circles), their pin + GPS accuracy ring,
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
    return mountMap(el.current, { center: person, zoom: 16, scrollZoom: false }, (map) => {
      const ranked = places.map((p) => ({ p, d: haversine(person, p) })).sort((a, b) => a.d - b.d);
      const inside = ranked.find((r) => r.d - person.accuracy_m <= r.p.radius_m);
      const pin = inside ? C.present : C.danger;
      map.fit([{ ...person, r: Math.max(person.accuracy_m, 30) }, ...places.map((p) => ({ ...p, r: p.radius_m })), ...attempts], 18);

      for (const { p } of ranked) {
        const isMatch = p.name === matchedName;
        map.area(p, p.radius_m, { color: isMatch ? C.present : C.ink, opacity: isMatch ? 1 : 0.5, fillOpacity: isMatch ? 0.12 : 0.05 });
        map.marker(p, dot({ size: 10, fill: C.ink, title: `${placeLabel(p.name, p.kind)} · ${p.radius_m} m area` }));
      }

      const nearest = inside ?? ranked[0];
      if (nearest && nearest.d > 15) {
        map.dashed(nearest.p, person, C.ink);
        map.marker({ lat: (nearest.p.lat + person.lat) / 2, lng: (nearest.p.lng + person.lng) / 2 }, chip(distance(nearest.d)));
      }

      map.area(person, person.accuracy_m, { color: pin, fillOpacity: 0.18, stroke: false });
      map.marker(person, dot({ size: 16, fill: pin, ringW: 3, title: `Check-in · GPS ±${Math.round(person.accuracy_m)} m` }));

      for (const a of attempts) {
        map.marker(a, dot({ size: 12, fill: C.danger, ring: C.danger, hollow: true, title: `Blocked at ${time(a.at)}${a.distance_m != null ? ` · ${distance(a.distance_m)} away` : ''}` }));
      }
    });
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
