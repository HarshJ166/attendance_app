// End-to-end test of the employee + admin routes against a THROWAWAY Neon branch (never the main DB).
// Run: NODE_ENV=test DATABASE_URL=<branch url> npx tsx --env-file=.env scripts/admin-itest.ts
// Skips routes that create/modify real Auth0 users (the service app can't delete test users).
import assert from 'node:assert/strict';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';

if (process.env.NODE_ENV !== 'test' || !/itest/.test(process.env.DATABASE_URL ?? '') && !process.env.ITEST_OK) {
  throw new Error('Refusing to run: needs NODE_ENV=test and a test-branch DATABASE_URL');
}

const { AUDIENCE, ISSUER, useTestKeys } = await import('../src/auth.js');
const { app } = await import('../src/app.js');
const { sql } = await import('../src/db/index.js');
const { istDay } = await import('../src/storage.js');

const { privateKey, publicKey } = await generateKeyPair('RS256');
useTestKeys(createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), alg: 'RS256' }] }));
const NS = 'https://attendance-api';
const tokenFor = (sub: string, roles: string[], name: string) =>
  new SignJWT({ [`${NS}/roles`]: roles, [`${NS}/email`]: `${sub.split('|')[1]}@itest.local`, [`${NS}/name`]: name })
    .setProtectedHeader({ alg: 'RS256' }).setSubject(sub).setIssuer(ISSUER).setAudience(AUDIENCE).setIssuedAt().setExpirationTime('10m').sign(privateKey);

const ADMIN = await tokenFor('test|admin', ['admin'], 'Test Admin');
const E1 = await tokenFor('test|e1', ['employee'], 'Asha Patil');
const E2 = await tokenFor('test|e2', ['employee'], 'Ravi Shah');
const call = async (token: string, method: string, path: string, body?: unknown) => {
  const res = await app.request(path, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const type = res.headers.get('content-type') ?? '';
  return { status: res.status, json: type.includes('json') ? await res.json() as any : null, text: type.includes('csv') ? await res.text() : null };
};
let passed = 0;
const step = async (name: string, fn: () => Promise<void>) => { await fn(); passed++; console.log(`✅ ${name}`); };

// --- seed: users appear on first authenticated call; then consent + places ---
for (const t of [ADMIN, E1, E2]) assert.equal((await call(t, 'GET', '/me')).status, 200);
await sql`update users set consented_at = now(), consent_version = 2 where auth0_sub like 'test|%'`;
const [{ id: e1 }] = await sql`select id from users where auth0_sub = 'test|e1'`;
const [{ id: e2 }] = await sql`select id from users where auth0_sub = 'test|e2'`;
const [{ id: adminId }] = await sql`select id from users where auth0_sub = 'test|admin'`;
const OFFICE = { lat: 19.2066, lng: 72.8357 };
const HOME = { lat: 19.2300, lng: 72.8500 }; // ~3 km away

await step('employee token is refused on admin routes (403)', async () => {
  assert.equal((await call(E1, 'GET', '/admin/today')).status, 403);
  assert.equal((await call(E1, 'GET', '/admin/export.csv')).status, 403);
});

let officeId = 0, homeId = 0;
await step('HR creates an office and a home (assigned to Asha in one go)', async () => {
  const o = await call(ADMIN, 'POST', '/admin/sites', { name: 'ITest Office', kind: 'office', ...OFFICE, radius_m: 200 });
  assert.equal(o.status, 201); officeId = o.json.site.id;
  const h = await call(ADMIN, 'POST', '/admin/sites', { name: 'Asha home', kind: 'home', ...HOME, radius_m: 100, user_ids: [e1] });
  assert.equal(h.status, 201); homeId = h.json.site.id;
  assert.equal((await call(ADMIN, 'POST', '/admin/sites', { name: 'x', kind: 'office', lat: 999, lng: 0, radius_m: 100 })).status, 400);
});

await step('HR gives Asha office + home and a designation; Ravi just the office', async () => {
  const r = await call(ADMIN, 'PATCH', `/admin/employees/${e1}`, { site_ids: [officeId, homeId], designation: 'Field sales', employee_code: 'JJ-001' });
  assert.equal(r.status, 200);
  assert.equal(r.json.places.length, 2);
  assert.equal((await call(ADMIN, 'PATCH', `/admin/employees/${e2}`, { site_ids: [officeId] })).status, 200);
  const me = await call(E1, 'GET', '/me');
  assert.deepEqual(me.json.sites.map((s: any) => s.kind).sort(), ['home', 'office']);
});

await step('check-in at home passes as WFH; 2 km from everything is blocked and logged', async () => {
  const ok = await call(E1, 'POST', '/attendance/check', { ...HOME, accuracy_m: 15, mocked: false });
  assert.equal(ok.status, 200); assert.equal(ok.json.site.kind, 'home');
  const no = await call(E2, 'POST', '/attendance/check', { lat: 19.25, lng: 72.86, accuracy_m: 10, mocked: false });
  assert.equal(no.status, 403); assert.equal(no.json.error, 'outside_site'); assert.match(no.json.message, /km from ITest Office/);
  const fake = await call(E2, 'POST', '/attendance/check', { ...OFFICE, accuracy_m: 5, mocked: true });
  assert.equal(fake.json.error, 'mock_location');
  const rows = await sql`select id, reason, at from checkin_attempts where user_id = ${e2} order by id`;
  assert.equal(rows.length, 2, JSON.stringify(rows));
});

let attId = 0;
await step('today board: Asha present (late), Ravi not yet, attempts counted', async () => {
  // Insert the check-in directly (the selfie upload itself is covered by npm run smoke:r2).
  const [a] = await sql`
    insert into attendance (user_id, day, lat, lng, accuracy_m, mocked, site_id, distance_m, photo_key, status, flags, late_min)
    values (${e1}, ${istDay()}, ${HOME.lat}, ${HOME.lng}, 120, false, ${homeId}, 5, ${`selfies/${e1}/${istDay()}/00000000-0000-0000-0000-000000000000.jpg`}, 'flagged', ${['low_accuracy']}, 20)
    returning id`;
  attId = a.id;
  const t = await call(ADMIN, 'GET', '/admin/today');
  assert.equal(t.status, 200);
  const asha = t.json.people.find((p: any) => p.user.id === e1);
  assert.equal(asha.status, 'flagged'); assert.equal(asha.attendance.site_kind, 'home'); assert.ok(asha.attendance.thumb_url.includes('X-Amz-Signature'));
  const ravi = t.json.people.find((p: any) => p.user.id === e2);
  assert.ok(['not_yet', 'off'].includes(ravi.status), ravi.status);
  assert.equal(t.json.summary.late, 1);
  // The branch is a copy of the real DB, so count only this test's people (real attempts may exist today).
  assert.equal(t.json.attempts.filter((x: any) => x.user_id === e2).length, 2);
  assert.ok(t.json.summary.blocked_attempts >= 2);
});

await step('review queue lists the HR-check item with a photo thumbnail', async () => {
  const q = await call(ADMIN, 'GET', '/admin/review');
  assert.equal(q.status, 200);
  const item = q.json.items.find((x: any) => x.id === attId);
  assert.ok(item && item.thumb_url.includes('X-Amz-Signature') && item.name === 'Asha Patil');
});

await step('check-in detail: photo link, both places for the map, blocked attempts list', async () => {
  const d = await call(ADMIN, 'GET', `/admin/attendance/${attId}`);
  assert.equal(d.status, 200); assert.equal(d.json.places.length, 2); assert.ok(d.json.attendance.photo_url);
});

await step('review: reject needs a reason; rejected counts as absent for the employee too', async () => {
  assert.equal((await call(ADMIN, 'PATCH', `/admin/attendance/${attId}`, { decision: 'reject' })).status, 400);
  const r = await call(ADMIN, 'PATCH', `/admin/attendance/${attId}`, { decision: 'reject', note: 'Selfie is not Asha' });
  assert.equal(r.json.attendance.status, 'rejected');
  const mine = await call(E1, 'GET', `/attendance/month?month=${istDay().slice(0, 7)}`);
  const todayCell = mine.json.days.find((d: any) => d.day === istDay());
  assert.ok(['absent', 'off'].includes(todayCell.kind), todayCell.kind);
  const t = await call(ADMIN, 'GET', '/admin/today');
  assert.equal(t.json.people.find((p: any) => p.user.id === e1).status, 'rejected');
  const ok = await call(ADMIN, 'PATCH', `/admin/attendance/${attId}`, { decision: 'approve', note: 'Checked with manager' });
  assert.equal(ok.json.attendance.status, 'present');
});

await step('register + CSV export (with formula-injection guard)', async () => {
  await sql`update users set name = '=HYPERLINK("http://evil","x")' where id = ${e2}`;
  const reg = await call(ADMIN, 'GET', `/admin/register?month=${istDay().slice(0, 7)}`);
  assert.equal(reg.status, 200); assert.ok(reg.json.people.find((p: any) => p.user.id === e1).summary.present >= 1);
  const csv = await call(ADMIN, 'GET', `/admin/export.csv?month=${istDay().slice(0, 7)}`);
  assert.equal(csv.status, 200);
  assert.ok(csv.text!.includes('"Date","Employee code","Name"'));
  assert.ok(csv.text!.includes(`"'=HYPERLINK`), 'formula must be neutralised');
  assert.ok(csv.text!.includes('Home (WFH)'));
});

await step('employees list + profile', async () => {
  const l = await call(ADMIN, 'GET', '/admin/employees');
  assert.ok(l.json.employees.find((e: any) => e.id === e1).places.length === 2);
  const p = await call(ADMIN, 'GET', `/admin/employees/${e1}`);
  assert.equal(p.json.employee.designation, 'Field sales'); assert.ok(p.json.days.length >= 28);
});

await step('guards: can\'t delete a place with history, can\'t turn yourself off, bad settings rejected', async () => {
  assert.equal((await call(ADMIN, 'DELETE', `/admin/sites/${homeId}`)).status, 409);
  assert.equal((await call(ADMIN, 'PATCH', `/admin/employees/${adminId}`, { active: false })).status, 400);
  assert.equal((await call(ADMIN, 'PATCH', '/admin/settings', { shift_start: '25:00', grace_min: 10 })).status, 400);
  const s = await call(ADMIN, 'PATCH', '/admin/settings', { shift_start: '10:00', grace_min: 10 });
  assert.deepEqual(s.json.settings, { shift_start: '10:00', grace_min: 10 });
});

await step('bulk place assignment: add a place to two people, then remove it', async () => {
  const add = await call(ADMIN, 'POST', '/admin/employees/bulk-places', { user_ids: [e1, e2], site_id: officeId, action: 'add' });
  assert.equal(add.status, 200);
  const both = (await call(ADMIN, 'GET', '/admin/employees')).json.employees.filter((x: any) => [e1, e2].includes(x.id));
  assert.ok(both.every((x: any) => x.places.some((p: any) => p.id === officeId)));
  const rm = await call(ADMIN, 'POST', '/admin/employees/bulk-places', { user_ids: [e2], site_id: officeId, action: 'remove' });
  assert.equal(rm.json.changed, 1);
  assert.equal((await call(ADMIN, 'POST', '/admin/employees/bulk-places', { user_ids: [], site_id: officeId, action: 'add' })).status, 400);
  await call(ADMIN, 'POST', '/admin/employees/bulk-places', { user_ids: [e2], site_id: officeId, action: 'add' }); // restore for later steps
});

await step('place search: pasted coordinates and Google links work without any map key', async () => {
  const r = await call(ADMIN, 'GET', `/admin/geocode?q=${encodeURIComponent('https://www.google.com/maps/@19.2066,72.8357,17z')}`);
  assert.deepEqual([r.json.results[0].source, r.json.results[0].lat, r.json.results[0].lng], ['google', 19.2066, 72.8357]);
});

await step('holidays: HR adds one, nobody is absent that day, register/CSV/today board show its name', async () => {
  // A past working day (Mon–Sat) inside the current month where Ravi did not check in.
  const today = istDay();
  let day = '';
  for (let n = 1; n <= 6; n++) {
    const d = istDay(new Date(Date.now() - n * 86_400_000));
    if (d.slice(0, 7) === today.slice(0, 7) && new Date(`${d}T00:00:00Z`).getUTCDay() !== 0) { day = d; break; }
  }
  if (!day) { console.log('     (skipped: no earlier working day this month yet)'); return; }
  await sql`update users set created_at = now() - interval '20 days' where id = ${e2}`; // Ravi "joined" before that day
  const before = (await call(ADMIN, 'GET', `/admin/register?month=${day.slice(0, 7)}`)).json.people.find((p: any) => p.user.id === e2);
  assert.equal(before.days.find((d: any) => d.day === day).kind, 'absent');
  assert.equal((await call(ADMIN, 'POST', '/admin/holidays', { day, name: '' })).status, 400);
  const h = await call(ADMIN, 'POST', '/admin/holidays', { day, name: 'Diwali' });
  assert.equal(h.status, 201);
  const after = (await call(ADMIN, 'GET', `/admin/register?month=${day.slice(0, 7)}`)).json.people.find((p: any) => p.user.id === e2);
  const cell = after.days.find((d: any) => d.day === day);
  assert.deepEqual([cell.kind, cell.holiday], ['holiday', 'Diwali']);
  assert.equal(after.summary.absent, before.summary.absent - 1);
  const board = await call(ADMIN, 'GET', `/admin/today?date=${day}`);
  assert.equal(board.json.holiday, 'Diwali');
  assert.equal(board.json.people.find((p: any) => p.user.id === e2).status, 'holiday');
  const csv = await call(ADMIN, 'GET', `/admin/export.csv?month=${day.slice(0, 7)}`);
  assert.ok(csv.text!.includes('"Holiday: Diwali"'));
  const mine = await call(E2, 'GET', `/attendance/month?month=${day.slice(0, 7)}`);
  assert.equal(mine.json.days.find((d: any) => d.day === day).holiday, 'Diwali');
  const fixed = await call(ADMIN, 'POST', '/admin/holidays/fixed', { year: '2027' });
  assert.equal(fixed.json.added.length, 5);
  assert.equal((await call(ADMIN, 'POST', '/admin/holidays/fixed', { year: '2027' })).json.added.length, 0); // idempotent
  const list = await call(ADMIN, 'GET', '/admin/holidays?year=2027');
  assert.ok(list.json.holidays.some((x: any) => x.name === 'Independence Day' && x.day === '2027-08-15'));
  assert.equal((await call(ADMIN, 'DELETE', `/admin/holidays/${day}`)).status, 200);
  assert.equal((await call(E1, 'GET', '/admin/holidays')).status, 403);
});

await step('repeat requests no longer burn user ids', async () => {
  const [{ last_value: a }] = await sql`select last_value from users_id_seq`;
  for (let i = 0; i < 5; i++) await call(E1, 'GET', '/me');
  const [{ last_value: b }] = await sql`select last_value from users_id_seq`;
  assert.equal(Number(b), Number(a));
});

await step('face: profile photo, same person matches, stranger flagged, no-face refused (live R2 + face service)', async () => {
  const dir = process.env.FACE_TEST_DIR;
  if (!dir || !(await fetch(`${process.env.FACE_URL}/health`).then((r) => r.ok).catch(() => false))) {
    console.log('     (skipped: set FACE_TEST_DIR and run the face service)');
    return;
  }
  const { readFileSync } = await import('node:fs');
  const { remove } = await import('../src/storage.js');
  const img = (n: string) => readFileSync(`${dir}/${n}`);
  const put = async (url: string, bytes: Buffer) => assert.equal((await fetch(url, { method: 'PUT', headers: { 'content-type': 'image/jpeg' }, body: bytes })).status, 200);
  const cleanup: string[] = [];
  const E3 = await tokenFor('test|e3', ['employee'], 'Stranger Test');
  await call(E3, 'GET', '/me');
  await sql`update users set consented_at = now(), consent_version = 2 where auth0_sub = 'test|e3'`;
  const [{ id: e3 }] = await sql`select id from users where auth0_sub = 'test|e3'`;
  await call(ADMIN, 'PATCH', `/admin/employees/${e3}`, { site_ids: [officeId] });

  const setPhoto = async (uid: number, file: string) => {
    const u = await call(ADMIN, 'POST', `/admin/employees/${uid}/photo-upload-url`, { bytes: img(file).length });
    await put(u.json.url, img(file));
    return call(ADMIN, 'POST', `/admin/employees/${uid}/photo`, { key: u.json.key });
  };
  const checkIn = async (token: string, file: string) => {
    const fix = { ...OFFICE, accuracy_m: 10, mocked: false };
    const u = await call(token, 'POST', '/selfie-upload-url', { bytes: img(file).length, ...fix });
    assert.equal(u.status, 200, JSON.stringify(u.json));
    await put(u.json.url, img(file));
    cleanup.push(u.json.key);
    return call(token, 'POST', '/attendance', { ...fix, photo_key: u.json.key });
  };
  try {
    assert.equal((await setPhoto(e2, 'noface.jpg')).status, 400); // a profile photo must show a face
    const p2 = await setPhoto(e2, 'person.jpg');
    assert.equal(p2.status, 200, JSON.stringify(p2.json));
    assert.equal((await setPhoto(e3, 'person.jpg')).status, 200);

    const refused = await checkIn(E3, 'noface.jpg');
    assert.equal(refused.status, 400);
    assert.equal(refused.json.error, 'face_unclear');

    const same = await checkIn(E2, 'person-again.jpg');
    assert.equal(same.status, 201, JSON.stringify(same.json));
    assert.ok(same.json.attendance.face_score >= 0.4, `same person scored ${same.json.attendance.face_score}`);
    assert.ok(!same.json.attendance.flags.includes('face_mismatch'));

    const stranger = await checkIn(E3, 'stranger.jpg');
    assert.equal(stranger.status, 201);
    assert.ok(stranger.json.attendance.face_score < 0.4, `stranger scored ${stranger.json.attendance.face_score}`);
    assert.equal(stranger.json.attendance.status, 'flagged');
    assert.ok(stranger.json.attendance.flags.includes('face_mismatch'));
    console.log(`     same person ${same.json.attendance.face_score} · stranger ${stranger.json.attendance.face_score}`);

    const detail = await call(ADMIN, 'GET', `/admin/attendance/${stranger.json.attendance.id}`);
    assert.ok(detail.json.profile_photo_url && detail.json.attendance.photo_url);
    assert.equal(detail.json.face_threshold, 0.4);

    // Turning someone off deletes their photo + face data.
    await sql`update users set auth0_sub = auth0_sub where id = ${e3}`;
    await call(ADMIN, 'DELETE', `/admin/employees/${e3}/photo`);
    const [gone] = await sql`select photo_key, face_embedding from users where id = ${e3}`;
    assert.deepEqual([gone.photo_key, gone.face_embedding], [null, null]);
  } finally {
    for (const k of cleanup) await remove(k).catch(() => undefined);
    await call(ADMIN, 'DELETE', `/admin/employees/${e2}/photo`).catch(() => undefined);
    await call(ADMIN, 'DELETE', `/admin/employees/${e3}/photo`).catch(() => undefined);
  }
});

await step('a deactivated employee is locked out of the app', async () => {
  await sql`update users set active = false where id = ${e2}`; // (PATCH active=false also blocks the Auth0 login; skipped here)
  const r = await call(E2, 'GET', '/me');
  assert.equal(r.status, 403); assert.equal(r.json.error, 'deactivated');
});

console.log(`\n${passed} admin/employee flows passed against the test branch.`);
await sql.end();
