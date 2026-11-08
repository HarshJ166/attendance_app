// Client for the face service (../face/server.py): sends a JPEG, gets back the face fingerprint.
// The service holds no data; matching (cosine similarity) happens here.

const FACE_URL = process.env.FACE_URL ?? 'http://127.0.0.1:8790';

export type FaceResult =
  | { faces: 1; score: number; embedding: number[]; background_faces?: number }
  | { faces: 0 | 2 | 3 | 4 | number; embedding?: undefined };

/** null = the face service is unreachable (check-ins still work; nothing is matched). */
export async function embedJpeg(jpeg: Uint8Array): Promise<FaceResult | null> {
  if (!process.env.FACE_SECRET) return null;
  try {
    const res = await fetch(`${FACE_URL}/embed`, {
      method: 'POST',
      headers: { 'x-face-secret': process.env.FACE_SECRET, 'content-type': 'image/jpeg' },
      body: Buffer.from(jpeg), // Node fetch wants a Buffer/ArrayBuffer view, not a generic Uint8Array type
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as FaceResult & { error?: string };
    return body.error ? null : body;
  } catch {
    return null;
  }
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/**
 * Same person if cosine ≥ this. Measured with face/calibrate.py on the public LFW pairs test
 * (379 same-person + 386 different-person pairs, 2026-11-08):
 *   0.363 (OpenCV default) → 98.9% genuine pass, 0% strangers, BUT the closest stranger scored 0.356
 *   0.400 (chosen)         → 98.7% genuine pass, 0% strangers, with a clear margin over 0.356
 * A miss is NOT blocked: the check-in is saved and flagged for HR (decided 2026-11-08).
 */
export const FACE_MATCH_THRESHOLD = Number(process.env.FACE_MATCH_THRESHOLD ?? 0.4);

/** Plain words for the person when a selfie can't be used. */
export function faceProblem(r: FaceResult): string | null {
  if (r.faces === 1) return null;
  return r.faces === 0
    ? 'We couldn’t see your face clearly. Face the camera in good light and take the selfie again.'
    : 'Only you should be in the selfie. Please take it again.';
}
