import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';

const NS = 'https://attendance-api';
const domain = process.env.AUTH0_DOMAIN ?? 'dev-geomark.jp.auth0.com';
export const ISSUER = `https://${domain}/`;
export const AUDIENCE = process.env.AUTH0_AUDIENCE ?? 'https://attendance-api';

let keys: JWTVerifyGetKey = createRemoteJWKSet(new URL(`${ISSUER}.well-known/jwks.json`));

/** Integration tests sign tokens with a local key. Refuses to run anywhere but NODE_ENV=test. */
export function useTestKeys(k: JWTVerifyGetKey) {
  if (process.env.NODE_ENV !== 'test') throw new Error('useTestKeys is only allowed when NODE_ENV=test');
  keys = k;
}

export type Identity = { sub: string; email: string | null; name: string; roles: string[] };

/** Verifies an Auth0 access token (signature, issuer, audience, expiry). Throws if invalid. */
export async function verifyToken(token: string, k: JWTVerifyGetKey = keys): Promise<Identity> {
  const { payload } = await jwtVerify(token, k, { issuer: ISSUER, audience: AUDIENCE, algorithms: ['RS256'] });
  const roles = payload[`${NS}/roles`];
  return {
    sub: payload.sub!,
    email: typeof payload[`${NS}/email`] === 'string' ? (payload[`${NS}/email`] as string) : null,
    name: typeof payload[`${NS}/name`] === 'string' ? (payload[`${NS}/name`] as string) : '',
    roles: Array.isArray(roles) ? roles.filter((r): r is string => typeof r === 'string') : [],
  };
}
