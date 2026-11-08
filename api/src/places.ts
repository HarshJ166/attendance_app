// Address lookups: Mappls first (best for India), OpenStreetMap as backup, and pasted coordinates /
// Google Maps links as the always-works fallback. Mappls key stays server-side (MAPPLS_REST_KEY).
// Docs: https://developer.mappls.com (rev-geocode, autosuggest; key = access_token query param).

const MAPPLS = 'https://search.mappls.com/search';
const OSM = 'https://nominatim.openstreetmap.org';
const UA = { 'user-agent': 'GeoMark-attendance/1.0', 'accept-language': 'en' };
const key = () => process.env.MAPPLS_REST_KEY?.trim() || null;

export type Hit = { label: string; lat: number; lng: number; source: 'coordinates' | 'google' | 'mappls' | 'osm' };

// ---------- 1. Pasted coordinates / Google Maps links (pure, tested) ----------

const inRange = (lat: number, lng: number) => Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);

/** "19.2066, 72.8357" · "19.2066° N, 72.8357° E" · any Google Maps URL with @lat,lng / q= / ll= / !3d!4d. */
export function parseCoordinates(text: string): { lat: number; lng: number } | null {
  const t = decodeURIComponent(text.trim());
  const patterns = [
    /!3d(-?\d{1,2}\.\d+)!4d(-?\d{1,3}\.\d+)/, // place pins inside Google URLs (most exact, so first)
    /@(-?\d{1,2}\.\d+),\s*(-?\d{1,3}\.\d+)/, // …/@19.2066,72.8357,17z
    /[?&](?:q|query|ll|center|destination)=(-?\d{1,2}\.\d+),\s*(-?\d{1,3}\.\d+)/,
    /^\s*(-?\d{1,2}\.\d+)\s*°?\s*([NS])?\s*[,\s]\s*(-?\d{1,3}\.\d+)\s*°?\s*([EW])?\s*$/i, // plain pair
  ];
  for (const re of patterns) {
    const m = t.match(re);
    if (!m) continue;
    let lat = Number(m[1]);
    let lng = Number(m[re === patterns[3] ? 3 : 2]);
    if (re === patterns[3]) {
      if (m[2]?.toUpperCase() === 'S') lat = -Math.abs(lat);
      if (m[4]?.toUpperCase() === 'W') lng = -Math.abs(lng);
    }
    if (inRange(lat, lng)) return { lat: +lat.toFixed(6), lng: +lng.toFixed(6) };
  }
  return null;
}

const GOOGLE_HOSTS = /^(maps\.app\.goo\.gl|goo\.gl|(www\.)?google\.[a-z.]+|maps\.google\.[a-z.]+)$/i;
export const isGoogleMapsLink = (text: string) => {
  try {
    const u = new URL(text.trim());
    return u.protocol === 'https:' && GOOGLE_HOSTS.test(u.hostname) && (u.hostname.includes('goo.gl') || u.pathname.startsWith('/maps'));
  } catch {
    return false;
  }
};

/**
 * Short share links (maps.app.goo.gl/…) only redirect to the real URL. Follow up to 5 redirects,
 * staying on Google hosts only (no SSRF), and read the coordinates from the final URL.
 */
export async function resolveGoogleLink(link: string): Promise<{ lat: number; lng: number } | null> {
  let url = link.trim();
  for (let hop = 0; hop < 5; hop++) {
    const direct = parseCoordinates(url);
    if (direct) return direct;
    const u = new URL(url);
    if (u.protocol !== 'https:' || !GOOGLE_HOSTS.test(u.hostname)) return null;
    const res = await fetch(url, { redirect: 'manual', headers: UA, signal: AbortSignal.timeout(4000) });
    const next = res.headers.get('location');
    if (!next) {
      // Landed on a page: the coordinates are sometimes only inside it.
      const html = res.ok ? (await res.text()).slice(0, 200_000) : '';
      return parseCoordinates(html.match(/https:\/\/www\.google\.[^"' ]*@-?\d+\.\d+,-?\d+\.\d+[^"' ]*/)?.[0] ?? '') ?? null;
    }
    url = new URL(next, url).toString();
  }
  return parseCoordinates(url);
}

// ---------- 2. Mappls ----------

type MapplsRev = { results?: { formatted_address?: string; houseNumber?: string; houseName?: string; poi?: string; street?: string; subSubLocality?: string; subLocality?: string; locality?: string; village?: string; city?: string; district?: string; pincode?: string }[] };

/** "Shop 4, Renuka Nagar, Kandivali West, Mumbai 400067" from Mappls reverse geocode. */
export function mapplsShortAddress(r: NonNullable<MapplsRev['results']>[number]): string | null {
  const parts = [r.houseNumber, r.houseName, r.poi, r.street, r.subSubLocality, r.subLocality, r.locality || r.village, r.city || r.district]
    .map((p) => p?.trim()).filter((p): p is string => !!p && !/^unnamed/i.test(p));
  const uniq = [...new Set(parts)].slice(0, 5).join(', ');
  return uniq ? (r.pincode ? `${uniq} ${r.pincode}` : uniq) : r.formatted_address?.trim() || null;
}

async function mapplsReverse(lat: number, lng: number): Promise<string | null> {
  const k = key();
  if (!k) return null;
  const res = await fetch(`${MAPPLS}/address/rev-geocode?lat=${lat}&lng=${lng}&access_token=${encodeURIComponent(k)}`, { signal: AbortSignal.timeout(3000) });
  if (!res.ok) return null;
  const r = ((await res.json()) as MapplsRev).results?.[0];
  return r ? mapplsShortAddress(r) : null;
}

type Suggest = { placeName?: string; placeAddress?: string; latitude?: number | string; longitude?: number | string; lat?: number | string; lng?: number | string };
async function mapplsSuggest(q: string): Promise<{ label: string; lat?: number; lng?: number }[]> {
  const k = key();
  if (!k) return [];
  const url = `${MAPPLS}/places/autosuggest/json?query=${encodeURIComponent(q.slice(0, 45))}&region=IND&location=19.0760,72.8777&access_token=${encodeURIComponent(k)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
  if (!res.ok) return [];
  const list = ((await res.json()) as { suggestedLocations?: Suggest[] }).suggestedLocations ?? [];
  return list.slice(0, 6).map((s) => {
    const lat = Number(s.latitude ?? s.lat), lng = Number(s.longitude ?? s.lng);
    return { label: [s.placeName, s.placeAddress].filter(Boolean).join(', '), ...(inRange(lat, lng) ? { lat, lng } : {}) };
  });
}

// ---------- 3. OpenStreetMap ----------

const ADMIN_NOISE = /\b(ward|zone|district|taluka|tahsil|maharashtra|india)\b|^\d{6}$/i;
/** "Link Road, Renuka Nagar, Kandivali West, R/S Ward, …, 400067, India" → "Link Road, Renuka Nagar, Kandivali West" */
export function shortAddress(displayName: string): string | null {
  const parts = displayName.split(',').map((p) => p.trim()).filter((p) => p && !ADMIN_NOISE.test(p));
  return parts.slice(0, 3).join(', ') || null;
}

async function osmReverse(lat: number, lng: number): Promise<string | null> {
  const res = await fetch(`${OSM}/reverse?format=jsonv2&zoom=17&lat=${lat}&lon=${lng}`, { headers: UA, signal: AbortSignal.timeout(3000) });
  if (!res.ok) return null;
  const body = (await res.json()) as { display_name?: string };
  return body.display_name ? shortAddress(body.display_name) : null;
}

async function osmSearch(q: string): Promise<Hit[]> {
  const res = await fetch(`${OSM}/search?format=jsonv2&countrycodes=in&limit=5&q=${encodeURIComponent(q)}`, { headers: UA, signal: AbortSignal.timeout(4000) });
  if (!res.ok) return [];
  return ((await res.json()) as { display_name: string; lat: string; lon: string }[]).map((r) => ({ label: r.display_name, lat: Number(r.lat), lng: Number(r.lon), source: 'osm' as const }));
}

// ---------- public ----------

/** Street address for a check-in. Mappls → OSM → null (coordinates are always stored anyway). */
export async function addressFor(lat: number, lng: number): Promise<string | null> {
  for (const lookup of [mapplsReverse, osmReverse]) {
    try {
      const a = await lookup(lat, lng);
      if (a) return a;
    } catch {
      /* next source */
    }
  }
  return null;
}

/** Place picker search: coordinates or Google link → that point; otherwise Mappls, then OSM. */
export async function searchPlaces(q: string): Promise<{ results: Hit[]; message?: string }> {
  const direct = parseCoordinates(q);
  if (direct) {
    const fromLink = isGoogleMapsLink(q);
    return { results: [{ label: `${fromLink ? 'From Google Maps link' : 'Coordinates'} (${direct.lat}, ${direct.lng})`, ...direct, source: fromLink ? 'google' : 'coordinates' }] };
  }
  if (isGoogleMapsLink(q)) {
    const p = await resolveGoogleLink(q).catch(() => null);
    return p
      ? { results: [{ label: `From Google Maps link (${p.lat}, ${p.lng})`, ...p, source: 'google' }] }
      : { results: [], message: 'That Google Maps link has no exact pin. In Google Maps, long-press the spot, copy the numbers (e.g. 19.2066, 72.8357) and paste them here.' };
  }
  try {
    const m = await mapplsSuggest(q);
    const withPin = m.filter((s): s is { label: string; lat: number; lng: number } => s.lat !== undefined);
    if (withPin.length) return { results: withPin.map((s) => ({ ...s, source: 'mappls' as const })) };
  } catch {
    /* fall through to OSM */
  }
  try {
    const o = await osmSearch(q);
    if (o.length) return { results: o };
  } catch {
    /* fall through */
  }
  return { results: [], message: 'No match. Paste coordinates or a Google Maps link, or click on the map.' };
}
