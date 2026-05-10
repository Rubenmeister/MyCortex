import { z } from 'zod';
import { embedText } from '@mycortex/ai-core';
import { createDb, type Db } from '@mycortex/db';
import type { IntegrationRow, NodeInsert, SyncSourceRow } from '@mycortex/db/types';
import {
  listEvents,
  refreshAccessToken,
  renderEventText,
  type CalendarEvent,
} from './calendar.js';

const EnvSchema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  OPENAI_API_KEY: z.string().min(1),
  GOOGLE_OAUTH_CLIENT_ID: z.string().min(1),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().min(1),
  // How far in the past + future to index. Past gives context for "what did
  // I discuss with X last month"; future gives context for "what's coming up".
  CALENDAR_SYNC_PAST_DAYS: z.coerce.number().int().positive().default(60),
  CALENDAR_SYNC_FUTURE_DAYS: z.coerce.number().int().positive().default(90),
  CALENDAR_SYNC_MAX_EVENTS_PER_CALENDAR: z.coerce.number().int().positive().default(500),
});

function log(level: 'info' | 'warn' | 'error', msg: string, extra: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ level, msg, ts: new Date().toISOString(), ...extra }));
}

async function ensureFreshToken(db: Db, integration: IntegrationRow): Promise<string> {
  const expiresAt = integration.token_expires_at
    ? new Date(integration.token_expires_at).getTime()
    : 0;
  if (expiresAt - Date.now() > 60_000) return integration.access_token;
  if (!integration.refresh_token) throw new Error('no_refresh_token');
  const refreshed = await refreshAccessToken(integration.refresh_token);
  const newExpiresAt = new Date(Date.now() + refreshed.expires_in * 1000).toISOString();
  await db
    .from('integrations')
    .update({
      access_token: refreshed.access_token,
      token_expires_at: newExpiresAt,
      scope: refreshed.scope,
      status: 'active',
      last_error: null,
    })
    .eq('id', integration.id);
  return refreshed.access_token;
}

type EventSyncResult =
  | { kind: 'indexed' }
  | { kind: 'unchanged' }
  | { kind: 'skipped'; reason: string }
  | { kind: 'failed'; error: string };

async function syncEvent(
  db: Db,
  args: { workspaceId: string; userId: string; event: CalendarEvent },
): Promise<EventSyncResult> {
  const { event, workspaceId, userId } = args;

  // Dedup by event.id (Google Calendar's unique id per event/instance).
  // For recurring events we use the per-instance id so each occurrence is
  // its own node — "tomorrow's standup" doesn't get conflated with last
  // week's.
  const externalId = event.id;
  const updated = event.updated ?? null;

  // Check existing — if already indexed and `updated` matches, skip.
  const { data: existing } = await db
    .from('nodes')
    .select('id, external_metadata')
    .eq('workspace_id', workspaceId)
    .eq('external_source', 'calendar')
    .eq('external_id', externalId)
    .limit(1);
  if (existing && existing.length > 0) {
    const meta = (existing[0]!.external_metadata ?? {}) as { updated?: string };
    if (meta.updated === updated) {
      return { kind: 'unchanged' };
    }
    // Updated — clear old before re-indexing.
    await db
      .from('nodes')
      .delete()
      .eq('workspace_id', workspaceId)
      .eq('external_source', 'calendar')
      .eq('external_id', externalId);
  }

  const { title, body } = renderEventText(event);
  if (!body || body.trim().length < 10) {
    return { kind: 'skipped', reason: 'empty_event' };
  }

  // Calendar events are short enough not to chunk; one node per event.
  let embedding: number[];
  try {
    embedding = await embedText(body);
  } catch (err) {
    return { kind: 'failed', error: `embed:${String(err).slice(0, 200)}` };
  }

  const insert: NodeInsert = {
    workspace_id: workspaceId,
    user_id: userId,
    kind: 'reference',
    category: 'unknown',
    title,
    content: body,
    source: 'calendar',
    embedding,
    external_source: 'calendar',
    external_id: externalId,
    external_metadata: {
      iCalUID: event.iCalUID ?? null,
      htmlLink: event.htmlLink ?? null,
      start: event.start?.dateTime ?? event.start?.date ?? null,
      end: event.end?.dateTime ?? event.end?.date ?? null,
      location: event.location ?? null,
      organizer_email: event.organizer?.email ?? null,
      organizer_name: event.organizer?.displayName ?? null,
      attendee_count: event.attendees?.length ?? 0,
      attendee_emails:
        (event.attendees ?? [])
          .map((a) => a.email)
          .filter((e): e is string => Boolean(e))
          .slice(0, 20),
      recurring: event.recurringEventId ? true : false,
      updated,
      created: event.created ?? null,
    },
    metadata: {},
  };

  const { error } = await db.from('nodes').insert(insert);
  if (error) return { kind: 'failed', error: `db:${error.message}` };
  return { kind: 'indexed' };
}

async function syncSource(
  db: Db,
  source: SyncSourceRow,
  cfg: z.infer<typeof EnvSchema>,
): Promise<{ indexed: number; unchanged: number; skipped: number; failed: number; errors: string[] }> {
  const stats = { indexed: 0, unchanged: 0, skipped: 0, failed: 0, errors: [] as string[] };

  const { data: integration, error: intErr } = await db
    .from('integrations')
    .select('*')
    .eq('id', source.integration_id)
    .maybeSingle();
  if (intErr || !integration) {
    stats.errors.push(`integration_lookup_failed:${intErr?.message ?? 'not_found'}`);
    return stats;
  }
  if (integration.provider !== 'google_calendar') {
    // sync_sources is shared with Drive/Gmail — silently skip non-calendar.
    return stats;
  }
  if (integration.status !== 'active') {
    stats.errors.push(`integration_status:${integration.status}`);
    return stats;
  }

  let accessToken: string;
  try {
    accessToken = await ensureFreshToken(db, integration);
  } catch (err) {
    stats.errors.push(`token_refresh_failed:${String(err).slice(0, 120)}`);
    await db
      .from('integrations')
      .update({ status: 'error', last_error: String(err).slice(0, 200) })
      .eq('id', integration.id);
    return stats;
  }

  const now = Date.now();
  const timeMin = new Date(now - cfg.CALENDAR_SYNC_PAST_DAYS * 86_400_000).toISOString();
  const timeMax = new Date(now + cfg.CALENDAR_SYNC_FUTURE_DAYS * 86_400_000).toISOString();

  let events: CalendarEvent[];
  try {
    events = await listEvents(accessToken, {
      calendarId: source.external_id,
      timeMin,
      timeMax,
      maxResults: cfg.CALENDAR_SYNC_MAX_EVENTS_PER_CALENDAR,
    });
  } catch (err) {
    stats.errors.push(`list_events_failed:${String(err).slice(0, 120)}`);
    return stats;
  }

  log('info', 'syncing_source', {
    workspaceId: source.workspace_id,
    sourceId: source.id,
    calendar: source.display_name,
    calendarId: source.external_id,
    events: events.length,
    window: { timeMin, timeMax },
  });

  for (const event of events) {
    const result = await syncEvent(db, {
      workspaceId: source.workspace_id,
      userId: integration.user_id,
      event,
    });
    switch (result.kind) {
      case 'indexed':
        stats.indexed++;
        break;
      case 'unchanged':
        stats.unchanged++;
        break;
      case 'skipped':
        stats.skipped++;
        break;
      case 'failed':
        stats.failed++;
        stats.errors.push(`${event.id}:${result.error}`);
        break;
    }
  }

  await db
    .from('sync_sources')
    .update({
      last_synced_at: new Date().toISOString(),
      items_synced: stats.indexed + stats.unchanged,
      status: stats.failed > 0 && stats.indexed === 0 ? 'error' : 'active',
      last_error: stats.errors.slice(0, 3).join(' | ') || null,
    })
    .eq('id', source.id);

  return stats;
}

async function main(): Promise<void> {
  const env = EnvSchema.safeParse(process.env);
  if (!env.success) {
    log('error', 'invalid_env', { issues: env.error.flatten().fieldErrors });
    process.exit(1);
  }
  const cfg = env.data;
  const db = createDb(cfg.SUPABASE_URL, cfg.SUPABASE_SERVICE_ROLE_KEY);

  log('info', 'calendar_sync_start');
  const started = Date.now();

  const { data: sources, error } = await db
    .from('sync_sources')
    .select('*')
    .eq('status', 'active');
  if (error) {
    log('error', 'list_sources_failed', { error: error.message });
    process.exit(1);
  }
  if (!sources || sources.length === 0) {
    log('info', 'no_active_sources');
    return;
  }

  const totals = { indexed: 0, unchanged: 0, skipped: 0, failed: 0 };
  const sourceErrors: string[] = [];
  let processedSources = 0;

  for (const src of sources) {
    const stats = await syncSource(db, src, cfg);
    if (stats.indexed + stats.unchanged + stats.skipped + stats.failed > 0) {
      processedSources++;
    }
    totals.indexed += stats.indexed;
    totals.unchanged += stats.unchanged;
    totals.skipped += stats.skipped;
    totals.failed += stats.failed;
    sourceErrors.push(...stats.errors.slice(0, 3));
  }

  log('info', 'calendar_sync_done', {
    elapsedMs: Date.now() - started,
    sources: processedSources,
    ...totals,
    sampleErrors: sourceErrors.slice(0, 5),
  });
}

main().catch((err) => {
  log('error', 'calendar_sync_crashed', { error: String(err) });
  process.exit(1);
});
