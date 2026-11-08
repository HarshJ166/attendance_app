// Shared HTTP pieces: auth middleware, current-user loading, attendance row shape.
import { createMiddleware } from 'hono/factory';
import { verifyToken, type Identity } from './auth.js';
import { sql } from './db/index.js';
import type { Site } from './rules.js';
import { viewUrl } from './storage.js';

export type User = {
  id: number; auth0_sub: string; email: string | null; name: string;
  consented_at: Date | null; consent_version: number; created_at: Date; active: boolean;
  face_embedding: number[] | null;
};
/** Consent text the app shows now. 2 added face matching; anyone on an older version is asked again. */
export const CONSENT_VERSION = 2;
export type Env = { Variables: { identity: Identity; user: User } };

export const todayIst = () => sql`(now() at time zone 'Asia/Kolkata')::date`;
export const DAY = /^\d{4}-\d{2}-\d{2}$/;
export const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Valid Auth0 token + employee or admin role + not deactivated by HR. */
export const auth = createMiddleware<Env>(async (c, next) => {
  const token = c.req.header('authorization')?.match(/^Bearer (.+)$/)?.[1];
  if (!token) return c.json({ error: 'unauthenticated', message: 'Please log in again.' }, 401);

  let identity: Identity;
  try {
    identity = await verifyToken(token);
  } catch {
    return c.json({ error: 'unauthenticated', message: 'Please log in again.' }, 401);
  }
  if (!identity.roles.some((r) => r === 'employee' || r === 'admin')) {
    return c.json({ error: 'forbidden', message: 'Your account has no access yet. Please contact HR.' }, 403);
  }

  // Look up first; insert only brand-new people. (An upsert on every request burned a serial id each time.)
  const COLS = sql`id, auth0_sub, email, name, consented_at, consent_version, created_at, active, face_embedding`;
  let [user] = await sql<User[]>`select ${COLS} from users where auth0_sub = ${identity.sub}`;
  if (!user) {
    [user] = await sql<User[]>`
      insert into users (auth0_sub, email, name) values (${identity.sub}, ${identity.email}, ${identity.name})
      on conflict (auth0_sub) do update set email = coalesce(excluded.email, users.email)
      returning ${COLS}`;
  } else if (identity.email && identity.email !== user.email) {
    [user] = await sql<User[]>`update users set email = ${identity.email} where id = ${user.id} returning ${COLS}`;
  }
  if (!user.active) return c.json({ error: 'deactivated', message: 'Your account has been turned off. Please contact HR.' }, 403);

  c.set('identity', identity);
  c.set('user', user);
  await next();
});

/** Use after `auth`. The role comes from the Auth0 token (source of truth), not the database. */
export const adminOnly = createMiddleware<Env>(async (c, next) => {
  if (!c.get('identity').roles.includes('admin')) return c.json({ error: 'forbidden', message: 'HR (admin) access only.' }, 403);
  await next();
});

/** Every place this person may check in from (offices, branches, home). */
export const placesOf = (userId: number) => sql<Site[]>`
  select s.id, s.name, s.kind, s.lat, s.lng, s.radius_m
  from user_sites us join sites s on s.id = us.site_id
  where us.user_id = ${userId} order by s.kind, s.name`;

export const ATTENDANCE_COLUMNS = sql`
  a.id, a.user_id, a.day::text as day, a.marked_at, a.status, a.flags, a.distance_m, a.lat, a.lng, a.accuracy_m,
  a.address, a.photo_key, a.late_min, a.reviewed_at, a.review_note, a.face_score,
  s.name as site_name, s.kind as site_kind, s.lat as site_lat, s.lng as site_lng, s.radius_m as site_radius_m`;

/** Company holidays in a month ("2026-11") → Map(day → name). */
export async function holidaysIn(month: string) {
  const rows = await sql<{ day: string; name: string }[]>`select day::text as day, name from holidays where to_char(day, 'YYYY-MM') = ${month}`;
  return new Map(rows.map((r) => [r.day, r.name]));
}
export async function holidayOn(day: string) {
  const [h] = await sql<{ name: string }[]>`select name from holidays where day = ${day}`;
  return h?.name ?? null;
}

/** One check-in as clients see it: photo key swapped for a fresh 10-minute photo link. */
export async function withPhoto(row: Record<string, unknown> | undefined) {
  if (!row) return null;
  const { photo_key, ...rest } = row;
  return { ...rest, photo_url: typeof photo_key === 'string' ? await viewUrl(photo_key) : null };
}
