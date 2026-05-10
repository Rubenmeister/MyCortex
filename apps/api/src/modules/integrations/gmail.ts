import { z } from 'zod';
import { getEnv } from '../../lib/env.js';
import {
  buildGoogleAuthUrl,
  exchangeCode as exchangeCodeShared,
  refreshAccessToken as refreshAccessTokenShared,
  fetchUserInfo as fetchUserInfoShared,
} from './oauth-shared.js';

/**
 * Gmail helpers. We use only the readonly scope — the worker indexes
 * messages but never sends, modifies, or deletes mail.
 *
 * The Gmail API is large; for indexing we only need:
 *   - users.threads.list (paginated, supports `q` and `labelIds`)
 *   - users.messages.get (returns full payload)
 * The worker is what calls list/get; the API only handles OAuth + UI.
 */

const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
] as const;

export const GMAIL_OAUTH_SCOPE = GMAIL_SCOPES.join(' ');

// ---- OAuth URL -------------------------------------------------------------

export function buildAuthUrl(state: string): string {
  const env = getEnv();
  if (!env.GMAIL_OAUTH_REDIRECT_URI) {
    throw new Error('gmail_oauth_not_configured');
  }
  return buildGoogleAuthUrl({
    scope: GMAIL_OAUTH_SCOPE,
    state,
    redirectUri: env.GMAIL_OAUTH_REDIRECT_URI,
  });
}

export async function exchangeCode(code: string) {
  const env = getEnv();
  if (!env.GMAIL_OAUTH_REDIRECT_URI) {
    throw new Error('gmail_oauth_not_configured');
  }
  return exchangeCodeShared({ code, redirectUri: env.GMAIL_OAUTH_REDIRECT_URI });
}

export async function refreshAccessToken(refreshToken: string) {
  return refreshAccessTokenShared(refreshToken);
}

export async function fetchUserInfo(accessToken: string) {
  return fetchUserInfoShared(accessToken);
}

// ---- Gmail: list labels (UI helper) ---------------------------------------

const LabelSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string().optional(),
  messageListVisibility: z.string().optional(),
  labelListVisibility: z.string().optional(),
});
export type GmailLabel = z.infer<typeof LabelSchema>;

const LabelsListSchema = z.object({
  labels: z.array(LabelSchema),
});

/**
 * Returns the user's Gmail labels. We expose this so the UI can offer a
 * "pick which labels to sync" picker (e.g. INBOX, custom labels).
 */
export async function listLabels(accessToken: string): Promise<GmailLabel[]> {
  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/labels', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`gmail_list_labels_failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  }
  return LabelsListSchema.parse(await res.json()).labels;
}
