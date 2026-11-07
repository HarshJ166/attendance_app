// Pure attendance rules: no DB, no HTTP. Tested in rules.test.ts.

export type Fix = { lat: number; lng: number; accuracy_m: number; mocked: boolean };
export type Site = { id: number; name: string; kind: 'office' | 'home'; lat: number; lng: number; radius_m: number };
export type Block = 'outside_site' | 'mock_location' | 'no_site';

const LOW_ACCURACY_M = 100;

/** Great-circle distance in metres (haversine). */
export function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export const formatDistance = (m: number) => (m < 1000 ? `${m} m` : `${(m / 1000).toFixed(1)} km`);

export type Verdict =
  | { blocked: Block; site: Site | null; distance_m: number | null } // site = nearest allowed place, if any
  | { blocked: null; site: Site; distance_m: number; status: 'present' | 'flagged'; flags: string[] };

/**
 * Policy (decided 2026-11-08): a person may have many places (offices, branches, home).
 * Inside ANY of them → allowed, matched to the nearest one they're inside.
 * Outside all of them, fake GPS, or no place at all → BLOCKED, nothing saved (attempt logged).
 * Weak GPS inside a place → saved but flagged for HR.
 */
export function classify(fix: Fix, sites: Site[]): Verdict {
  const ranked = sites
    .map((site) => ({ site, distance_m: Math.round(distanceM(fix, site)) }))
    .sort((a, b) => a.distance_m - b.distance_m);
  const nearest = ranked[0] ?? null;

  if (fix.mocked) return { blocked: 'mock_location', site: nearest?.site ?? null, distance_m: nearest?.distance_m ?? null };
  if (!nearest) return { blocked: 'no_site', site: null, distance_m: null };

  // Benefit of GPS error: inside if even the closest possible point is inside the circle.
  const inside = ranked.find((r) => r.distance_m - fix.accuracy_m <= r.site.radius_m);
  if (!inside) return { blocked: 'outside_site', site: nearest.site, distance_m: nearest.distance_m };

  const flags = fix.accuracy_m > LOW_ACCURACY_M ? ['low_accuracy'] : [];
  return { blocked: null, site: inside.site, distance_m: inside.distance_m, status: flags.length ? 'flagged' : 'present', flags };
}

/** Minutes after shift start, if past the grace period (IST). 0 = on time. */
export function minutesLate(at: Date, shiftStart: string, graceMin: number): number {
  const [h, m] = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .format(at).split(':').map(Number);
  const [sh, sm] = shiftStart.split(':').map(Number);
  const after = h * 60 + m - (sh * 60 + sm);
  return after > graceMin ? after : 0;
}

/** What the person reads when blocked. */
export function blockMessage(block: Block, distance_m: number | null, site: Site | null): string {
  switch (block) {
    case 'outside_site':
      return site?.kind === 'home'
        ? `You are ${formatDistance(distance_m ?? 0)} from your home location. Mark attendance from home or the office.`
        : `You are ${formatDistance(distance_m ?? 0)} from ${site?.name ?? 'your office'}. Go to the office to mark attendance.`;
    case 'mock_location':
      return 'A fake-location app is on. Turn it off to mark attendance.';
    case 'no_site':
      return 'No office is assigned to you yet. Please contact HR.';
  }
}

/** Validates the untrusted request body. Returns the fix or an error message. */
export function parseFix(body: unknown): Fix | string {
  const b = (body ?? {}) as Record<string, unknown>;
  const { lat, lng, accuracy_m, mocked } = b;
  if (typeof lat !== 'number' || !Number.isFinite(lat) || lat < -90 || lat > 90) return 'lat must be a number between -90 and 90';
  if (typeof lng !== 'number' || !Number.isFinite(lng) || lng < -180 || lng > 180) return 'lng must be a number between -180 and 180';
  if (typeof accuracy_m !== 'number' || !Number.isFinite(accuracy_m) || accuracy_m <= 0 || accuracy_m > 50_000) return 'accuracy_m must be a positive number';
  if (typeof mocked !== 'boolean') return 'mocked must be true or false';
  return { lat, lng, accuracy_m, mocked };
}

// ---------- Calendar ----------

export type DayKind = 'present' | 'flagged' | 'absent' | 'off' | 'today' | 'future' | 'before_joining';
export type Marked = 'present' | 'flagged' | 'rejected';

const WEEKLY_OFF = new Set([0]); // Sunday only (decided 2026-11-08)
export const weekdayOf = (day: string) => new Date(`${day}T00:00:00Z`).getUTCDay();

/** What one IST calendar day ("YYYY-MM-DD") means for one person. A check-in HR rejected counts as absent. */
export function dayKind(day: string, today: string, joined: string, marked?: Marked): DayKind {
  if (marked === 'present' || marked === 'flagged') return marked;
  if (marked === 'rejected') return 'absent';
  if (day > today) return 'future';
  if (day < joined) return 'before_joining';
  if (WEEKLY_OFF.has(weekdayOf(day))) return 'off';
  if (day === today) return 'today'; // not marked yet, but the day isn't over
  return 'absent';
}

/** Every date of `month` ("2026-11"), classified for one person. */
export function monthDays(month: string, today: string, joined: string, marked: Map<string, Marked>) {
  const [y, m] = month.split('-').map(Number);
  const count = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: count }, (_, i) => {
    const day = `${month}-${String(i + 1).padStart(2, '0')}`;
    return { day, weekday: weekdayOf(day), kind: dayKind(day, today, joined, marked.get(day)) };
  });
}

// ---------- CSV ----------

/** One CSV cell: quoted, and neutralised so Excel can't run it as a formula (CSV injection). */
export function csvCell(v: unknown): string {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}
export const csvRow = (cells: unknown[]) => cells.map(csvCell).join(',');
