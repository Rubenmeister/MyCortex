import { z } from 'zod';

const env = {
  GOOGLE_OAUTH_CLIENT_ID: process.env.GOOGLE_OAUTH_CLIENT_ID ?? '',
  GOOGLE_OAUTH_CLIENT_SECRET: process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? '',
};

const RefreshSchema = z.object({
  access_token: z.string(),
  expires_in: z.number(),
  scope: z.string(),
  token_type: z.string().optional(),
});

export async function refreshAccessToken(refreshToken: string): Promise<{
  access_token: string;
  expires_in: number;
  scope: string;
}> {
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
  return RefreshSchema.parse(await res.json());
}

// ---- Event listing ---------------------------------------------------------

const DateTimeSchema = z.object({
  date: z.string().optional(),       // all-day events use date
  dateTime: z.string().optional(),    // timed events use dateTime
  timeZone: z.string().optional(),
});

const AttendeeSchema = z.object({
  email: z.string().optional(),
  displayName: z.string().optional(),
  responseStatus: z.string().optional(),
  organizer: z.boolean().optional(),
  self: z.boolean().optional(),
});

const EventSchema = z.object({
  id: z.string(),
  iCalUID: z.string().optional(),
  status: z.string().optional(),
  summary: z.string().optional(),
  description: z.string().optional(),
  location: z.string().optional(),
  start: DateTimeSchema.optional(),
  end: DateTimeSchema.optional(),
  attendees: z.array(AttendeeSchema).optional(),
  organizer: z
    .object({ email: z.string().optional(), displayName: z.string().optional() })
    .optional(),
  htmlLink: z.string().optional(),
  hangoutLink: z.string().optional(),
  updated: z.string().optional(),
  created: z.string().optional(),
  recurringEventId: z.string().optional(),
});
export type CalendarEvent = z.infer<typeof EventSchema>;

const ListEventsResponseSchema = z.object({
  items: z.array(EventSchema).optional(),
  nextPageToken: z.string().optional(),
});

/**
 * List events from a calendar, time-bounded. We use singleEvents=true so
 * recurring instances are flattened (we don't want "weekly standup" to
 * be one node — we want each instance with its specific date).
 */
export async function listEvents(
  accessToken: string,
  args: {
    calendarId: string;
    timeMin: string;
    timeMax: string;
    maxResults?: number;
  },
): Promise<CalendarEvent[]> {
  const out: CalendarEvent[] = [];
  let pageToken: string | undefined;
  const limit = args.maxResults ?? 500;

  do {
    const params = new URLSearchParams({
      timeMin: args.timeMin,
      timeMax: args.timeMax,
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: '250',
      showDeleted: 'false',
    });
    if (pageToken) params.set('pageToken', pageToken);

    const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(args.calendarId)}/events?${params}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      throw new Error(
        `calendar_list_events_failed: ${res.status} ${(await res.text()).slice(0, 200)}`,
      );
    }
    const json = ListEventsResponseSchema.parse(await res.json());
    for (const e of json.items ?? []) {
      if (e.status === 'cancelled') continue;
      out.push(e);
      if (out.length >= limit) return out;
    }
    pageToken = json.nextPageToken;
  } while (pageToken && out.length < limit);

  return out;
}

/**
 * Render an event as the searchable text that goes into the embedding.
 * Includes structured fields (title, when, where, who) as headers + the
 * description body. Designed so retrieval can match either the topic
 * ("reunión con John") or specifics ("reunión 14 de mayo").
 */
export function renderEventText(event: CalendarEvent): { title: string; body: string } {
  const summary = event.summary ?? '(sin título)';
  const startStr =
    event.start?.dateTime ?? event.start?.date ?? '';
  const endStr = event.end?.dateTime ?? event.end?.date ?? '';
  const start = startStr ? new Date(startStr) : null;

  const whenLine = startStr
    ? `Cuándo: ${start ? start.toLocaleString() : startStr}${endStr ? ` → ${new Date(endStr).toLocaleTimeString()}` : ''}`
    : '';
  const whereLine = event.location ? `Dónde: ${event.location}` : '';
  const organizerLine = event.organizer?.email
    ? `Organizador: ${event.organizer.displayName ?? event.organizer.email}`
    : '';
  const attendeesLine =
    event.attendees && event.attendees.length > 0
      ? `Asistentes: ${event.attendees
          .filter((a) => !a.self)
          .map((a) => a.displayName ?? a.email ?? '')
          .filter(Boolean)
          .slice(0, 20)
          .join(', ')}`
      : '';

  const headerLines = [
    `Evento: ${summary}`,
    whenLine,
    whereLine,
    organizerLine,
    attendeesLine,
  ].filter(Boolean);

  // Strip HTML from description (Calendar sends some events with rich text).
  const desc = (event.description ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

  const body = headerLines.join('\n') + (desc ? `\n\nDescripción:\n${desc}` : '');
  return { title: summary, body };
}
