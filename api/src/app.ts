import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { admin } from './admin.js';
import { sql } from './db/index.js';
import { addressFor } from './geocode.js';
import { ATTENDANCE_COLUMNS, auth, DAY, holidayOn, holidaysIn, MONTH, placesOf, todayIst, withPhoto, type Env } from './http.js';
import { blockMessage, classify, minutesLate, monthDays, parseFix, type Marked } from './rules.js';
import { exists, isOwnSelfieKey, istDay, MAX_SELFIE_BYTES, newSelfieKey, remove, uploadUrl } from './storage.js';

export const app = new Hono<Env>();
app.use(logger()); // method, path, status, ms. Never logs bodies or tokens.

// Only the admin website runs in a browser; the phone app doesn't need CORS.
const adminOrigins = (process.env.ADMIN_ORIGINS ?? 'http://localhost:5173').split(',').map((o) => o.trim());
app.use('*', cors({ origin: adminOrigins, allowHeaders: ['authorization', 'content-type'], allowMethods: ['GET', 'POST', 'PATCH', 'DELETE'], maxAge: 600 }));

app.get('/health', (c) => c.text('ok'));
app.route('/admin', admin);

// ---------- Employee app ----------

app.get('/me', auth, async (c) => {
  const user = c.get('user');
  return c.json({
    id: user.id, name: user.name, email: user.email, roles: c.get('identity').roles,
    sites: await placesOf(user.id), // offices / branches / home this person may check in from
    consented_at: user.consented_at,
    created_at: user.created_at,
  });
});

// DPDP: record (once) that the person agreed to selfie + location use.
app.post('/consent', auth, async (c) => {
  const [row] = await sql`
    update users set consented_at = coalesce(consented_at, now())
    where id = ${c.get('user').id} returning consented_at`;
  return c.json({ consented_at: row.consented_at });
});

app.get('/attendance/today', auth, async (c) => {
  const [row] = await sql`
    select ${ATTENDANCE_COLUMNS}
    from attendance a left join sites s on s.id = a.site_id
    where a.user_id = ${c.get('user').id} and a.day = ${todayIst()}`;
  return c.json({ attendance: await withPhoto(row), holiday: await holidayOn(istDay()) });
});

// Calendar: every day of a month for the signed-in person (Sunday off; see rules.monthDays).
app.get('/attendance/month', auth, async (c) => {
  const month = c.req.query('month') ?? istDay().slice(0, 7);
  if (!MONTH.test(month)) return c.json({ error: 'invalid', message: 'month must look like 2026-11' }, 400);
  const user = c.get('user');
  const rows = await sql`
    select ${ATTENDANCE_COLUMNS}
    from attendance a left join sites s on s.id = a.site_id
    where a.user_id = ${user.id} and to_char(a.day, 'YYYY-MM') = ${month}
    order by a.day`;
  const byDay = new Map(rows.map((r) => [r.day as string, r]));
  const days = monthDays(month, istDay(), istDay(user.created_at), new Map(rows.map((r) => [r.day as string, r.status as Marked])), await holidaysIn(month))
    .map((d) => {
      const r = byDay.get(d.day);
      return r && r.status !== 'rejected'
        ? { ...d, marked_at: r.marked_at, site_name: r.site_name, site_kind: r.site_kind, distance_m: r.distance_m, address: r.address, late_min: r.late_min }
        : d;
    });
  const count = (k: string) => days.filter((d) => d.kind === k).length;
  const late = rows.filter((r) => r.status !== 'rejected' && r.late_min > 0).length;
  return c.json({ month, days, summary: { present: count('present'), flagged: count('flagged'), absent: count('absent'), late, holidays: count('holiday') } });
});

// One day's full record incl. photo link (own records only).
app.get('/attendance/day/:day', auth, async (c) => {
  const day = c.req.param('day');
  if (!DAY.test(day)) return c.json({ error: 'invalid', message: 'day must look like 2026-11-08' }, 400);
  const [row] = await sql`
    select ${ATTENDANCE_COLUMNS}
    from attendance a left join sites s on s.id = a.site_id
    where a.user_id = ${c.get('user').id} and a.day = ${day} and a.status <> 'rejected'`;
  return c.json({ attendance: await withPhoto(row) });
});

/** Shared gate for every check-in step: consent, valid location, and allowed at one of the person's places. */
async function gate(c: Context<Env>, body: unknown) {
  const user = c.get('user');
  if (!user.consented_at) return { res: c.json({ error: 'no_consent', message: 'Please accept the consent screen first.' }, 403) };
  const fix = parseFix(body);
  if (typeof fix === 'string') return { res: c.json({ error: 'invalid', message: fix }, 400) };
  const verdict = classify(fix, await placesOf(user.id));
  if (verdict.blocked) {
    // Logged for HR (decided 2026-11-08). No photo is kept.
    await sql`
      insert into checkin_attempts (user_id, lat, lng, accuracy_m, mocked, reason, site_id, distance_m)
      values (${user.id}, ${fix.lat}, ${fix.lng}, ${fix.accuracy_m}, ${fix.mocked}, ${verdict.blocked}, ${verdict.site?.id ?? null}, ${verdict.distance_m})`;
    return {
      res: c.json({
        error: verdict.blocked,
        message: blockMessage(verdict.blocked, verdict.distance_m, verdict.site),
        distance_m: verdict.distance_m,
        site: verdict.site ? { id: verdict.site.id, name: verdict.site.name, kind: verdict.site.kind } : null,
      }, 403),
    };
  }
  return { fix, verdict };
}

// Step 0: "am I allowed here?" as soon as GPS is good, before the selfie. Server decides; logs if blocked.
app.post('/attendance/check', auth, async (c) => {
  const g = await gate(c, await c.req.json().catch(() => null));
  if ('res' in g) return g.res;
  const { site, distance_m, status } = g.verdict;
  return c.json({ ok: true, site: { id: site.id, name: site.name, kind: site.kind }, distance_m, status });
});

// Step 1: location checked again, then a one-time upload link for the selfie.
app.post('/selfie-upload-url', auth, async (c) => {
  const body = (await c.req.json().catch(() => null)) as { bytes?: unknown } | null;
  const bytes = body?.bytes;
  if (typeof bytes !== 'number' || !Number.isInteger(bytes) || bytes <= 0 || bytes > MAX_SELFIE_BYTES) {
    return c.json({ error: 'invalid', message: `bytes must be an integer between 1 and ${MAX_SELFIE_BYTES}` }, 400);
  }
  const g = await gate(c, body);
  if ('res' in g) return g.res;

  const user = c.get('user');
  const [done] = await sql`select 1 from attendance where user_id = ${user.id} and day = ${todayIst()}`;
  if (done) return c.json({ error: 'already_marked', message: 'Attendance is already marked for today.' }, 409);

  const key = newSelfieKey(user.id, istDay());
  // ponytail: the link can be re-used for its 5 minutes; fine for an MVP, use R2 object-lock if it matters.
  return c.json({ url: await uploadUrl(key, bytes), key, headers: { 'content-type': 'image/jpeg' } });
});

// Step 2: location checked a final time (authoritative), plus the selfie just uploaded.
app.post('/attendance', auth, async (c) => {
  const body = await c.req.json().catch(() => null);
  const user = c.get('user');
  const photoKey = (body as { photo_key?: unknown } | null)?.photo_key;
  if (!isOwnSelfieKey(photoKey, user.id, istDay()) || !(await exists(photoKey))) {
    return c.json({ error: 'photo_missing', message: 'Your photo did not upload. Please take it again.' }, 400);
  }

  const g = await gate(c, body);
  if ('res' in g) {
    await remove(photoKey).catch(() => undefined); // blocked → don't keep the selfie
    return g.res;
  }
  const { fix, verdict } = g;
  const [settings] = await sql<{ shift_start: string; grace_min: number }[]>`select shift_start::text, grace_min from settings where id = 1`;
  const late_min = minutesLate(new Date(), settings.shift_start, settings.grace_min);
  const address = await addressFor(fix.lat, fix.lng);

  const [row] = await sql`
    insert into attendance (user_id, day, lat, lng, accuracy_m, mocked, site_id, distance_m, photo_key, status, flags, address, late_min)
    values (${user.id}, ${todayIst()}, ${fix.lat}, ${fix.lng}, ${fix.accuracy_m}, ${fix.mocked},
            ${verdict.site.id}, ${verdict.distance_m}, ${photoKey}, ${verdict.status}, ${verdict.flags}, ${address}, ${late_min})
    on conflict (user_id, day) do nothing
    returning id`;

  if (!row) {
    await remove(photoKey).catch(() => undefined);
    const [existing] = await sql`select marked_at from attendance where user_id = ${user.id} and day = ${todayIst()}`;
    return c.json({ error: 'already_marked', message: 'Attendance is already marked for today.', marked_at: existing.marked_at }, 409);
  }
  const [saved] = await sql`
    select ${ATTENDANCE_COLUMNS} from attendance a left join sites s on s.id = a.site_id where a.id = ${row.id}`;
  return c.json({ attendance: await withPhoto(saved) }, 201);
});

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: 'server_error', message: 'Something went wrong. Please try again.' }, 500);
});
