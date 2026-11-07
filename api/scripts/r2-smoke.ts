// Live R2 check: npm run smoke:r2. Uploads a 2 KB test file as a fake user (999999), tries 3 attacks, cleans up.
import { DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { exists, istDay, newSelfieKey, uploadUrl, viewUrl } from '../src/storage.js';

const s3 = new S3Client({ region: 'auto', forcePathStyle: true, endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID!, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY! } });
let failed = 0;
const ok = (b: boolean, msg: string) => { if (!b) failed++; console.log(`${b ? '✅' : '❌'} ${msg}`); };
const body = new Uint8Array(2048).fill(0xff);
const key = newSelfieKey(999999, istDay());

try {
  const put = await fetch(await uploadUrl(key, body.length), { method: 'PUT', headers: { 'content-type': 'image/jpeg' }, body });
  ok(put.ok, `upload via presigned link → HTTP ${put.status}${put.ok ? '' : ' ' + (await put.text()).slice(0, 200)}`);
  ok(await exists(key), 'server sees the uploaded photo');
  const view = await fetch(await viewUrl(key));
  ok(view.ok && (await view.arrayBuffer()).byteLength === body.length, `view link returns the photo → HTTP ${view.status}`);

  const k2 = newSelfieKey(999999, istDay());
  const u2 = await uploadUrl(k2, body.length);
  const wrongType = await fetch(u2, { method: 'PUT', headers: { 'content-type': 'text/html' }, body });
  ok(!wrongType.ok, `attack: upload HTML with the link → rejected (HTTP ${wrongType.status})`);
  const bigger = await fetch(u2, { method: 'PUT', headers: { 'content-type': 'image/jpeg' }, body: new Uint8Array(4096) });
  ok(!bigger.ok, `attack: upload a bigger file than signed → rejected (HTTP ${bigger.status})`);
  const file = k2.split('/').pop()!;
  const tampered = await fetch(u2.replace(file, 'other.jpg'), { method: 'PUT', headers: { 'content-type': 'image/jpeg' }, body });
  ok(!tampered.ok, `attack: reuse link for another file name → rejected (HTTP ${tampered.status})`);
  ok(!(await exists(k2)), 'nothing was written by the rejected attempts');
} finally {
  await s3.send(new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET ?? 'attendance-selfies', Key: key }));
  ok(!(await exists(key)), 'cleanup: test file deleted');
}
process.exitCode = failed ? 1 : 0;
