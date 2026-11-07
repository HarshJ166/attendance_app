import Constants from 'expo-constants';
import { fetch as expoFetch } from 'expo/fetch';
import type { File } from 'expo-file-system';

// Dev build: the API runs on the same Mac as the Metro bundler, so reuse its LAN address.
// Release APK: set EXPO_PUBLIC_API_URL to the deployed HTTPS API.
const devHost = Constants.expoConfig?.hostUri?.split(':')[0];
export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? (devHost ? `http://${devHost}:8787` : '');

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public body: Record<string, unknown> = {}) {
    super(message);
  }
}

export type Me = {
  id: number;
  name: string;
  email: string | null;
  roles: string[];
  sites: Place[]; // offices, branches and home this person may check in from
  consented_at: string | null;
  created_at: string;
};

export type Place = { id: number; name: string; kind: 'office' | 'home'; lat: number; lng: number; radius_m: number };

export type Attendance = {
  day: string;
  marked_at: string;
  status: 'present' | 'flagged';
  flags: string[];
  distance_m: number | null;
  lat: number;
  lng: number;
  accuracy_m: number;
  address: string | null;
  site_name: string | null;
  site_kind: 'office' | 'home' | null;
  late_min: number;
  site_lat: number | null;
  site_lng: number | null;
  site_radius_m: number | null;
  photo_url: string | null;
};

export type DayKind = 'present' | 'flagged' | 'absent' | 'off' | 'today' | 'future' | 'before_joining';
export type CalendarDay = {
  day: string; weekday: number; kind: DayKind;
  marked_at?: string; site_name?: string | null; site_kind?: 'office' | 'home' | null; distance_m?: number | null; address?: string | null; late_min?: number;
};
export type Month = { month: string; days: CalendarDay[]; summary: { present: number; flagged: number; absent: number; late: number } };

/** "Dahanukarwadi" or "Home (WFH)" */
export const placeLabel = (name: string | null | undefined, kind: 'office' | 'home' | null | undefined) =>
  kind === 'home' ? 'Home (WFH)' : (name ?? 'Office');

export async function api<T>(token: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(API_URL + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'offline', 'No internet. Please check your connection and try again.');
  }
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new ApiError(
      res.status,
      String(json.error ?? 'server_error'),
      String(json.message ?? 'Something went wrong. Please try again.'),
      json,
    );
  }
  return json as T;
}

/** PUT the selfie straight to storage using the one-time link from the API. */
export async function uploadSelfie(url: string, file: File): Promise<void> {
  let res;
  try {
    res = await expoFetch(url, { method: 'PUT', headers: { 'content-type': 'image/jpeg' }, body: file });
  } catch {
    throw new ApiError(0, 'offline', 'No internet. Please check your connection and try again.');
  }
  if (!res.ok) throw new ApiError(res.status, 'upload_failed', 'Your photo did not upload. Please try again.');
}
