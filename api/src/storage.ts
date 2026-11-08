import { randomUUID } from 'node:crypto';
import { CopyObjectCommand, DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const Bucket = process.env.R2_BUCKET ?? 'attendance-selfies';

const s3 = new S3Client({
  region: 'auto',
  forcePathStyle: true,
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID ?? '',
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? '',
  },
  // R2 rejects the SDK's default extra checksum headers on presigned PUTs.
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED',
});

export const MAX_SELFIE_BYTES = 2_000_000;

/** Today's calendar day in India, e.g. "2026-11-08". */
export const istDay = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(d);

export const newSelfieKey = (userId: number, day: string) => `selfies/${userId}/${day}/${randomUUID()}.jpg`;

/** A phone may only submit a key we issued for this user and this day. */
export function isOwnSelfieKey(key: unknown, userId: number, day: string): key is string {
  return typeof key === 'string' && new RegExp(`^selfies/${userId}/${day}/[0-9a-f-]{36}\\.jpg$`).test(key);
}

/** 5-minute upload link, locked to this exact key, JPEG type and byte size. */
export const uploadUrl = (Key: string, bytes: number) =>
  getSignedUrl(s3, new PutObjectCommand({ Bucket, Key, ContentType: 'image/jpeg', ContentLength: bytes }), {
    expiresIn: 300,
    signableHeaders: new Set(['content-type', 'content-length']),
  });

/** 10-minute view link (admin website). */
export const viewUrl = (Key: string) => getSignedUrl(s3, new GetObjectCommand({ Bucket, Key }), { expiresIn: 600 });

export async function exists(Key: string): Promise<boolean> {
  try {
    await s3.send(new HeadObjectCommand({ Bucket, Key }));
    return true;
  } catch (e) {
    if ((e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) return false;
    throw e;
  }
}

/** Remove a selfie (e.g. the check-in was blocked, so we must not keep the photo). */
export async function remove(Key: string): Promise<void> {
  await s3.send(new DeleteObjectCommand({ Bucket, Key }));
}

export const newProfileKey = (userId: number) => `profiles/${userId}/${randomUUID()}.jpg`;
export function isOwnProfileKey(key: unknown, userId: number): key is string {
  return typeof key === 'string' && new RegExp(`^profiles/${userId}/[0-9a-f-]{36}\\.jpg$`).test(key);
}

export async function getBytes(Key: string): Promise<Uint8Array> {
  const r = await s3.send(new GetObjectCommand({ Bucket, Key }));
  return r.Body!.transformToByteArray();
}

/** Copy a check-in selfie to profiles/ so it survives the 90-day selfie clean-up. */
export async function copy(fromKey: string, toKey: string): Promise<void> {
  await s3.send(new CopyObjectCommand({ Bucket, Key: toKey, CopySource: `${Bucket}/${fromKey}`, ContentType: 'image/jpeg', MetadataDirective: 'REPLACE' }));
}
