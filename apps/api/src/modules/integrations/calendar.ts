import { z } from 'zod';
import { getEnv } from '../../lib/env.js';
import {
  buildGoogleAuthUrl,
  exchangeCode as exchangeCodeShared,
  refreshAccessToken as refreshAccessTokenShared,
  fetchUserInfo as fetchUserInfoShared,
} from './oauth-shared.js';

/**
 * Google Calendar helpers. Read-only — the worker indexes events but
 * never creates, modifies, or deletes them.
 *
 * Events look like nodes once flattened: title, location, attendees,
 * description, start/end time. The worker chunks the description but
 * indexes the structured fields as headers so retrieval can match
 * "reunión con John" → finds the event whose attendees include John.
 */

// Calendar OAuth scopes: we request the unified `calendar.readonly` which
// covers BOTH calendar listing AND event reading. Some app configurations
// only expose the granular replacements (calendarlist.readonly +
// events.readonly) in the Consent Screen picker — the callback validation
// in api/integrations/index.ts accepts either grant path.
const CALENDAR_SCOPES = [
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
] as const;

export const CALENDAR_OAUTH_SCOPE = CALENDAR_SCOPES.join(' ');

// ---- OAuth URL -------------------------------------------------------------

export function buildAuthUrl(state: string): string {
  const env = getEnv();
  if (!env.CALENDAR_OAUTH_REDIRECT_URI) {
    throw new Error('calendar_oauth_not_configured');
  }
  return buildGoogleAuthUrl({
    scope: CALENDAR_OAUTH_SCOPE,
    state,
    redirectUri: env.CALENDAR_OAUTH_REDIRECT_URI,
  });
}

export async function exchangeCode(code: string) {
  const env = getEnv();
  if (!env.CALENDAR_OAUTH_REDIRECT_URI) {
    throw new Error('calendar_oauth_not_configured');
  }
  return exchangeCodeShared({ code, redirectUri: env.CALENDAR_OAUTH_REDIRECT_URI });
}

export async function refreshAccessToken(refreshToken: string) {
  return refreshAccessTokenShared(refreshToken);
}

export async function fetchUserInfo(accessToken: string) {
  return fetchUserInfoShared(accessToken);
}

// ---- Calendar: list user calendars ----------------------------------------

const CalendarListEntrySchema = z.object({
  id: z.string(),
  summary: z.string().optional(),
  summaryOverride: z.string().optional(),
  description: z.string().optional(),
  primary: z.boolean().optional(),
  accessRole: z.string().optional(),
  backgroundColor: z.string().optional(),
});
export type CalendarListEntry = z.infer<typeof CalendarListEntrySchema>;

const CalendarListResponseSchema = z.object({
  items: z.array(CalendarListEntrySchema).optional(),
});

/**
 * Returns the user's calendar list. Used in the UI picker. The "primary"
 * calendar (their main one) is always first.
 */
export async function listCalendars(accessToken: string): Promise<CalendarListEntry[]> {
  const res = await fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(
      `calendar_list_failed: ${res.status} ${(await res.text()).slice(0, 200)}`,
    );
  }
  const parsed = CalendarListResponseSchema.parse(await res.json());
  const items = parsed.items ?? [];
  // Put the primary calendar first for nicer UX.
  return items.sort((a, b) => (b.primary ? 1 : 0) - (a.primary ? 1 : 0));
}
