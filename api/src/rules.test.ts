import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { AUDIENCE, ISSUER, verifyToken } from './auth.js';
import { blockMessage, classify, distanceM, minutesLate, monthDays, parseFix, type Site } from './rules.js';

const office: Site = { id: 1, name: 'Dahanukarwadi', kind: 'office', lat: 23.0225, lng: 72.5714, radius_m: 150 };
const branch: Site = { id: 2, name: 'Andheri', kind: 'office', lat: 23.1225, lng: 72.5714, radius_m: 150 }; // ~11 km north
const home: Site = { id: 3, name: 'Home', kind: 'home', lat: 23.0333, lng: 72.5714, radius_m: 100 }; // ~1.2 km north

test('distance: 0.001° latitude ≈ 111 m', () => {
  const d = distanceM(office, { lat: office.lat + 0.001, lng: office.lng });
  assert.ok(Math.abs(d - 111.2) < 1, `got ${d}`);
});

test('inside the office with good GPS → present, matched to the office', () => {
  const r = classify({ lat: 23.0226, lng: 72.5715, accuracy_m: 12, mocked: false }, [office]);
  assert.ok(r.blocked === null && r.status === 'present' && r.flags.length === 0);
  assert.equal(r.site?.id, 1);
});

test('1.2 km from the only office → BLOCKED with distance and a plain message', () => {
  const r = classify({ lat: 23.0333, lng: 72.5714, accuracy_m: 10, mocked: false }, [office]);
  assert.equal(r.blocked, 'outside_site');
  assert.ok(r.distance_m! > 1150 && r.distance_m! < 1250, `got ${r.distance_m}`);
  assert.equal(blockMessage('outside_site', 1201, office), 'You are 1.2 km from Dahanukarwadi. Go to the office to mark attendance.');
});

test('many places: at home (WFH) → allowed and matched to Home, not the office', () => {
  const r = classify({ lat: 23.0333, lng: 72.5714, accuracy_m: 10, mocked: false }, [office, branch, home]);
  assert.ok(r.blocked === null);
  assert.equal(r.site?.kind, 'home');
});

test('many places: at the branch → matched to the branch', () => {
  const r = classify({ lat: 23.1226, lng: 72.5714, accuracy_m: 10, mocked: false }, [office, branch, home]);
  assert.ok(r.blocked === null);
  assert.equal(r.site?.name, 'Andheri');
});

test('many places: outside all of them → blocked, names the NEAREST place', () => {
  const r = classify({ lat: 23.05, lng: 72.5714, accuracy_m: 10, mocked: false }, [office, branch, home]); // ~1.9 km past home
  assert.equal(r.blocked, 'outside_site');
  assert.equal(r.site?.name, 'Home');
  assert.match(blockMessage('outside_site', r.distance_m, r.site), /from your home location/);
});

test('just outside radius but within GPS error → benefit of doubt (present)', () => {
  const r = classify({ lat: office.lat + 0.00162, lng: office.lng, accuracy_m: 40, mocked: false }, [office]); // ~180 m, r 150, ±40
  assert.equal(r.blocked, null);
});

test('fake GPS is blocked even when it claims to be at the office', () => {
  assert.equal(classify({ lat: office.lat, lng: office.lng, accuracy_m: 5, mocked: true }, [office]).blocked, 'mock_location');
});

test('no place assigned → blocked', () => {
  assert.equal(classify({ lat: 1, lng: 1, accuracy_m: 5, mocked: false }, []).blocked, 'no_site');
});

test('weak GPS inside a place → saved but flagged', () => {
  const r = classify({ lat: office.lat, lng: office.lng, accuracy_m: 300, mocked: false }, [office]);
  assert.ok(r.blocked === null && r.status === 'flagged');
  assert.deepEqual(r.blocked === null && r.flags, ['low_accuracy']);
});

test('late: shift 09:30 + 15 min grace, in IST whatever the server clock zone', () => {
  const ist = (hhmm: string) => new Date(`2026-11-09T${hhmm}:00+05:30`);
  assert.equal(minutesLate(ist('09:10'), '09:30', 15), 0); // early
  assert.equal(minutesLate(ist('09:45'), '09:30', 15), 0); // exactly at grace end → on time
  assert.equal(minutesLate(ist('09:46'), '09:30', 15), 16); // late by 16 min after shift start
  assert.equal(minutesLate(ist('13:00'), '09:30:00', 15), 210); // "HH:MM:SS" from Postgres works too
});

test('parseFix rejects junk from the phone', () => {
  assert.equal(typeof parseFix(null), 'string');
  assert.equal(typeof parseFix({ lat: '23', lng: 72, accuracy_m: 5, mocked: false }), 'string');
  assert.equal(typeof parseFix({ lat: 91, lng: 72, accuracy_m: 5, mocked: false }), 'string');
  assert.equal(typeof parseFix({ lat: 23, lng: 72, accuracy_m: 0, mocked: false }), 'string');
  assert.equal(typeof parseFix({ lat: 23, lng: 72, accuracy_m: 5 }), 'string');
  assert.deepEqual(parseFix({ lat: 23, lng: 72, accuracy_m: 5, mocked: false, extra: 1 }), { lat: 23, lng: 72, accuracy_m: 5, mocked: false });
});

test('calendar: Sunday off, absent, today pending, future, before joining, marked days', () => {
  // Nov 2026: 1st is a Sunday. Joined on the 3rd, today is the 8th (Sunday) … use the 7th (Saturday) as today.
  const marked = new Map<string, 'present' | 'flagged'>([['2026-11-04', 'present'], ['2026-11-05', 'flagged']]);
  const days = monthDays('2026-11', '2026-11-07', '2026-11-03', marked);
  const k = (d: number) => days[d - 1].kind;
  assert.equal(days.length, 30);
  assert.equal(k(1), 'before_joining'); // Sunday, but before joining wins
  assert.equal(k(2), 'before_joining');
  assert.equal(k(3), 'absent'); // joined, Tuesday, no check-in
  assert.equal(k(4), 'present');
  assert.equal(k(5), 'flagged');
  assert.equal(k(6), 'absent');
  assert.equal(k(7), 'today');
  assert.equal(k(8), 'future'); // Sunday in the future is just future
  assert.equal(monthDays('2026-11', '2026-11-30', '2026-01-01', new Map())[14].kind, 'off'); // 15 Nov is a Sunday
  assert.equal(monthDays('2026-02', '2026-03-01', '2026-01-01', new Map()).length, 28);
});

test('verifyToken: accepts a valid token, rejects wrong audience / issuer / expired / foreign key', async () => {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const keys = createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), alg: 'RS256' }] });
  const sign = (claims: object, opts: { aud?: string; iss?: string; exp?: string } = {}, key = privateKey) =>
    new SignJWT({ ...claims }).setProtectedHeader({ alg: 'RS256' }).setSubject('auth0|abc')
      .setIssuer(opts.iss ?? ISSUER).setAudience(opts.aud ?? AUDIENCE).setIssuedAt().setExpirationTime(opts.exp ?? '5m').sign(key);

  const id = await verifyToken(await sign({ 'https://attendance-api/roles': ['employee'], 'https://attendance-api/email': 'a@b.c' }), keys);
  assert.deepEqual(id, { sub: 'auth0|abc', email: 'a@b.c', name: '', roles: ['employee'] });

  await assert.rejects(verifyToken(await sign({}, { aud: 'https://other-api' }), keys));
  await assert.rejects(verifyToken(await sign({}, { iss: 'https://evil.example/' }), keys));
  await assert.rejects(verifyToken(await sign({}, { exp: '-1m' }), keys));
  const other = await generateKeyPair('RS256');
  await assert.rejects(verifyToken(await sign({}, {}, other.privateKey), keys));
});

test('shortAddress keeps road/area/suburb, drops wards, zones, state, PIN, country', async () => {
  const { shortAddress } = await import('./geocode.js');
  assert.equal(
    shortAddress('Link Road, Renuka Nagar, Kandivali West, R/S Ward, Mumbai Zone 4, Mumbai Suburban District, Mumbai, Maharashtra, 400067, India'),
    'Link Road, Renuka Nagar, Kandivali West',
  );
  assert.equal(shortAddress('Maharashtra, India'), null);
});

test('dayKind: rejected by HR counts as absent; Sunday off; today pending', async () => {
  const { dayKind } = await import('./rules.js');
  assert.equal(dayKind('2026-11-09', '2026-11-10', '2026-11-01', 'rejected'), 'absent');
  assert.equal(dayKind('2026-11-08', '2026-11-10', '2026-11-01'), 'off'); // Sunday
  assert.equal(dayKind('2026-11-10', '2026-11-10', '2026-11-01'), 'today');
  assert.equal(dayKind('2026-11-09', '2026-11-10', '2026-11-01'), 'absent');
});

test('csvCell quotes, doubles quotes, and blocks spreadsheet formulas', async () => {
  const { csvCell, csvRow } = await import('./rules.js');
  assert.equal(csvCell('Harsh'), '"Harsh"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell('=HYPERLINK("http://evil","x")'), `"'=HYPERLINK(""http://evil"",""x"")"`);
  assert.equal(csvCell('+91 98200 00000'), `"'+91 98200 00000"`);
  assert.equal(csvCell('-5'), `"'-5"`);
  assert.equal(csvCell(null), '""');
  assert.equal(csvRow([1, 'a,b', 19.2]), '"1","a,b","19.2"');
});
