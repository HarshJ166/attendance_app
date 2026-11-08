// npm run r2:list → count of objects per top folder (selfies/, profiles/), no downloads.
import { ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
const s3 = new S3Client({ region: 'auto', forcePathStyle: true, endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID!, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY! } });
const counts: Record<string, number> = {};
let token: string | undefined;
do {
  const r = await s3.send(new ListObjectsV2Command({ Bucket: process.env.R2_BUCKET ?? 'attendance-selfies', ContinuationToken: token }));
  for (const o of r.Contents ?? []) { const top = o.Key!.split('/').slice(0, 2).join('/'); counts[top] = (counts[top] ?? 0) + 1; }
  token = r.NextContinuationToken;
} while (token);
console.log(Object.keys(counts).length ? counts : 'bucket empty');
