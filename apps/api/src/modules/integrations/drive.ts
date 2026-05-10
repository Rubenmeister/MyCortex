import { createHmac } from 'node:crypto';
import { z } from 'zod';
import { getEnv } from '../../lib/env.js';

/**
 * Google Drive OAuth + Drive API helpers.
 *
 * Flow:
 *   1. /integrations/drive/connect (authed) → server signs `state` with the
 *      user/workspace context, returns Google OAuth URL.
 *   2. User approves in Google → Google redirects to .../drive/callback?code=&state=
 *   3. /integrations/drive/callback verifies `state`, exchanges the code for
 *      tokens, fetches the user's Google profile, saves integration row.
 *
 * State signing uses HMAC-SHA256 keyed by the service role secret (the
 * server already trusts itself). Short TTL (10 min) prevents replay.
 */

const DRIVE_SCOPES = [
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
] as const;

export const DRIVE_OAUTH_SCOPE = DRIVE_SCOPES.join(' ');

const STATE_TTL_MS = 10 * 60 * 1000;

export type OAuthState = {
  workspaceId: string;
  userId: string;
  nonce: string;
  iat: number;
};

function hmacSecret(): string {
  // We HMAC-sign OAuth state with the service role key. It's a server-only
  // secret already in the env — no extra secret to provision. If we rotate
  // it, in-flight states invalidate (acceptable, they have 10 min TTL).
  return getEnv().SUPABASE_SERVICE_ROLE_KEY;
}

export function signState(payload: Omit<OAuthState, 'iat'>): string {
  const full: OAuthState = { ...payload, iat: Date.now() };
  const body = Buffer.from(JSON.stringify(full)).toString('base64url');
  const sig = createHmac('sha256', hmacSecret()).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifyState(token: string): OAuthState {
  const [body, sig] = token.split('.');
  if (!body || !sig) throw new Error('malformed_state');
  const expected = createHmac('sha256', hmacSecret()).update(body).digest('base64url');
  if (expected !== sig) throw new Error('invalid_signature');
  const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as OAuthState;
  if (Date.now() - parsed.iat > STATE_TTL_MS) throw new Error('state_expired');
  return parsed;
}

// ---- OAuth URL ---------------------------------------------------------

export function buildAuthUrl(state: string): string {
  const env = getEnv();
  if (!env.GOOGLE_OAUTH_CLIENT_ID || !env.GOOGLE_OAUTH_REDIRECT_URI) {
    throw new Error('google_oauth_not_configured');
  }
  const params = new URLSearchParams({
    client_id: env.GOOGLE_OAUTH_CLIENT_ID,
    redirect_uri: env.GOOGLE_OAUTH_REDIRECT_URI,
    response_type: 'code',
    scope: DRIVE_OAUTH_SCOPE,
    access_type: 'offline', // get refresh_token
    prompt: 'consent', // always show consent so we ALWAYS get refresh_token
    state,
    include_granted_scopes: 'true',
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

// ---- Token exchange ----------------------------------------------------

const TokenResponseSchema = z.object({
  access_token: z.string(),
  expires_in: z.number(),
  refresh_token: z.string().optional(),
  scope: z.string(),
  token_type: z.string(),
  id_token: z.string().optional(),
});
export type TokenResponse = z.infer<typeof TokenResponseSchema>;

export async function exchangeCode(code: string): Promise<TokenResponse> {
  const env = getEnv();
  if (!env.GOOGLE_OAUTH_CLIENT_ID || !env.GOOGLE_OAUTH_CLIENT_SECRET || !env.GOOGLE_OAUTH_REDIRECT_URI) {
    throw new Error('google_oauth_not_configured');
  }
  const body = new URLSearchParams({
    code,
    client_id: env.GOOGLE_OAUTH_CLIENT_ID,
    client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET,
    redirect_uri: env.GOOGLE_OAUTH_REDIRECT_URI,
    grant_type: 'authorization_code',
  });
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    throw new Error(`google_token_exchange_failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  }
  const json = await res.json();
  return TokenResponseSchema.parse(json);
}

// ---- Refresh token -----------------------------------------------------

const RefreshResponseSchema = z.object({
  access_token: z.string(),
  expires_in: z.number(),
  scope: z.string(),
  token_type: z.string().optional(),
  id_token: z.string().optional(),
});

export async function refreshAccessToken(refreshToken: string): Promise<{
  access_token: string;
  expires_in: number;
  scope: string;
}> {
  const env = getEnv();
  if (!env.GOOGLE_OAUTH_CLIENT_ID || !env.GOOGLE_OAUTH_CLIENT_SECRET) {
    throw new Error('google_oauth_not_configured');
  }
  const body = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: env.GOOGLE_OAUTH_CLIENT_ID,
    client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET,
    grant_type: 'refresh_token',
  });
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    throw new Error(`google_refresh_failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  }
  return RefreshResponseSchema.parse(await res.json());
}

// ---- Profile lookup ----------------------------------------------------

const UserInfoSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  verified_email: z.boolean().optional(),
  name: z.string().optional(),
  picture: z.string().optional(),
});
export type GoogleUserInfo = z.infer<typeof UserInfoSchema>;

export async function fetchUserInfo(accessToken: string): Promise<GoogleUserInfo> {
  const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`google_userinfo_failed: ${res.status}`);
  }
  return UserInfoSchema.parse(await res.json());
}

// ---- Drive: list folders -----------------------------------------------

const DriveFileSchema = z.object({
  id: z.string(),
  name: z.string(),
  mimeType: z.string(),
  modifiedTime: z.string().optional(),
  parents: z.array(z.string()).optional(),
});
export type DriveFile = z.infer<typeof DriveFileSchema>;

const DriveListResponseSchema = z.object({
  files: z.array(DriveFileSchema),
  nextPageToken: z.string().optional(),
});

/**
 * List the user's folders (top-level + recently modified). Used in the
 * "pick a folder to sync" UI. Returns up to ~100 folders.
 */
export async function listFolders(
  accessToken: string,
  opts: { pageSize?: number } = {},
): Promise<DriveFile[]> {
  const params = new URLSearchParams({
    q: "mimeType='application/vnd.google-apps.folder' and trashed=false",
    fields: 'files(id,name,mimeType,modifiedTime,parents),nextPageToken',
    orderBy: 'modifiedTime desc',
    pageSize: String(opts.pageSize ?? 100),
  });
  const res = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`drive_list_folders_failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  }
  return DriveListResponseSchema.parse(await res.json()).files;
}
