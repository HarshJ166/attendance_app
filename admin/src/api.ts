import { useAuth0 } from '@auth0/auth0-react';
import { useCallback, useEffect, useState } from 'react';

export const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8787';

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** fetch with the HR person's Auth0 token. */
export function useApi() {
  const { getAccessTokenSilently } = useAuth0();
  return useCallback(
    async <T,>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> => {
      const token = await getAccessTokenSilently();
      let res: Response;
      try {
        res = await fetch(API_URL + path, {
          method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          body: init.body === undefined ? undefined : JSON.stringify(init.body),
        });
      } catch {
        throw new ApiError(0, 'offline', 'Can’t reach the GeoMark server. Check the internet connection.');
      }
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new ApiError(res.status, json.error ?? 'server_error', json.message ?? 'Something went wrong.');
      return json as T;
    },
    [getAccessTokenSilently],
  );
}

/** Load once per `key`; `reload()` refetches. Errors come back as a plain message. */
export function useLoad<T>(path: string | null) {
  const api = useApi();
  const [state, setState] = useState<{ path: string; data?: T; error?: ApiError } | null>(null);
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    if (!path) return;
    let alive = true;
    api<T>(path)
      .then((data) => alive && setState({ path, data }))
      .catch((error: ApiError) => alive && setState({ path, error }));
    return () => {
      alive = false;
    };
  }, [api, path, nonce]);
  const current = state?.path === path ? state : null;
  return { data: current?.data ?? null, error: current?.error ?? null, loading: !!path && !current, reload: () => setNonce((n) => n + 1) };
}

// ---------- shapes from the API ----------
export type Status = 'present' | 'flagged' | 'rejected' | 'absent' | 'not_yet' | 'off' | 'holiday';
export type Place = { id: number; name: string; kind: 'office' | 'home'; lat: number; lng: number; radius_m: number };
export type Person = { id: number; name: string; email: string | null; employee_code: string | null; designation: string | null };
export type Row = {
  user: Person;
  status: Status;
  attendance: null | {
    id: number; marked_at: string; status: string; late_min: number; flags: string[];
    site_name: string | null; site_kind: 'office' | 'home' | null; distance_m: number | null; accuracy_m: number;
    address: string | null; thumb_url: string;
  };
};
export type Attempt = { id: number; at: string; reason: string; distance_m: number | null; accuracy_m: number; lat: number; lng: number; user_id: number; name: string; site_name: string | null; site_kind: string | null };
export type Today = {
  date: string;
  settings: { shift_start: string; grace_min: number };
  holiday: string | null;
  summary: { expected: number; present: number; late: number; flagged: number; rejected: number; absent: number; not_yet: number; off: number; holiday: number; blocked_attempts: number };
  people: Row[];
  attempts: Attempt[];
};
export type Checkin = {
  id: number; user_id: number; day: string; marked_at: string; status: 'present' | 'flagged' | 'rejected'; flags: string[];
  distance_m: number | null; lat: number; lng: number; accuracy_m: number; address: string | null; late_min: number;
  reviewed_at: string | null; review_note: string | null; reviewed_by_name?: string | null; face_score: number | null;
  site_name: string | null; site_kind: 'office' | 'home' | null; photo_url: string | null;
  name: string; email: string | null; employee_code: string | null;
};
export type CheckinDetail = { attendance: Checkin; profile_photo_url: string | null; face_threshold: number; places: Place[]; attempts: { at: string; reason: string; distance_m: number | null; lat: number; lng: number; site_name: string | null }[] };

// ---------- formatting (IST, the company's clock) ----------
const IST = 'Asia/Kolkata';
export const time = (iso: string) => new Date(iso).toLocaleTimeString('en-IN', { timeZone: IST, hour: 'numeric', minute: '2-digit', hour12: true }).toUpperCase();
export const longDate = (day: string) => new Date(`${day}T00:00:00+05:30`).toLocaleDateString('en-IN', { timeZone: IST, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
export const shortDate = (day: string) => new Date(`${day}T00:00:00+05:30`).toLocaleDateString('en-IN', { timeZone: IST, weekday: 'short', day: 'numeric', month: 'short' });
export const istToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: IST }).format(new Date());
export const distance = (m: number | null) => (m == null ? '–' : m < 1000 ? `${m} m` : `${(m / 1000).toFixed(1)} km`);
export const placeLabel = (name: string | null, kind: string | null) => (kind === 'home' ? 'Home (WFH)' : name ?? '–');
export const REASON: Record<string, string> = {
  outside_site: 'Outside all their places',
  mock_location: 'Fake-location app',
  no_site: 'No place assigned',
};
