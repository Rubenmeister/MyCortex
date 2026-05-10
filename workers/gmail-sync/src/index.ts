import { z } from 'zod';
import { embedText } from '@mycortex/ai-core';
import { createDb, type Db } from '@mycortex/db';
import type { IntegrationRow, NodeInsert, SyncSourceRow } from '@mycortex/db/types';
import {
  collectBody,
  getHeader,
  getMessage,
  listMessageIds,
  refreshAccessToken,
  type GmailMessage,
} from './gmail.js';
import { chunkText, htmlToText, stripQuotesAndSignature } from './parse.js';

const EnvSchema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  OPENAI_API_KEY: z.string().min(1),
  GOOGLE_OAUTH_CLIENT_ID: z.string().min(1),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().min(1),
  GMAIL_SYNC_MAX_MESSAGES_PER_LABEL: z.coerce.number().int().positive().default(300),
  GMAIL_SYNC_NEWER_THAN_DAYS: z.coerce.number().int().positive().default(90),
  GMAIL_SYNC_CHUNK_WORDS: z.coerce.number().int().positive().default(500),
  GMAIL_SYNC_CHUNK_OVERLAP: z.coerce.number().int().nonnegative().default(100),
});

function log(level: 'info' | 'warn' | 'error', msg: string, extra: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ level, msg, ts: new Date().toISOString(), ...extra }));
}

async function ensureFreshToken(db: Db, integration: IntegrationRow): Promise<string> {
  const expiresAt = integration.token_expires_at
    ? new Date(integration.token_expires_at).getTime()
    : 0;
  if (expiresAt - Date.now() > 60_000) return integration.access_token;
  if (!integration.refresh_token) {
    throw new Error('no_refresh_token');
  }
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

type MsgSyncResult =
  | { kind: 'indexed'; chunks: number }
  | { kind: 'unchanged' }
  | { kind: 'skipped'; reason: string }
  | { kind: 'failed'; error: string };

/**
 * Build the full text that goes into the index for a single message.
 * Includes structured headers (From/To/Subject/Date) + clean body.
 */
function buildMessageText(msg: GmailMessage): { title: string; body: string } {
  const subject = getHeader(msg, 'subject') ?? '(sin asunto)';
  const from = getHeader(msg, 'from') ?? '';
  const to = getHeader(msg, 'to') ?? '';
  const date = getHeader(msg, 'date') ?? '';

  const { plain, html } = collectBody(msg.payload);
  let body = plain;
  if (!body && html) body = htmlToText(html);
  body = stripQuotesAndSignature(body);

  const header = [
    `From: ${from}`,
    `To: ${to}`,
    `Date: ${date}`,
    `Subject: ${subject}`,
  ].join('\n');

  return { title: subject, body: `${header}\n\n${body}` };
}

async function syncMessage(
  db: Db,
  args: {
    workspaceId: string;
    userId: string;
    accessToken: string;
    messageId: string;
    chunkWords: number;
    chunkOverlap: number;
  },
): Promise<MsgSyncResult> {
  let msg: GmailMessage;
  try {
    msg = await getMessage(args.accessToken, args.messageId);
  } catch (err) {
    return { kind: 'failed', error: `get:${String(err).slice(0, 200)}` };
  }

  // Idempotency: dedupe by RFC822 Message-ID header (immutable, unique).
  // Falls back to Gmail's own message id if header missing.
  const messageIdHeader = getHeader(msg, 'message-id') ?? `gmail:${msg.id}`;
  const externalIdPrefix = `${messageIdHeader}:`;

  const { data: existing } = await db
    .from('nodes')
    .select('id')
    .eq('workspace_id', args.workspaceId)
    .eq('external_source', 'gmail')
    .like('external_id', `${externalIdPrefix}%`)
    .limit(1);
  if (existing && existing.length > 0) {
    return { kind: 'unchanged' };
  }

  const { title, body } = buildMessageText(msg);
  if (!body || body.trim().length < 30) {
    return { kind: 'skipped', reason: 'empty_body' };
  }

  const chunks = chunkText(body, { words: args.chunkWords, overlap: args.chunkOverlap });
  if (chunks.length === 0) return { kind: 'skipped', reason: 'no_chunks' };

  const inserts: NodeInsert[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const content = chunks[i]!;
    let embedding: number[];
    try {
      embedding = await embedText(content);
    } catch (err) {
      return { kind: 'failed', error: `embed:${String(err).slice(0, 200)}` };
    }
    inserts.push({
      workspace_id: args.workspaceId,
      user_id: args.userId,
      kind: 'reference',
      category: 'unknown',
      title: chunks.length === 1 ? title : `${title} (${i + 1}/${chunks.length})`,
      content,
      source: 'gmail',
      embedding,
      external_source: 'gmail',
      external_id: `${messageIdHeader}:${i}`,
      external_metadata: {
        gmail_message_id: msg.id,
        gmail_thread_id: msg.threadId,
        message_id_header: messageIdHeader,
        from: getHeader(msg, 'from') ?? null,
        to: getHeader(msg, 'to') ?? null,
        subject: getHeader(msg, 'subject') ?? null,
        date: getHeader(msg, 'date') ?? null,
        internalDate: msg.internalDate ?? null,
        labels: msg.labelIds ?? [],
        chunk_index: i,
        total_chunks: chunks.length,
      },
      metadata: {},
    });
  }

  const { error } = await db.from('nodes').insert(inserts);
  if (error) return { kind: 'failed', error: `db:${error.message}` };
  return { kind: 'indexed', chunks: inserts.length };
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
  if (integration.provider !== 'gmail') {
    // sync_sources is shared with Drive — silently skip Drive sources.
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

  let messageIds: string[];
  try {
    messageIds = await listMessageIds(accessToken, {
      labelId: source.external_id,
      maxMessages: cfg.GMAIL_SYNC_MAX_MESSAGES_PER_LABEL,
      newerThanDays: cfg.GMAIL_SYNC_NEWER_THAN_DAYS,
    });
  } catch (err) {
    stats.errors.push(`list_messages_failed:${String(err).slice(0, 120)}`);
    return stats;
  }

  log('info', 'syncing_source', {
    workspaceId: source.workspace_id,
    sourceId: source.id,
    label: source.display_name,
    labelId: source.external_id,
    messages: messageIds.length,
  });

  for (const mid of messageIds) {
    const result = await syncMessage(db, {
      workspaceId: source.workspace_id,
      userId: integration.user_id,
      accessToken,
      messageId: mid,
      chunkWords: cfg.GMAIL_SYNC_CHUNK_WORDS,
      chunkOverlap: cfg.GMAIL_SYNC_CHUNK_OVERLAP,
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
        stats.errors.push(`${mid}:${result.error}`);
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

  log('info', 'gmail_sync_start');
  const started = Date.now();

  // Pull active sync_sources whose integration is gmail. We can't filter
  // by provider in one query (different table), so we pull all active and
  // syncSource() filters internally.
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

  const elapsedMs = Date.now() - started;
  log('info', 'gmail_sync_done', {
    elapsedMs,
    sources: processedSources,
    ...totals,
    sampleErrors: sourceErrors.slice(0, 5),
  });
}

main().catch((err) => {
  log('error', 'gmail_sync_crashed', { error: String(err) });
  process.exit(1);
});
