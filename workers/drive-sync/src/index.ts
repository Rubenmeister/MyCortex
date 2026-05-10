import { z } from 'zod';
import { embedText } from '@mycortex/ai-core';
import { createDb, type Db } from '@mycortex/db';
import type { IntegrationRow, NodeInsert, SyncSourceRow } from '@mycortex/db/types';
import { downloadFile, listFilesInFolder, refreshAccessToken, type DriveFile } from './drive.js';
import { chunkText, extractText } from './parse.js';

const EnvSchema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  OPENAI_API_KEY: z.string().min(1),
  GOOGLE_OAUTH_CLIENT_ID: z.string().min(1),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().min(1),
  DRIVE_SYNC_MAX_FILES_PER_FOLDER: z.coerce.number().int().positive().default(200),
  DRIVE_SYNC_MAX_FILE_BYTES: z.coerce.number().int().positive().default(10 * 1024 * 1024),
  DRIVE_SYNC_CHUNK_WORDS: z.coerce.number().int().positive().default(500),
  DRIVE_SYNC_CHUNK_OVERLAP: z.coerce.number().int().nonnegative().default(100),
});

function log(level: 'info' | 'warn' | 'error', msg: string, extra: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ level, msg, ts: new Date().toISOString(), ...extra }));
}

/**
 * Get a still-valid access token for an integration. Refreshes if within 60s
 * of expiry; persists the new token back to DB. Mirrors api/integrations/
 * ensureFreshToken (we duplicate here so the worker has zero coupling to
 * the api process).
 */
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

type FileSyncResult =
  | { kind: 'indexed'; chunks: number }
  | { kind: 'unchanged' }
  | { kind: 'skipped'; reason: string }
  | { kind: 'failed'; error: string };

async function syncFile(
  db: Db,
  args: {
    workspaceId: string;
    userId: string;
    accessToken: string;
    file: DriveFile;
    chunkWords: number;
    chunkOverlap: number;
    maxBytes: number;
  },
): Promise<FileSyncResult> {
  const { file, accessToken, workspaceId, userId, chunkWords, chunkOverlap, maxBytes } = args;

  // Skip if too large
  const sizeBytes = file.size ? Number(file.size) : 0;
  if (sizeBytes > maxBytes) {
    return { kind: 'skipped', reason: `too_large(${sizeBytes})` };
  }

  // Idempotency: if any chunk for this file already exists with the same
  // modifiedTime, skip. We store modifiedTime in the metadata to detect
  // changes between syncs.
  const externalIdPrefix = `${file.id}:`;
  const { data: existing } = await db
    .from('nodes')
    .select('id, external_id, external_metadata')
    .eq('workspace_id', workspaceId)
    .eq('external_source', 'drive')
    .like('external_id', `${externalIdPrefix}%`)
    .limit(1);
  if (existing && existing.length > 0) {
    const meta = (existing[0]!.external_metadata ?? {}) as { modifiedTime?: string };
    if (meta.modifiedTime === file.modifiedTime) {
      return { kind: 'unchanged' };
    }
    // Modified — clear old chunks before re-indexing.
    await db
      .from('nodes')
      .delete()
      .eq('workspace_id', workspaceId)
      .eq('external_source', 'drive')
      .like('external_id', `${externalIdPrefix}%`);
  }

  // Download + parse
  let text: string;
  try {
    const dl = await downloadFile(accessToken, file);
    text = await extractText(dl.buffer, dl.mimeType);
  } catch (err) {
    return { kind: 'failed', error: `parse:${String(err).slice(0, 200)}` };
  }
  if (!text || text.trim().length < 20) {
    return { kind: 'skipped', reason: 'empty_text' };
  }

  // Chunk
  const chunks = chunkText(text, { words: chunkWords, overlap: chunkOverlap });
  if (chunks.length === 0) return { kind: 'skipped', reason: 'no_chunks' };

  // Embed each chunk and prepare batch insert
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
      workspace_id: workspaceId,
      user_id: userId,
      kind: 'reference',
      category: 'unknown',
      title: chunks.length === 1 ? file.name : `${file.name} (${i + 1}/${chunks.length})`,
      content,
      source: 'drive',
      embedding,
      external_source: 'drive',
      external_id: `${file.id}:${i}`,
      external_metadata: {
        filename: file.name,
        mime_type: file.mimeType,
        modifiedTime: file.modifiedTime ?? null,
        chunk_index: i,
        total_chunks: chunks.length,
        drive_file_id: file.id,
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

  // Fetch the integration this source belongs to
  const { data: integration, error: intErr } = await db
    .from('integrations')
    .select('*')
    .eq('id', source.integration_id)
    .maybeSingle();
  if (intErr || !integration) {
    stats.errors.push(`integration_lookup_failed:${intErr?.message ?? 'not_found'}`);
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

  let listing: { supported: DriveFile[]; mimeBreakdown: Record<string, number>; totalFiles: number };
  try {
    listing = await listFilesInFolder(accessToken, source.external_id, {
      maxFiles: cfg.DRIVE_SYNC_MAX_FILES_PER_FOLDER,
    });
  } catch (err) {
    stats.errors.push(`list_files_failed:${String(err).slice(0, 120)}`);
    return stats;
  }

  log('info', 'syncing_source', {
    workspaceId: source.workspace_id,
    sourceId: source.id,
    folder: source.display_name,
    folderId: source.external_id,
    totalFiles: listing.totalFiles,
    supportedFiles: listing.supported.length,
    mimeBreakdown: listing.mimeBreakdown,
  });

  for (const file of listing.supported) {
    const result = await syncFile(db, {
      workspaceId: source.workspace_id,
      userId: integration.user_id,
      accessToken,
      file,
      chunkWords: cfg.DRIVE_SYNC_CHUNK_WORDS,
      chunkOverlap: cfg.DRIVE_SYNC_CHUNK_OVERLAP,
      maxBytes: cfg.DRIVE_SYNC_MAX_FILE_BYTES,
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
        stats.errors.push(`${file.name}:${result.error}`);
        break;
    }
  }

  // Persist progress on the source row
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

  log('info', 'drive_sync_start');
  const started = Date.now();

  // Pull all active sync sources for google_drive integrations.
  // RLS bypassed by service role.
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

  for (const src of sources) {
    const stats = await syncSource(db, src, cfg);
    totals.indexed += stats.indexed;
    totals.unchanged += stats.unchanged;
    totals.skipped += stats.skipped;
    totals.failed += stats.failed;
    sourceErrors.push(...stats.errors.slice(0, 3));
  }

  const elapsedMs = Date.now() - started;
  log('info', 'drive_sync_done', {
    elapsedMs,
    sources: sources.length,
    ...totals,
    sampleErrors: sourceErrors.slice(0, 5),
  });
}

main().catch((err) => {
  log('error', 'drive_sync_crashed', { error: String(err) });
  process.exit(1);
});
