import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { getEnv } from '../../lib/env.js';

/**
 * Provider-agnostic OAuth helpers shared across Drive, Gmail (and future
 * Google integrations). Each provider keeps its own scope list + listing
 * endpoints, but state signing, code exchange, refresh, and userinfo are
 * identical across them.
 */

const STATE_TTL_MS = 10 * 60 * 1000;

export type OAuthState = {
  workspaceId: string;
  userId: string;
  nonce: string;
  iat: number;
};

function hmacSecret(): string {
  const env = getEnv();
  // Prefer the dedicated OAUTH_STATE_SECRET if provided. If not, fall
  // back to the service role key (legacy behavior) — production should
  // rotate to a separate value so a state-token leak doesn't expose the
  // master DB key.
  return env.OAUTH_STATE_SECRET ?? env.SUPABASE_SERVICE_ROLE_KEY;
}

/**
 * Defensive shape validation of the decoded state body. The HMAC proves
 * the server signed it, but we still validate the structure so a buggy
 * issuer can't ever bind an integration to a non-UUID id.
 */
const OAuthStateSchema = z.object({
  workspaceId: z.string().uuid(),
  userId: z.string().uuid(),
  nonce: z.string().min(1),
  iat: z.number(),
});

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
  // Constant-time comparison to prevent signature-leak timing attacks.
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expected);
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) {
    throw new Error('invalid_signature');
  }
  // Parse + structurally validate. Even with a valid HMAC, we reject
  // anything that doesn't match the expected shape so a future buggy
  // issuer can't ever bind an integration to a non-UUID id.
  const raw = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as unknown;
  const parsed = OAuthStateSchema.parse(raw);
  if (Date.now() - parsed.iat > STATE_TTL_MS) throw new Error('state_expired');
  return parsed;
}

// ---- Auth URL --------------------------------------------------------------

export function buildGoogleAuthUrl(args: {
  scope: string;
  state: string;
  redirectUri: string;
}): string {
  const env = getEnv();
  if (!env.GOOGLE_OAUTH_CLIENT_ID) {
    throw new Error('google_oauth_not_configured');
  }
  const params = new URLSearchParams({
    client_id: env.GOOGLE_OAUTH_CLIENT_ID,
    redirect_uri: args.redirectUri,
    response_type: 'code',
    scope: args.scope,
    access_type: 'offline',
    prompt: 'consent',
    state: args.state,
    include_granted_scopes: 'true',
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

// ---- Token exchange --------------------------------------------------------

const TokenResponseSchema = z.object({
  access_token: z.string(),
  expires_in: z.number(),
  refresh_token: z.string().optional(),
  scope: z.string(),
  token_type: z.string(),
  id_token: z.string().optional(),
});
export type TokenResponse = z.infer<typeof TokenResponseSchema>;

export async function exchangeCode(args: {
  code: string;
  redirectUri: string;
}): Promise<TokenResponse> {
  const env = getEnv();
  if (!env.GOOGLE_OAUTH_CLIENT_ID || !env.GOOGLE_OAUTH_CLIENT_SECRET) {
    throw new Error('google_oauth_not_configured');
  }
  const body = new URLSearchParams({
    code: args.code,
    client_id: env.GOOGLE_OAUTH_CLIENT_ID,
    client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET,
    redirect_uri: args.redirectUri,
    grant_type: 'authorization_code',
  });
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    throw new Error(
      `google_token_exchange_failed: ${res.status} ${(await res.text()).slice(0, 200)}`,
    );
  }
  return TokenResponseSchema.parse(await res.json());
}

// ---- Refresh token ---------------------------------------------------------

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

// ---- Profile ---------------------------------------------------------------

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
