// Street address for a check-in, from OpenStreetMap (free, no key). Best effort: null on any failure.
// ponytail: public Nominatim allows ~1 request/second and may throttle; fine for <100 check-ins a day.
// Self-host Nominatim or use a paid geocoder beyond that. lat/lng stay the source of truth either way.

const ADMIN_NOISE = /\b(ward|zone|district|taluka|tahsil|maharashtra|india)\b|^\d{6}$/i;

/** "Link Road, Renuka Nagar, Kandivali West, R/S Ward, Mumbai Zone 4, …, 400067, India" → "Link Road, Renuka Nagar, Kandivali West" */
export function shortAddress(displayName: string): string | null {
  const parts = displayName.split(',').map((p) => p.trim()).filter((p) => p && !ADMIN_NOISE.test(p));
  return parts.slice(0, 3).join(', ') || null;
}

export async function addressFor(lat: number, lng: number): Promise<string | null> {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=17&lat=${lat}&lon=${lng}`;
    const res = await fetch(url, { headers: { 'user-agent': 'GeoMark-attendance/1.0', 'accept-language': 'en' }, signal: AbortSignal.timeout(3000) });
    if (!res.ok) return null;
    const body = (await res.json()) as { display_name?: string };
    return body.display_name ? shortAddress(body.display_name) : null;
  } catch {
    return null; // throttled, offline, or not JSON: show coordinates instead
  }
}
