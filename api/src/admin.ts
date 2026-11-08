// HR (admin) API. Every route: valid Auth0 token + `admin` role in that token (see http.adminOnly).
import { Hono } from 'hono';
import { Auth0Error, addRole, createLogin, passwordLink, setBlocked, setName } from './auth0-admin.js';
import { sql } from './db/index.js';
import { adminOnly, ATTENDANCE_COLUMNS, auth, DAY, holidayOn, holidaysIn, MONTH, placesOf, withPhoto, type Env } from './http.js';
import { csvRow, dayKind, FIXED_HOLIDAYS, monthDays, type Marked } from './rules.js';
import { embedJpeg, FACE_MATCH_THRESHOLD, faceProblem } from './face.js';
import { searchPlaces } from './places.js';
import { copy, exists, getBytes, isOwnProfileKey, istDay, MAX_SELFIE_BYTES, newProfileKey, remove, uploadUrl, viewUrl } from './storage.js';

export const admin = new Hono<Env>();
admin.use('*', auth, adminOnly);

// ---------- tiny input helpers (all admin input is untrusted too) ----------
type Body = Record<string, unknown>;
const body = async (c: { req: { json: () => Promise<unknown> } }) => ((await c.req.json().catch(() => null)) ?? {}) as Body;
const text = (v: unknown, max = 120) => (typeof v === 'string' && v.trim().length > 0 && v.trim().length <= max ? v.trim() : null);
const optText = (v: unknown, max = 120) => (v === null || v === '' ? null : text(v, max));
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const idParam = (v: string) => (/^\d+$/.test(v) ? Number(v) : null);
const bad = (message: string) => ({ error: 'invalid', message });

const joinedDay = (createdAt: Date) => istDay(createdAt);

// ---------- Dashboard: one day for everyone ----------

admin.get('/today', async (c) => {
  const date = c.req.query('date') ?? istDay();
  if (!DAY.test(date)) return c.json(bad('date must look like 2026-11-09'), 400);
  const today = istDay();

  const rows = await sql`
    select ${ATTENDANCE_COLUMNS},
           u.id as uid, u.name, u.email, u.employee_code, u.designation, u.created_at -- uid: a.user_id is null when not checked in
    from users u
    left join attendance a on a.user_id = u.id and a.day = ${date}
    left join sites s on s.id = a.site_id
    where u.active and (u.created_at at time zone 'Asia/Kolkata')::date <= ${date}
    order by a.marked_at nulls last, u.name`;

  const holiday = await holidayOn(date);
  const people = await Promise.all(rows.map(async (r) => {
    const kind = dayKind(date, today, joinedDay(r.created_at), (r.status as Marked | null) ?? undefined, holiday !== null);
    // HR sees "rejected" as its own state; the employee just sees absent.
    // HR always sees its own decision on the row; counting-wise a rejected Sunday/holiday is not an absence.
    const status = r.status === 'rejected' ? 'rejected' : kind === 'today' ? 'not_yet' : kind;
    return {
      user: { id: r.uid, name: r.name, email: r.email, employee_code: r.employee_code, designation: r.designation },
      status,
      attendance: r.id
        ? {
            id: r.id, marked_at: r.marked_at, status: r.status, late_min: r.late_min, flags: r.flags,
            site_name: r.site_name, site_kind: r.site_kind, distance_m: r.distance_m, accuracy_m: r.accuracy_m,
            address: r.address, thumb_url: await viewUrl(r.photo_key),
          }
        : null,
    };
  }));

  const n = (s: string) => people.filter((p) => p.status === s).length;
  const attempts = await sql`
    select t.id, t.at, t.reason, t.distance_m, t.accuracy_m, t.lat, t.lng, u.id as user_id, u.name, s.name as site_name, s.kind as site_kind
    from checkin_attempts t join users u on u.id = t.user_id left join sites s on s.id = t.site_id
    where (t.at at time zone 'Asia/Kolkata')::date = ${date}
    order by t.at desc limit 200`;
  const [settings] = await sql`select to_char(shift_start, 'HH24:MI') as shift_start, grace_min from settings where id = 1`;

  return c.json({
    date,
    settings,
    holiday,
    summary: {
      expected: people.filter((p) => p.status !== 'off' && p.status !== 'holiday').length,
      present: n('present') + n('flagged'),
      late: people.filter((p) => p.attendance && p.attendance.status !== 'rejected' && p.attendance.late_min > 0).length,
      flagged: n('flagged'),
      rejected: n('rejected'),
      absent: n('absent'),
      not_yet: n('not_yet'),
      off: n('off'),
      holiday: n('holiday'),
      blocked_attempts: attempts.length,
    },
    people,
    attempts,
  });
});

// Last N days: headcount vs present vs late (Sunday marked so charts can grey it out).
admin.get('/trend', async (c) => {
  const days = Math.min(90, Math.max(7, Number(c.req.query('days') ?? 30) || 30));
  const rows = await sql`
    with d as (
      select generate_series((now() at time zone 'Asia/Kolkata')::date - ${days - 1}::int,
                             (now() at time zone 'Asia/Kolkata')::date, interval '1 day')::date as day
    )
    select d.day::text as day, extract(dow from d.day)::int as weekday,
      (select h.name from holidays h where h.day = d.day) as holiday,
      (select count(*) from users u where u.active and (u.created_at at time zone 'Asia/Kolkata')::date <= d.day)::int as headcount,
      (select count(*) from attendance a where a.day = d.day and a.status in ('present', 'flagged'))::int as present,
      (select count(*) from attendance a where a.day = d.day and a.status in ('present', 'flagged') and a.late_min > 0)::int as late
    from d order by d.day`;
  // ponytail: headcount uses today's active list for past days; store daily snapshots if HR needs exact history.
  return c.json({ days: rows });
});

// Review queue: every "HR check" not decided yet (last 60 days), oldest first.
admin.get('/review', async (c) => {
  const rows = await sql`
    select ${ATTENDANCE_COLUMNS}, u.name, u.email, u.employee_code
    from attendance a join users u on u.id = a.user_id left join sites s on s.id = a.site_id
    where a.status = 'flagged' and a.day > (now() at time zone 'Asia/Kolkata')::date - 60
    order by a.day, a.marked_at`;
  return c.json({ items: await Promise.all(rows.map(async ({ photo_key, ...r }) => ({ ...r, thumb_url: await viewUrl(photo_key) }))) });
});

// ---------- One check-in: photo, map data, the person's places, that day's blocked attempts ----------

admin.get('/attendance/:id', async (c) => {
  const id = idParam(c.req.param('id'));
  if (!id) return c.json(bad('bad id'), 400);
  const [row] = await sql`
    select ${ATTENDANCE_COLUMNS}, u.name, u.email, u.employee_code, u.photo_key as profile_photo_key, r.name as reviewed_by_name
    from attendance a join users u on u.id = a.user_id
    left join sites s on s.id = a.site_id left join users r on r.id = a.reviewed_by
    where a.id = ${id}`;
  if (!row) return c.json({ error: 'not_found', message: 'No such check-in.' }, 404);
  const attempts = await sql`
    select t.at, t.reason, t.distance_m, t.lat, t.lng, s.name as site_name
    from checkin_attempts t left join sites s on s.id = t.site_id
    where t.user_id = ${row.user_id} and (t.at at time zone 'Asia/Kolkata')::date = ${row.day}
    order by t.at`;
  const { profile_photo_key, ...rest } = row;
  return c.json({
    attendance: await withPhoto(rest),
    profile_photo_url: profile_photo_key ? await viewUrl(profile_photo_key) : null,
    face_threshold: FACE_MATCH_THRESHOLD,
    places: await placesOf(row.user_id),
    attempts,
  });
});

// HR review: approve (counts present) or reject (counts absent, reason required). Who/when/why is stored.
admin.patch('/attendance/:id', async (c) => {
  const id = idParam(c.req.param('id'));
  const b = await body(c);
  if (!id || (b.decision !== 'approve' && b.decision !== 'reject')) return c.json(bad('decision must be approve or reject'), 400);
  const note = optText(b.note, 500);
  if (b.decision === 'reject' && !note) return c.json(bad('Please write why this check-in is rejected.'), 400);
  const [row] = await sql`
    update attendance set status = ${b.decision === 'approve' ? 'present' : 'rejected'},
      reviewed_by = ${c.get('user').id}, reviewed_at = now(), review_note = ${note}
    where id = ${id} returning id, status, reviewed_at, review_note`;
  return row ? c.json({ attendance: row }) : c.json({ error: 'not_found', message: 'No such check-in.' }, 404);
});

// ---------- Monthly register + CSV ----------

async function register(month: string) {
  const today = istDay();
  const people = await sql`
    select id, name, email, employee_code, designation, created_at from users
    where active and to_char((created_at at time zone 'Asia/Kolkata')::date, 'YYYY-MM') <= ${month}
    order by name`;
  const rows = await sql`
    select ${ATTENDANCE_COLUMNS} from attendance a left join sites s on s.id = a.site_id
    where to_char(a.day, 'YYYY-MM') = ${month}`;
  const holidays = await holidaysIn(month);
  const byUser = new Map<number, (typeof rows)[number][]>();
  for (const r of rows) {
    const list = byUser.get(r.user_id) ?? [];
    list.push(r);
    byUser.set(r.user_id, list);
  }

  return people.map((p) => {
    const mine = byUser.get(p.id) ?? [];
    const byDay = new Map(mine.map((r) => [r.day as string, r]));
    const days = monthDays(month, today, joinedDay(p.created_at), new Map(mine.map((r) => [r.day as string, r.status as Marked])), holidays).map((d) => {
      const r = byDay.get(d.day);
      return { ...d, rejected: r?.status === 'rejected' && d.kind === 'absent', late_min: r && r.status !== 'rejected' ? r.late_min : 0, attendance_id: r?.id ?? null, record: r ?? null };
    });
    const count = (k: string) => days.filter((d) => d.kind === k).length;
    const present = count('present') + count('flagged');
    const worked = present + count('absent');
    return {
      user: { id: p.id, name: p.name, email: p.email, employee_code: p.employee_code, designation: p.designation },
      days,
      summary: {
        present, absent: count('absent'), flagged: count('flagged'),
        late: days.filter((d) => d.late_min > 0).length,
        percent: worked ? Math.round((present / worked) * 100) : null,
      },
    };
  });
}

admin.get('/register', async (c) => {
  const month = c.req.query('month') ?? istDay().slice(0, 7);
  if (!MONTH.test(month)) return c.json(bad('month must look like 2026-11'), 400);
  const people = (await register(month)).map((p) => ({ ...p, days: p.days.map(({ record: _r, ...d }) => d) }));
  return c.json({ month, people });
});

admin.get('/export.csv', async (c) => {
  const month = c.req.query('month') ?? istDay().slice(0, 7);
  if (!MONTH.test(month)) return c.json(bad('month must look like 2026-11'), 400);
  const ist = (d: Date) => d.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true });
  const word: Record<string, string> = { present: 'Present', flagged: 'Present (HR check)', absent: 'Absent', off: 'Weekly off', today: 'Not marked yet' };
  const lines = [csvRow(['Date', 'Employee code', 'Name', 'Email', 'Status', 'Check-in (IST)', 'Late (min)', 'Place', 'Distance (m)', 'Address', 'Latitude', 'Longitude', 'HR note'])];
  for (const p of await register(month)) {
    for (const d of p.days) {
      if (d.kind === 'future' || d.kind === 'before_joining') continue;
      const r = d.record;
      lines.push(csvRow([
        d.day, p.user.employee_code, p.user.name, p.user.email,
        d.rejected ? 'Absent (rejected by HR)' : d.kind === 'holiday' ? `Holiday: ${d.holiday}` : word[d.kind] ?? d.kind,
        r && !d.rejected ? ist(r.marked_at) : '', d.late_min || '',
        r ? (r.site_kind === 'home' ? 'Home (WFH)' : r.site_name) : '', r?.distance_m ?? '', r?.address ?? '',
        r?.lat ?? '', r?.lng ?? '', r?.review_note ?? '',
      ]));
    }
  }
  c.header('content-type', 'text/csv; charset=utf-8');
  c.header('content-disposition', `attachment; filename="geomark-attendance-${month}.csv"`);
  return c.body('﻿' + lines.join('\r\n')); // BOM so Excel reads ₹/Hindi names correctly
});

// ---------- Employees ----------

admin.get('/employees', async (c) => {
  const rows = await sql`
    select u.id, u.name, u.email, u.employee_code, u.phone, u.designation, u.role, u.active, u.created_at, u.photo_key,
      coalesce(json_agg(json_build_object('id', s.id, 'name', s.name, 'kind', s.kind) order by s.kind, s.name)
               filter (where s.id is not null), '[]') as places,
      (select max(a.marked_at) from attendance a where a.user_id = u.id and a.status <> 'rejected') as last_check_in
    from users u left join user_sites us on us.user_id = u.id left join sites s on s.id = us.site_id
    group by u.id order by u.active desc, u.name`;
  const employees = await Promise.all(rows.map(async ({ photo_key, ...e }) => ({ ...e, photo_url: photo_key ? await viewUrl(photo_key) : null })));
  return c.json({ employees });
});

admin.get('/employees/:id', async (c) => {
  const id = idParam(c.req.param('id'));
  const month = c.req.query('month') ?? istDay().slice(0, 7);
  if (!id || !MONTH.test(month)) return c.json(bad('bad id or month'), 400);
  const [u] = await sql`
    select id, name, email, employee_code, phone, designation, role, active, created_at, consented_at,
      photo_key, photo_updated_at, face_embedding is not null as has_face
    from users where id = ${id}`;
  if (!u) return c.json({ error: 'not_found', message: 'No such employee.' }, 404);
  const mine = (await register(month)).find((p) => p.user.id === id);
  const attempts = await sql`
    select t.at, t.reason, t.distance_m, s.name as site_name from checkin_attempts t left join sites s on s.id = t.site_id
    where t.user_id = ${id} and t.at > now() - interval '30 days' order by t.at desc limit 50`;
  const { photo_key, ...employee } = u;
  return c.json({
    employee: { ...employee, photo_url: photo_key ? await viewUrl(photo_key) : null },
    places: await placesOf(id),
    month,
    days: mine?.days.map(({ record, ...d }) => ({ ...d, marked_at: record?.marked_at ?? null, site_name: record?.site_name ?? null, site_kind: record?.site_kind ?? null, distance_m: record?.distance_m ?? null })) ?? [],
    summary: mine?.summary ?? null,
    attempts,
  });
});

async function setPlaces(userId: number, siteIds: unknown) {
  if (!Array.isArray(siteIds) || !siteIds.every((s) => Number.isInteger(s))) throw new Error('site_ids must be a list of place ids');
  await sql.begin(async (tx) => {
    await tx`delete from user_sites where user_id = ${userId}`;
    if (siteIds.length) await tx`insert into user_sites ${tx(siteIds.map((site_id: number) => ({ user_id: userId, site_id })))}`;
  });
}

admin.post('/employees', async (c) => {
  const b = await body(c);
  const name = text(b.name, 80);
  const email = typeof b.email === 'string' && EMAIL.test(b.email.trim()) ? b.email.trim().toLowerCase() : null;
  const role = b.role === 'admin' ? 'admin' : 'employee';
  if (!name || !email) return c.json(bad('Name and a valid email are required.'), 400);
  const [dupe] = await sql`select id from users where lower(email) = ${email}`;
  if (dupe) return c.json({ error: 'exists', message: 'An employee with this email already exists.' }, 409);

  let login;
  try {
    login = await createLogin(email, name, role);
  } catch (e) {
    if (e instanceof Auth0Error && e.status === 409) return c.json({ error: 'exists', message: 'This email already has a GeoMark login.' }, 409);
    throw e;
  }
  const [u] = await sql`
    insert into users (auth0_sub, email, name, role, employee_code, phone, designation)
    values (${login.auth0_sub}, ${email}, ${name}, ${role}, ${optText(b.employee_code, 40)}, ${optText(b.phone, 30)}, ${optText(b.designation, 80)})
    returning id, name, email, role`;
  if (b.site_ids !== undefined) await setPlaces(u.id, b.site_ids);
  // The link is shown to HR once, to send to the person (WhatsApp/email). Valid 7 days.
  return c.json({ employee: u, set_password_link: login.set_password_link }, 201);
});

admin.patch('/employees/:id', async (c) => {
  const id = idParam(c.req.param('id'));
  if (!id) return c.json(bad('bad id'), 400);
  const b = await body(c);
  const [u] = await sql`select id, auth0_sub, name, role, active from users where id = ${id}`;
  if (!u) return c.json({ error: 'not_found', message: 'No such employee.' }, 404);
  const me = c.get('user');

  if (b.active === false && id === me.id) return c.json(bad("You can't turn off your own account."), 400);
  if (b.role === 'employee' && u.role === 'admin') {
    return c.json(bad('Removing admin access is done in the Auth0 dashboard (User Management → Users → Roles).'), 400);
  }

  const patch: Record<string, unknown> = {};
  if (b.name !== undefined) { const v = text(b.name, 80); if (!v) return c.json(bad('Name is required.'), 400); patch.name = v; }
  for (const [k, max] of [['employee_code', 40], ['phone', 30], ['designation', 80]] as const) {
    if (b[k] !== undefined) patch[k] = optText(b[k], max);
  }
  if (typeof b.active === 'boolean') patch.active = b.active;
  if (b.role === 'admin') patch.role = 'admin';

  // Auth0 first, so a failure there leaves our database unchanged.
  if (patch.name && patch.name !== u.name) await setName(u.auth0_sub, patch.name as string);
  if (typeof patch.active === 'boolean' && patch.active !== u.active) await setBlocked(u.auth0_sub, !patch.active);
  if (patch.role === 'admin' && u.role !== 'admin') await addRole(u.auth0_sub, 'admin');

  if (Object.keys(patch).length) await sql`update users set ${sql(patch)} where id = ${id}`;
  if (patch.active === false) await clearPhoto(id); // DPDP: no face data kept for people who left
  if (b.site_ids !== undefined) {
    try { await setPlaces(id, b.site_ids); } catch (e) { return c.json(bad((e as Error).message), 400); }
  }
  const [out] = await sql`select id, name, email, employee_code, phone, designation, role, active from users where id = ${id}`;
  return c.json({ employee: out, places: await placesOf(id) });
});

// Bulk: add or remove one place for many people at once.
admin.post('/employees/bulk-places', async (c) => {
  const b = await body(c);
  const ids = Array.isArray(b.user_ids) ? b.user_ids.filter((x) => Number.isInteger(x)) as number[] : [];
  if (!ids.length || ids.length > 500 || !Number.isInteger(b.site_id) || (b.action !== 'add' && b.action !== 'remove')) {
    return c.json(bad('Pick people, a place, and add or remove.'), 400);
  }
  const [site] = await sql`select id, name from sites where id = ${b.site_id as number}`;
  if (!site) return c.json({ error: 'not_found', message: 'No such place.' }, 404);
  const changed = b.action === 'add'
    ? await sql`insert into user_sites ${sql(ids.map((user_id) => ({ user_id, site_id: site.id })))} on conflict do nothing returning user_id`
    : await sql`delete from user_sites where site_id = ${site.id} and user_id in ${sql(ids)} returning user_id`;
  return c.json({ place: site.name, action: b.action, changed: changed.length });
});

// ---------- Employee photo (also the face reference) ----------

async function clearPhoto(userId: number) {
  const [old] = await sql`select photo_key from users where id = ${userId}`;
  await sql`update users set photo_key = null, face_embedding = null, photo_updated_at = null where id = ${userId}`;
  if (old?.photo_key) await remove(old.photo_key).catch(() => undefined);
}

// Step 1: a 5-minute upload link for a new photo (the browser resizes it to a small JPEG first).
admin.post('/employees/:id/photo-upload-url', async (c) => {
  const id = idParam(c.req.param('id'));
  const bytes = (await body(c)).bytes;
  if (!id || typeof bytes !== 'number' || !Number.isInteger(bytes) || bytes <= 0 || bytes > MAX_SELFIE_BYTES) return c.json(bad('Photo must be under 2 MB.'), 400);
  const key = newProfileKey(id);
  return c.json({ url: await uploadUrl(key, bytes), key });
});

// Step 2: use an uploaded photo ({key}) or one of their check-in selfies ({attendance_id}).
// It must show exactly one clear face; its fingerprint becomes the face reference for check-ins.
admin.post('/employees/:id/photo', async (c) => {
  const id = idParam(c.req.param('id'));
  const b = await body(c);
  if (!id) return c.json(bad('bad id'), 400);
  const [u] = await sql`select id, active from users where id = ${id}`;
  if (!u) return c.json({ error: 'not_found', message: 'No such employee.' }, 404);
  if (!u.active) return c.json(bad('Turn the person back on first.'), 400);

  let key: string;
  if (Number.isInteger(b.attendance_id)) {
    const [a] = await sql`select photo_key from attendance where id = ${b.attendance_id as number} and user_id = ${id}`;
    if (!a) return c.json({ error: 'not_found', message: 'That check-in isn’t theirs.' }, 404);
    key = newProfileKey(id);
    await copy(a.photo_key, key); // selfies are deleted after 90 days; the profile copy stays
  } else if (isOwnProfileKey(b.key, id) && (await exists(b.key))) {
    key = b.key;
  } else {
    return c.json(bad('Upload the photo first.'), 400);
  }

  const face = await embedJpeg(await getBytes(key));
  if (!face) {
    await remove(key).catch(() => undefined);
    return c.json({ error: 'face_service_down', message: 'Face check is unavailable right now. Try again in a minute.' }, 503);
  }
  const problem = faceProblem(face);
  if (problem || !face.embedding) {
    await remove(key).catch(() => undefined);
    return c.json({ error: 'face_unusable', message: face.faces === 0 ? 'No clear face found in this photo. Use a front-facing photo in good light.' : 'This photo has more than one face. Use a photo of just this person.' }, 400);
  }
  const [old] = await sql`select photo_key from users where id = ${id}`;
  await sql`update users set photo_key = ${key}, face_embedding = ${face.embedding}, photo_updated_at = now() where id = ${id}`;
  if (old?.photo_key && old.photo_key !== key) await remove(old.photo_key).catch(() => undefined);
  return c.json({ photo_url: await viewUrl(key) });
});

admin.delete('/employees/:id/photo', async (c) => {
  const id = idParam(c.req.param('id'));
  if (!id) return c.json(bad('bad id'), 400);
  await clearPhoto(id);
  return c.json({ deleted: true });
});

admin.post('/employees/:id/password-link', async (c) => {
  const id = idParam(c.req.param('id'));
  const [u] = id ? await sql`select auth0_sub from users where id = ${id}` : [];
  if (!u) return c.json({ error: 'not_found', message: 'No such employee.' }, 404);
  return c.json({ set_password_link: await passwordLink(u.auth0_sub) });
});

// ---------- Places (offices, branches, homes) ----------

const placeInput = (b: Body, partial: boolean) => {
  const out: Record<string, unknown> = {};
  if (!partial || b.name !== undefined) { const v = text(b.name, 80); if (!v) return 'Name is required.'; out.name = v; }
  if (!partial || b.kind !== undefined) { if (b.kind !== 'office' && b.kind !== 'home') return 'kind must be office or home'; out.kind = b.kind; }
  if (!partial || b.lat !== undefined) { if (typeof b.lat !== 'number' || b.lat < -90 || b.lat > 90) return 'Pick the place on the map.'; out.lat = b.lat; }
  if (!partial || b.lng !== undefined) { if (typeof b.lng !== 'number' || b.lng < -180 || b.lng > 180) return 'Pick the place on the map.'; out.lng = b.lng; }
  if (!partial || b.radius_m !== undefined) {
    if (!Number.isInteger(b.radius_m) || (b.radius_m as number) < 10 || (b.radius_m as number) > 5000) return 'Radius must be 10 to 5000 metres.';
    out.radius_m = b.radius_m;
  }
  return out;
};

admin.get('/sites', async (c) => {
  const rows = await sql`
    select s.id, s.name, s.kind, s.lat, s.lng, s.radius_m,
      coalesce(json_agg(json_build_object('id', u.id, 'name', u.name) order by u.name) filter (where u.id is not null), '[]') as people
    from sites s left join user_sites us on us.site_id = s.id left join users u on u.id = us.user_id and u.active
    group by s.id order by s.kind, s.name`;
  return c.json({ sites: rows });
});

admin.post('/sites', async (c) => {
  const b = await body(c);
  const p = placeInput(b, false);
  if (typeof p === 'string') return c.json(bad(p), 400);
  const [site] = await sql`insert into sites ${sql(p)} returning id, name, kind, lat, lng, radius_m`;
  // A home is usually created for one person: assign straight away.
  if (Array.isArray(b.user_ids) && b.user_ids.every((x) => Number.isInteger(x)) && b.user_ids.length) {
    await sql`insert into user_sites ${sql((b.user_ids as number[]).map((user_id) => ({ user_id, site_id: site.id })))} on conflict do nothing`;
  }
  return c.json({ site }, 201);
});

admin.patch('/sites/:id', async (c) => {
  const id = idParam(c.req.param('id'));
  const p = placeInput(await body(c), true);
  if (!id) return c.json(bad('bad id'), 400);
  if (typeof p === 'string') return c.json(bad(p), 400);
  if (!Object.keys(p).length) return c.json(bad('Nothing to change.'), 400);
  const [site] = await sql`update sites set ${sql(p)} where id = ${id} returning id, name, kind, lat, lng, radius_m`;
  return site ? c.json({ site }) : c.json({ error: 'not_found', message: 'No such place.' }, 404);
});

admin.delete('/sites/:id', async (c) => {
  const id = idParam(c.req.param('id'));
  if (!id) return c.json(bad('bad id'), 400);
  const [used] = await sql`select 1 from attendance where site_id = ${id} limit 1`;
  if (used) return c.json({ error: 'in_use', message: 'Past check-ins happened here, so it can\'t be deleted. Unassign everyone instead.' }, 409);
  const [gone] = await sql`delete from sites where id = ${id} returning id`;
  return gone ? c.json({ deleted: id }) : c.json({ error: 'not_found', message: 'No such place.' }, 404);
});

// Place picker search: pasted coordinates / Google Maps link → that point; else Mappls, then OpenStreetMap.
admin.get('/geocode', async (c) => {
  const q = text(c.req.query('q'), 300);
  if (!q) return c.json({ results: [] });
  return c.json(await searchPlaces(q));
});

// ---------- Holidays ----------

admin.get('/holidays', async (c) => {
  const year = c.req.query('year') ?? istDay().slice(0, 4);
  if (!/^\d{4}$/.test(year)) return c.json(bad('year must look like 2026'), 400);
  const rows = await sql`
    select h.day::text as day, h.name, u.name as added_by from holidays h left join users u on u.id = h.created_by
    where extract(year from h.day) = ${Number(year)} order by h.day`;
  return c.json({ year, holidays: rows });
});

admin.post('/holidays', async (c) => {
  const b = await body(c);
  const name = text(b.name, 80);
  if (typeof b.day !== 'string' || !DAY.test(b.day) || Number.isNaN(Date.parse(b.day))) return c.json(bad('Pick a date.'), 400);
  if (!name) return c.json(bad('Give the holiday a name, e.g. Diwali.'), 400);
  const [h] = await sql`
    insert into holidays (day, name, created_by) values (${b.day}, ${name}, ${c.get('user').id})
    on conflict (day) do update set name = excluded.name
    returning day::text as day, name`;
  return c.json({ holiday: h }, 201);
});

// One click: the fixed-date national holidays for a year (skips dates HR already set).
admin.post('/holidays/fixed', async (c) => {
  const year = String((await body(c)).year ?? '');
  if (!/^\d{4}$/.test(year)) return c.json(bad('year must look like 2026'), 400);
  const rows = FIXED_HOLIDAYS.map(([md, name]) => ({ day: `${year}-${md}`, name, created_by: c.get('user').id }));
  const added = await sql`insert into holidays ${sql(rows)} on conflict (day) do nothing returning day::text as day, name`;
  return c.json({ added });
});

admin.delete('/holidays/:day', async (c) => {
  const day = c.req.param('day');
  if (!DAY.test(day)) return c.json(bad('bad date'), 400);
  const [gone] = await sql`delete from holidays where day = ${day} returning day::text as day`;
  return gone ? c.json({ deleted: day }) : c.json({ error: 'not_found', message: 'No holiday on that date.' }, 404);
});

// ---------- Settings ----------

admin.get('/settings', async (c) => {
  const [s] = await sql`select to_char(shift_start, 'HH24:MI') as shift_start, grace_min from settings where id = 1`;
  return c.json({ settings: s });
});

admin.patch('/settings', async (c) => {
  const b = await body(c);
  if (typeof b.shift_start !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(b.shift_start)) return c.json(bad('Shift start must look like 09:30'), 400);
  if (!Number.isInteger(b.grace_min) || (b.grace_min as number) < 0 || (b.grace_min as number) > 240) return c.json(bad('Grace must be 0 to 240 minutes.'), 400);
  const [s] = await sql`
    update settings set shift_start = ${b.shift_start}::time, grace_min = ${b.grace_min as number} where id = 1
    returning to_char(shift_start, 'HH24:MI') as shift_start, grace_min`;
  return c.json({ settings: s }); // applies to new check-ins only; history keeps the late value it was saved with
});
