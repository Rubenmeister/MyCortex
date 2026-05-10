import { z } from 'zod';
import { getEnv } from '../../lib/env.js';
import {
  buildGoogleAuthUrl,
  exchangeCode as exchangeCodeShared,
  refreshAccessToken as refreshAccessTokenShared,
  fetchUserInfo as fetchUserInfoShared,
  signState,
  verifyState,
  type GoogleUserInfo,
} from './oauth-shared.js';

/**
 * Google Drive helpers. OAuth state, token exchange, refresh, and userinfo
 * are shared with Gmail (see oauth-shared.ts) — this file only owns the
 * Drive-specific bits: scope set + folder listing.
 */

const DRIVE_SCOPES = [
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
] as const;

export const DRIVE_OAUTH_SCOPE = DRIVE_SCOPES.join(' ');

export { signState, verifyState };
export type { GoogleUserInfo };

// ---- OAuth URL -------------------------------------------------------------

export function buildAuthUrl(state: string): string {
  const env = getEnv();
  if (!env.GOOGLE_OAUTH_REDIRECT_URI) {
    throw new Error('google_oauth_not_configured');
  }
  return buildGoogleAuthUrl({
    scope: DRIVE_OAUTH_SCOPE,
    state,
    redirectUri: env.GOOGLE_OAUTH_REDIRECT_URI,
  });
}

export async function exchangeCode(code: string) {
  const env = getEnv();
  if (!env.GOOGLE_OAUTH_REDIRECT_URI) {
    throw new Error('google_oauth_not_configured');
  }
  return exchangeCodeShared({ code, redirectUri: env.GOOGLE_OAUTH_REDIRECT_URI });
}

export async function refreshAccessToken(refreshToken: string) {
  return refreshAccessTokenShared(refreshToken);
}

export async function fetchUserInfo(accessToken: string) {
  return fetchUserInfoShared(accessToken);
}

// ---- Drive: list folders ---------------------------------------------------

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
    supportsAllDrives: 'true',
    includeItemsFromAllDrives: 'true',
  });
  const res = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`drive_list_folders_failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  }
  return DriveListResponseSchema.parse(await res.json()).files;
}
