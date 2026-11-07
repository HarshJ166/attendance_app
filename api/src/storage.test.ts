import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.R2_ACCOUNT_ID = 'acct123';
process.env.R2_ACCESS_KEY_ID = 'test-key';
process.env.R2_SECRET_ACCESS_KEY = 'test-secret';
const { isOwnSelfieKey, istDay, newSelfieKey, uploadUrl } = await import('./storage.js');

test('istDay uses India time, not the server clock zone', () => {
  assert.equal(istDay(new Date('2026-11-07T18:29:00Z')), '2026-11-07'); // 23:59 IST
  assert.equal(istDay(new Date('2026-11-07T18:31:00Z')), '2026-11-08'); // 00:01 IST next day
});

test('a phone can only submit its own key for today', () => {
  const key = newSelfieKey(7, '2026-11-08');
  assert.ok(isOwnSelfieKey(key, 7, '2026-11-08'));
  assert.ok(!isOwnSelfieKey(key, 8, '2026-11-08'), 'other user');
  assert.ok(!isOwnSelfieKey(key, 7, '2026-11-07'), 'other day');
  assert.ok(!isOwnSelfieKey('selfies/7/2026-11-08/../../etc.jpg', 7, '2026-11-08'), 'path tricks');
  assert.ok(!isOwnSelfieKey(42, 7, '2026-11-08'), 'not a string');
});

test('upload link is locked to bucket, key, jpeg, size and 5 minutes', async () => {
  const key = newSelfieKey(7, '2026-11-08');
  const url = new URL(await uploadUrl(key, 123456));
  assert.equal(url.host, 'acct123.r2.cloudflarestorage.com');
  assert.equal(decodeURIComponent(url.pathname), `/attendance-selfies/${key}`);
  assert.equal(url.searchParams.get('X-Amz-Expires'), '300');
  const signed = url.searchParams.get('X-Amz-SignedHeaders') ?? '';
  assert.ok(signed.includes('content-length') && signed.includes('content-type'), signed);
});
