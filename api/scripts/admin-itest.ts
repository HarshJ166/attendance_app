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
await sql`update users set consented_at = now() where auth0_sub like 'test|%'`;
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
  const [{ n }] = await sql`select count(*)::int n from checkin_attempts where user_id = ${e2}`;
  assert.equal(n, 2);
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
  assert.equal(t.json.summary.blocked_attempts, 2);
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

await step('a deactivated employee is locked out of the app', async () => {
  await sql`update users set active = false where id = ${e2}`; // (PATCH active=false also blocks the Auth0 login; skipped here)
  const r = await call(E2, 'GET', '/me');
  assert.equal(r.status, 403); assert.equal(r.json.error, 'deactivated');
});

console.log(`\n${passed} admin/employee flows passed against the test branch.`);
await sql.end();
