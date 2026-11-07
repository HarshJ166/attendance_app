// Auth0 Management API, limited by the service app's grant to:
// read:users, create:users, update:users, create:role_members, create:user_tickets. (No delete.)
import { randomBytes } from 'node:crypto';

const domain = process.env.AUTH0_DOMAIN ?? 'dev-geomark.jp.auth0.com';
const base = `https://${domain}/api/v2`;
const CONNECTION = 'Username-Password-Authentication';
// Role ids on dev-geomark (see ../auth0-config.md).
export const ROLE_IDS = { admin: 'rol_E4AkjiaEuuKbLdwW', employee: 'rol_pN7mzwSoGG6tQhB0' } as const;

let cached: { token: string; until: number } | null = null;

async function token(): Promise<string> {
  if (cached && Date.now() < cached.until) return cached.token;
  const res = await fetch(`https://${domain}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: process.env.AUTH0_MGMT_CLIENT_ID,
      client_secret: process.env.AUTH0_MGMT_CLIENT_SECRET,
      audience: `${base}/`,
    }),
  });
  if (!res.ok) throw new Error(`Auth0 token failed: ${res.status}`);
  const body = (await res.json()) as { access_token: string; expires_in: number };
  cached = { token: body.access_token, until: Date.now() + (body.expires_in - 60) * 1000 };
  return body.access_token;
}

export class Auth0Error extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(base + path, {
    method,
    headers: { authorization: `Bearer ${await token()}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as { message?: string };
  if (!res.ok) throw new Auth0Error(res.status, json.message ?? `Auth0 ${method} ${path} failed (${res.status})`);
  return json as T;
}

/**
 * Creates the login with a random password nobody sees, gives it a role, and returns a one-time
 * "set your password" link (valid 7 days) for HR to send to the person.
 */
export async function createLogin(email: string, name: string, role: keyof typeof ROLE_IDS) {
  const password = `${randomBytes(18).toString('base64url')}Aa1!`;
  const user = await call<{ user_id: string }>('POST', '/users', {
    connection: CONNECTION, email, name, password, email_verified: true, verify_email: false,
  });
  await call('POST', `/roles/${ROLE_IDS[role]}/users`, { users: [user.user_id] });
  const ticket = await call<{ ticket: string }>('POST', '/tickets/password-change', {
    user_id: user.user_id, ttl_sec: 7 * 24 * 3600, mark_email_as_verified: true,
  });
  return { auth0_sub: user.user_id, set_password_link: ticket.ticket };
}

/** New "set your password" link for an existing login (e.g. the first one expired). */
export async function passwordLink(auth0Sub: string) {
  const t = await call<{ ticket: string }>('POST', '/tickets/password-change', { user_id: auth0Sub, ttl_sec: 7 * 24 * 3600 });
  return t.ticket;
}

/** Blocked users can't log in. Used when HR turns someone off (they left). */
export const setBlocked = (auth0Sub: string, blocked: boolean) =>
  call('PATCH', `/users/${encodeURIComponent(auth0Sub)}`, { blocked });

export const setName = (auth0Sub: string, name: string) =>
  call('PATCH', `/users/${encodeURIComponent(auth0Sub)}`, { name });

/** Adds a role. (Removing a role needs delete:role_members, which this app deliberately doesn't have.) */
export const addRole = (auth0Sub: string, role: keyof typeof ROLE_IDS) =>
  call('POST', `/roles/${ROLE_IDS[role]}/users`, { users: [auth0Sub] });
