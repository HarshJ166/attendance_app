// QA API for UI testing: the real app code, with a local signing key instead of Auth0, on 127.0.0.1:8788,
// against a THROWAWAY Neon branch seeded with realistic data. Never points at the main database.
// Started by ../../qa/run.sh. Extra route: GET /__qa/token?sub=…&roles=admin&name=…
import { serve } from '@hono/node-server';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';

if (process.env.NODE_ENV !== 'test' || !process.env.ITEST_OK) throw new Error('QA server needs NODE_ENV=test and a throwaway branch');

const { AUDIENCE, ISSUER, useTestKeys } = await import('../src/auth.js');
const { app } = await import('../src/app.js');
const { sql } = await import('../src/db/index.js');
const { istDay } = await import('../src/storage.js');

const { privateKey, publicKey } = await generateKeyPair('RS256');
useTestKeys(createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), alg: 'RS256' }] }));
const NS = 'https://attendance-api';
const sign = (sub: string, roles: string[], name: string, email: string) =>
  new SignJWT({ [`${NS}/roles`]: roles, [`${NS}/email`]: email, [`${NS}/name`]: name })
    .setProtectedHeader({ alg: 'RS256' }).setSubject(sub).setIssuer(ISSUER).setAudience(AUDIENCE).setIssuedAt().setExpirationTime('2h').sign(privateKey);

// ---------- seed: 2 offices + a home, 6 people, ~3 weeks of history, today's mix, blocked attempts ----------
const [office] = await sql`insert into sites (name, kind, lat, lng, radius_m) values ('Dahanukarwadi, Kandivali (W)', 'office', 19.2066, 72.8357, 150) returning id`;
const [branch] = await sql`insert into sites (name, kind, lat, lng, radius_m) values ('Andheri branch', 'office', 19.1197, 72.8468, 200) returning id`;
const people = [
  ['qa|admin', 'Harsh (QA admin)', 'admin', 'HR-001', 'HR manager'],
  ['qa|asha', 'Asha Patil', 'employee', 'JJ-101', 'Field sales'],
  ['qa|ravi', 'Ravi Shah', 'employee', 'JJ-102', 'Accounts'],
  ['qa|meena', 'Meena Iyer', 'employee', 'JJ-103', 'Operations'],
  ['qa|imran', 'Imran Khan', 'employee', 'JJ-104', 'Field sales'],
  ['qa|neha', 'Neha Joshi', 'employee', 'JJ-105', 'Design'],
] as const;
const ids: Record<string, number> = {};
for (const [sub, name, role, code, desig] of people) {
  const [u] = await sql`
    insert into users (auth0_sub, email, name, role, employee_code, designation, consented_at, created_at)
    values (${sub}, ${sub.split('|')[1] + '@qa.local'}, ${name}, ${role}, ${code}, ${desig}, now() - interval '30 days', now() - interval '30 days')
    returning id`;
  ids[sub] = u.id;
  await sql`insert into user_sites (user_id, site_id) values (${u.id}, ${sub === 'qa|ravi' ? branch.id : office.id})`;
}
const [home] = await sql`insert into sites (name, kind, lat, lng, radius_m) values ('Asha Patil – home', 'home', 19.2290, 72.8560, 100) returning id`;
await sql`insert into user_sites (user_id, site_id) values (${ids['qa|asha']}, ${home.id})`;

const today = istDay();
const dayOffset = (n: number) => istDay(new Date(Date.now() - n * 86_400_000));
const fake = (uid: number, day: string) => `selfies/${uid}/${day}/00000000-0000-0000-0000-000000000000.jpg`;
// History: most people present most working days, some late, some absent.
for (let n = 1; n <= 21; n++) {
  const day = dayOffset(n);
  if (new Date(`${day}T00:00:00Z`).getUTCDay() === 0) continue;
  for (const [sub] of people.slice(1)) {
    const uid = ids[sub];
    if ((uid * 7 + n) % 9 === 0) continue; // absent now and then
    const late = (uid + n) % 5 === 0 ? 10 + ((uid * n) % 40) : 0;
    const site = sub === 'qa|ravi' ? branch.id : office.id;
    await sql`
      insert into attendance (user_id, day, marked_at, lat, lng, accuracy_m, mocked, site_id, distance_m, photo_key, status, flags, late_min, address)
      values (${uid}, ${day}, ${`${day}T${late ? '10:0' + (late % 10) : '09:2' + (uid % 10)}:00+05:30`}, 19.2068, 72.8359, 18, false, ${site}, 35,
              ${fake(uid, day)}, 'present', '{}', ${late}, 'Link Road, Renuka Nagar, Kandivali West')`;
  }
}
// Today: Asha WFH (on time), Ravi at branch late, Meena flagged (weak GPS), Imran + Neha not yet; blocked attempts for Imran.
await sql`insert into attendance (user_id, day, lat, lng, accuracy_m, mocked, site_id, distance_m, photo_key, status, flags, late_min, address)
  values (${ids['qa|asha']}, ${today}, 19.2291, 72.8561, 12, false, ${home.id}, 14, ${fake(ids['qa|asha'], today)}, 'present', '{}', 0, 'Mahavir Nagar, Kandivali West')`;
await sql`insert into attendance (user_id, day, lat, lng, accuracy_m, mocked, site_id, distance_m, photo_key, status, flags, late_min, address)
  values (${ids['qa|ravi']}, ${today}, 19.1199, 72.8470, 20, false, ${branch.id}, 28, ${fake(ids['qa|ravi'], today)}, 'present', '{}', 22, 'Andheri West')`;
await sql`insert into attendance (user_id, day, lat, lng, accuracy_m, mocked, site_id, distance_m, photo_key, status, flags, late_min, address)
  values (${ids['qa|meena']}, ${today}, 19.2070, 72.8362, 140, false, ${office.id}, 60, ${fake(ids['qa|meena'], today)}, 'flagged', ${['low_accuracy']}, 0, 'Renuka Nagar, Kandivali West')`;
await sql`insert into checkin_attempts (user_id, lat, lng, accuracy_m, mocked, reason, site_id, distance_m) values
  (${ids['qa|imran']}, 19.2310, 72.8605, 15, false, 'outside_site', ${office.id}, 3600),
  (${ids['qa|imran']}, 19.2066, 72.8357, 5, true, 'mock_location', ${office.id}, 0)`;
console.log('[qa] seeded', Object.keys(ids).length, 'people');

serve({
  hostname: '127.0.0.1',
  port: 8788,
  fetch: async (req) => {
    const url = new URL(req.url);
    if (url.pathname === '/__qa/token') {
      const sub = url.searchParams.get('sub') ?? 'qa|admin';
      const person = people.find((p) => p[0] === sub) ?? people[0];
      const token = await sign(sub, (url.searchParams.get('roles') ?? 'admin').split(','), person[1], `${sub.split('|')[1]}@qa.local`);
      return Response.json({ access_token: token, name: person[1], email: `${sub.split('|')[1]}@qa.local` });
    }
    return app.fetch(req);
  },
}, () => console.log('[qa] API on http://127.0.0.1:8788'));
