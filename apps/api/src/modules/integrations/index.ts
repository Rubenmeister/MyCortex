import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../../lib/auth.js';
import { getDb } from '../../lib/db.js';
import { getEnv } from '../../lib/env.js';
import {
  buildAuthUrl as buildDriveAuthUrl,
  exchangeCode as exchangeDriveCode,
  fetchUserInfo as fetchDriveUserInfo,
  listFolders,
  refreshAccessToken as refreshDriveToken,
} from './drive.js';
import {
  buildAuthUrl as buildGmailAuthUrl,
  exchangeCode as exchangeGmailCode,
  fetchUserInfo as fetchGmailUserInfo,
  listLabels,
  refreshAccessToken as refreshGmailToken,
} from './gmail.js';
import {
  buildAuthUrl as buildCalendarAuthUrl,
  exchangeCode as exchangeCalendarCode,
  fetchUserInfo as fetchCalendarUserInfo,
  listCalendars,
  refreshAccessToken as refreshCalendarToken,
} from './calendar.js';
import { signState, verifyState } from './oauth-shared.js';
import type { IntegrationProvider, IntegrationRow } from '@mycortex/db/types';

/**
 * What the api returns about an integration to the client. Strips tokens.
 */
type IntegrationPublic = {
  id: string;
  provider: IntegrationProvider;
  status: string;
  external_account_email: string | null;
  external_account_id: string | null;
  scope: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

function toPublic(row: IntegrationRow): IntegrationPublic {
  return {
    id: row.id,
    provider: row.provider,
    status: row.status,
    external_account_email: row.external_account_email,
    external_account_id: row.external_account_id,
    scope: row.scope,
    last_error: row.last_error,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/**
 * Return a still-valid access token for the integration. If the cached
 * one is within 60s of expiry, refresh it via the refresh_token, persist
 * the new token, and return it. Caller is responsible for handling
 * "no refresh token" by reconnecting the user.
 */
async function ensureFreshToken(integration: IntegrationRow): Promise<string> {
  const expiresAt = integration.token_expires_at ? new Date(integration.token_expires_at).getTime() : 0;
  const now = Date.now();
  if (expiresAt - now > 60_000) return integration.access_token;
  if (!integration.refresh_token) {
    throw new Error('token_expired_no_refresh');
  }
  // Drive, Gmail, and Calendar all use Google's identical refresh endpoint,
  // but we route via the provider helper so future non-Google providers
  // (Notion, Slack) can plug in.
  const refreshed =
    integration.provider === 'gmail'
      ? await refreshGmailToken(integration.refresh_token)
      : integration.provider === 'google_calendar'
        ? await refreshCalendarToken(integration.refresh_token)
        : await refreshDriveToken(integration.refresh_token);
  const newExpiresAt = new Date(now + refreshed.expires_in * 1000).toISOString();
  await getDb()
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

export const integrationsModule: FastifyPluginAsync = async (server) => {
  // ---- GET /integrations -------------------------------------------------
  server.get('/', async (req, reply) => {
    const auth = await requireAuth(req, reply);
    if (!auth) return;
    const { data, error } = await getDb()
      .from('integrations')
      .select('*')
      .eq('workspace_id', auth.workspaceId)
      .order('created_at', { ascending: false });
    if (error) return reply.code(500).send({ error: 'db_error', detail: error.message });
    return reply.code(200).send({ integrations: (data ?? []).map(toPublic) });
  });

  // ---- DELETE /integrations/:id -----------------------------------------
  server.delete('/:id', async (req, reply) => {
    const auth = await requireAuth(req, reply);
    if (!auth) return;
    const params = z.object({ id: z.string().uuid() }).safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: 'invalid_id' });

    const { error } = await getDb()
      .from('integrations')
      .delete()
      .eq('id', params.data.id)
      .eq('workspace_id', auth.workspaceId);
    if (error) return reply.code(500).send({ error: 'db_error', detail: error.message });
    return reply.code(204).send();
  });

  // ---- GET /integrations/drive/connect -----------------------------------
  // Build the Google OAuth URL bound to the current user+workspace.
  server.get('/drive/connect', async (req, reply) => {
    const auth = await requireAuth(req, reply);
    if (!auth) return;
    const env = getEnv();
    if (!env.GOOGLE_OAUTH_CLIENT_ID || !env.GOOGLE_OAUTH_CLIENT_SECRET || !env.GOOGLE_OAUTH_REDIRECT_URI) {
      return reply.code(503).send({ error: 'google_oauth_not_configured' });
    }
    const state = signState({
      workspaceId: auth.workspaceId,
      userId: auth.userId,
      nonce: Math.random().toString(36).slice(2),
    });
    const authUrl = buildDriveAuthUrl(state);
    return reply.code(200).send({ authUrl });
  });

  // ---- GET /integrations/drive/callback ----------------------------------
  // Google redirects the browser here with ?code= and ?state=. We exchange
  // the code, save the integration, and 302 the user back to the web app.
  // This endpoint is unauthenticated by JWT (browser nav) but the `state`
  // is HMAC-signed so we trust it for workspace+user binding.
  server.get('/drive/callback', async (req, reply) => {
    const env = getEnv();
    const QuerySchema = z.object({
      code: z.string().optional(),
      error: z.string().optional(),
      state: z.string().optional(),
    });
    const q = QuerySchema.parse(req.query);
    const back = `${env.WEB_BASE_URL}/app/settings/integrations`;

    if (q.error) {
      return reply.redirect(`${back}?drive_error=${encodeURIComponent(q.error)}`);
    }
    if (!q.code || !q.state) {
      return reply.redirect(`${back}?drive_error=missing_code_or_state`);
    }

    let stateData;
    try {
      stateData = verifyState(q.state);
    } catch (err) {
      req.log.warn({ err: String(err) }, 'drive_state_invalid');
      return reply.redirect(`${back}?drive_error=invalid_state`);
    }

    let tokens;
    try {
      tokens = await exchangeDriveCode(q.code);
    } catch (err) {
      req.log.error({ err: String(err) }, 'drive_token_exchange_failed');
      return reply.redirect(`${back}?drive_error=token_exchange_failed`);
    }

    // Google's "granular consent" lets users opt out of individual scopes.
    // If Drive readonly isn't in the granted scope set, the integration is
    // useless — refuse to save it and tell the user to retry. Otherwise
    // they'd get cryptic 403s every time the worker tries to list files.
    const grantedScopes = new Set(tokens.scope.split(/\s+/).filter(Boolean));
    if (!grantedScopes.has('https://www.googleapis.com/auth/drive.readonly')) {
      req.log.warn({ scope: tokens.scope }, 'drive_scope_missing_drive_readonly');
      return reply.redirect(
        `${back}?drive_error=missing_drive_scope&granted=${encodeURIComponent(tokens.scope)}`,
      );
    }

    let userInfo;
    try {
      userInfo = await fetchDriveUserInfo(tokens.access_token);
    } catch (err) {
      req.log.error({ err: String(err) }, 'drive_userinfo_failed');
      return reply.redirect(`${back}?drive_error=userinfo_failed`);
    }

    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

    // Upsert by (workspace_id, provider, external_account_id).
    const { error } = await getDb()
      .from('integrations')
      .upsert(
        {
          workspace_id: stateData.workspaceId,
          user_id: stateData.userId,
          provider: 'google_drive',
          status: 'active',
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token ?? null,
          token_expires_at: expiresAt,
          scope: tokens.scope,
          external_account_email: userInfo.email,
          external_account_id: userInfo.id,
          metadata: { name: userInfo.name ?? null, picture: userInfo.picture ?? null },
          last_error: null,
        },
        { onConflict: 'workspace_id,provider,external_account_id' },
      );
    if (error) {
      req.log.error({ err: error.message }, 'drive_save_integration_failed');
      return reply.redirect(`${back}?drive_error=save_failed`);
    }

    return reply.redirect(`${back}?drive_connected=${encodeURIComponent(userInfo.email)}`);
  });

  // ---- GET /integrations/:id/sources ------------------------------------
  // List configured sync sources (folders) for this integration.
  server.get('/:id/sources', async (req, reply) => {
    const auth = await requireAuth(req, reply);
    if (!auth) return;
    const params = z.object({ id: z.string().uuid() }).safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: 'invalid_id' });

    const { data, error } = await getDb()
      .from('sync_sources')
      .select('*')
      .eq('integration_id', params.data.id)
      .eq('workspace_id', auth.workspaceId)
      .order('created_at', { ascending: false });
    if (error) return reply.code(500).send({ error: 'db_error', detail: error.message });
    return reply.code(200).send({ sources: data ?? [] });
  });

  // ---- POST /integrations/:id/sources -----------------------------------
  // Add a Drive folder as a sync source. Idempotent: if already exists,
  // returns the existing row.
  server.post('/:id/sources', async (req, reply) => {
    const auth = await requireAuth(req, reply);
    if (!auth) return;
    const params = z.object({ id: z.string().uuid() }).safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: 'invalid_id' });
    const body = z
      .object({
        externalId: z.string().min(1),
        displayName: z.string().min(1),
      })
      .safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_body', issues: body.error.issues });

    // Verify the integration belongs to the user's workspace before linking.
    const { data: integration } = await getDb()
      .from('integrations')
      .select('id,workspace_id')
      .eq('id', params.data.id)
      .eq('workspace_id', auth.workspaceId)
      .maybeSingle();
    if (!integration) return reply.code(404).send({ error: 'integration_not_found' });

    const { data, error } = await getDb()
      .from('sync_sources')
      .upsert(
        {
          integration_id: params.data.id,
          workspace_id: auth.workspaceId,
          external_id: body.data.externalId,
          display_name: body.data.displayName,
          status: 'active',
        },
        { onConflict: 'integration_id,external_id' },
      )
      .select()
      .single();
    if (error) return reply.code(500).send({ error: 'db_error', detail: error.message });
    return reply.code(200).send({ source: data });
  });

  // ---- DELETE /integrations/:id/sources/:sourceId -----------------------
  server.delete('/:id/sources/:sourceId', async (req, reply) => {
    const auth = await requireAuth(req, reply);
    if (!auth) return;
    const params = z
      .object({ id: z.string().uuid(), sourceId: z.string().uuid() })
      .safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: 'invalid_id' });

    const { error } = await getDb()
      .from('sync_sources')
      .delete()
      .eq('id', params.data.sourceId)
      .eq('integration_id', params.data.id)
      .eq('workspace_id', auth.workspaceId);
    if (error) return reply.code(500).send({ error: 'db_error', detail: error.message });
    return reply.code(204).send();
  });

  // ---- GET /integrations/:id/folders -------------------------------------
  // List the user's Drive folders so they can pick which to sync.
  server.get('/:id/folders', async (req, reply) => {
    const auth = await requireAuth(req, reply);
    if (!auth) return;
    const params = z.object({ id: z.string().uuid() }).safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: 'invalid_id' });

    const { data: integration, error } = await getDb()
      .from('integrations')
      .select('*')
      .eq('id', params.data.id)
      .eq('workspace_id', auth.workspaceId)
      .maybeSingle();
    if (error) return reply.code(500).send({ error: 'db_error', detail: error.message });
    if (!integration) return reply.code(404).send({ error: 'integration_not_found' });
    if (integration.provider !== 'google_drive')
      return reply.code(400).send({ error: 'wrong_provider' });

    let token: string;
    try {
      token = await ensureFreshToken(integration);
    } catch (err) {
      return reply.code(401).send({ error: 'token_refresh_failed', detail: String(err).slice(0, 120) });
    }

    try {
      const folders = await listFolders(token);
      return reply.code(200).send({ folders });
    } catch (err) {
      return reply.code(502).send({ error: 'drive_list_failed', detail: String(err).slice(0, 200) });
    }
  });

  // ---- GET /integrations/gmail/connect -----------------------------------
  // Build the Gmail OAuth URL bound to the current user+workspace.
  server.get('/gmail/connect', async (req, reply) => {
    const auth = await requireAuth(req, reply);
    if (!auth) return;
    const env = getEnv();
    if (!env.GOOGLE_OAUTH_CLIENT_ID || !env.GOOGLE_OAUTH_CLIENT_SECRET || !env.GMAIL_OAUTH_REDIRECT_URI) {
      return reply.code(503).send({ error: 'gmail_oauth_not_configured' });
    }
    const state = signState({
      workspaceId: auth.workspaceId,
      userId: auth.userId,
      nonce: Math.random().toString(36).slice(2),
    });
    const authUrl = buildGmailAuthUrl(state);
    return reply.code(200).send({ authUrl });
  });

  // ---- GET /integrations/gmail/callback ----------------------------------
  // Mirrors /drive/callback. The OAuth flow is identical except for scope
  // and the granular-consent check.
  server.get('/gmail/callback', async (req, reply) => {
    const env = getEnv();
    const QuerySchema = z.object({
      code: z.string().optional(),
      error: z.string().optional(),
      state: z.string().optional(),
    });
    const q = QuerySchema.parse(req.query);
    const back = `${env.WEB_BASE_URL}/app/settings/integrations`;

    if (q.error) {
      return reply.redirect(`${back}?gmail_error=${encodeURIComponent(q.error)}`);
    }
    if (!q.code || !q.state) {
      return reply.redirect(`${back}?gmail_error=missing_code_or_state`);
    }

    let stateData;
    try {
      stateData = verifyState(q.state);
    } catch (err) {
      req.log.warn({ err: String(err) }, 'gmail_state_invalid');
      return reply.redirect(`${back}?gmail_error=invalid_state`);
    }

    let tokens;
    try {
      tokens = await exchangeGmailCode(q.code);
    } catch (err) {
      req.log.error({ err: String(err) }, 'gmail_token_exchange_failed');
      return reply.redirect(`${back}?gmail_error=token_exchange_failed`);
    }

    // Granular consent: reject if gmail.readonly is missing.
    const grantedScopes = new Set(tokens.scope.split(/\s+/).filter(Boolean));
    if (!grantedScopes.has('https://www.googleapis.com/auth/gmail.readonly')) {
      req.log.warn({ scope: tokens.scope }, 'gmail_scope_missing_readonly');
      return reply.redirect(
        `${back}?gmail_error=missing_gmail_scope&granted=${encodeURIComponent(tokens.scope)}`,
      );
    }

    let userInfo;
    try {
      userInfo = await fetchGmailUserInfo(tokens.access_token);
    } catch (err) {
      req.log.error({ err: String(err) }, 'gmail_userinfo_failed');
      return reply.redirect(`${back}?gmail_error=userinfo_failed`);
    }

    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

    // Upsert integration row.
    const { data: integrationRow, error: upsertErr } = await getDb()
      .from('integrations')
      .upsert(
        {
          workspace_id: stateData.workspaceId,
          user_id: stateData.userId,
          provider: 'gmail',
          status: 'active',
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token ?? null,
          token_expires_at: expiresAt,
          scope: tokens.scope,
          external_account_email: userInfo.email,
          external_account_id: userInfo.id,
          metadata: { name: userInfo.name ?? null, picture: userInfo.picture ?? null },
          last_error: null,
        },
        { onConflict: 'workspace_id,provider,external_account_id' },
      )
      .select()
      .single();
    if (upsertErr || !integrationRow) {
      req.log.error({ err: upsertErr?.message }, 'gmail_save_integration_failed');
      return reply.redirect(`${back}?gmail_error=save_failed`);
    }

    // Auto-create a default sync source: INBOX, last 90 days. Users can
    // remove it or add more labels later. The worker reads display_name +
    // external_id (= label id) for what to fetch.
    await getDb()
      .from('sync_sources')
      .upsert(
        {
          integration_id: integrationRow.id,
          workspace_id: stateData.workspaceId,
          external_id: 'INBOX',
          display_name: 'INBOX (last 90 days)',
          status: 'active',
        },
        { onConflict: 'integration_id,external_id' },
      );

    return reply.redirect(`${back}?gmail_connected=${encodeURIComponent(userInfo.email)}`);
  });

  // ---- GET /integrations/:id/labels --------------------------------------
  // List the user's Gmail labels so they can pick which to sync. (Mirrors
  // /:id/folders for Drive but for Gmail.)
  server.get('/:id/labels', async (req, reply) => {
    const auth = await requireAuth(req, reply);
    if (!auth) return;
    const params = z.object({ id: z.string().uuid() }).safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: 'invalid_id' });

    const { data: integration, error } = await getDb()
      .from('integrations')
      .select('*')
      .eq('id', params.data.id)
      .eq('workspace_id', auth.workspaceId)
      .maybeSingle();
    if (error) return reply.code(500).send({ error: 'db_error', detail: error.message });
    if (!integration) return reply.code(404).send({ error: 'integration_not_found' });
    if (integration.provider !== 'gmail')
      return reply.code(400).send({ error: 'wrong_provider' });

    let token: string;
    try {
      token = await ensureFreshToken(integration);
    } catch (err) {
      return reply.code(401).send({ error: 'token_refresh_failed', detail: String(err).slice(0, 120) });
    }

    try {
      const labels = await listLabels(token);
      return reply.code(200).send({ labels });
    } catch (err) {
      return reply.code(502).send({ error: 'gmail_list_failed', detail: String(err).slice(0, 200) });
    }
  });

  // ---- GET /integrations/calendar/connect --------------------------------
  server.get('/calendar/connect', async (req, reply) => {
    const auth = await requireAuth(req, reply);
    if (!auth) return;
    const env = getEnv();
    if (
      !env.GOOGLE_OAUTH_CLIENT_ID ||
      !env.GOOGLE_OAUTH_CLIENT_SECRET ||
      !env.CALENDAR_OAUTH_REDIRECT_URI
    ) {
      return reply.code(503).send({ error: 'calendar_oauth_not_configured' });
    }
    const state = signState({
      workspaceId: auth.workspaceId,
      userId: auth.userId,
      nonce: Math.random().toString(36).slice(2),
    });
    const authUrl = buildCalendarAuthUrl(state);
    return reply.code(200).send({ authUrl });
  });

  // ---- GET /integrations/calendar/callback -------------------------------
  server.get('/calendar/callback', async (req, reply) => {
    const env = getEnv();
    const QuerySchema = z.object({
      code: z.string().optional(),
      error: z.string().optional(),
      state: z.string().optional(),
    });
    const q = QuerySchema.parse(req.query);
    const back = `${env.WEB_BASE_URL}/app/settings/integrations`;

    if (q.error) {
      return reply.redirect(`${back}?calendar_error=${encodeURIComponent(q.error)}`);
    }
    if (!q.code || !q.state) {
      return reply.redirect(`${back}?calendar_error=missing_code_or_state`);
    }

    let stateData;
    try {
      stateData = verifyState(q.state);
    } catch (err) {
      req.log.warn({ err: String(err) }, 'calendar_state_invalid');
      return reply.redirect(`${back}?calendar_error=invalid_state`);
    }

    let tokens;
    try {
      tokens = await exchangeCalendarCode(q.code);
    } catch (err) {
      req.log.error({ err: String(err) }, 'calendar_token_exchange_failed');
      return reply.redirect(`${back}?calendar_error=token_exchange_failed`);
    }

    const grantedScopes = new Set(tokens.scope.split(/\s+/).filter(Boolean));
    if (!grantedScopes.has('https://www.googleapis.com/auth/calendar.readonly')) {
      req.log.warn({ scope: tokens.scope }, 'calendar_scope_missing_readonly');
      return reply.redirect(
        `${back}?calendar_error=missing_calendar_scope&granted=${encodeURIComponent(tokens.scope)}`,
      );
    }

    let userInfo;
    try {
      userInfo = await fetchCalendarUserInfo(tokens.access_token);
    } catch (err) {
      req.log.error({ err: String(err) }, 'calendar_userinfo_failed');
      return reply.redirect(`${back}?calendar_error=userinfo_failed`);
    }

    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

    const { data: integrationRow, error: upsertErr } = await getDb()
      .from('integrations')
      .upsert(
        {
          workspace_id: stateData.workspaceId,
          user_id: stateData.userId,
          provider: 'google_calendar',
          status: 'active',
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token ?? null,
          token_expires_at: expiresAt,
          scope: tokens.scope,
          external_account_email: userInfo.email,
          external_account_id: userInfo.id,
          metadata: { name: userInfo.name ?? null, picture: userInfo.picture ?? null },
          last_error: null,
        },
        { onConflict: 'workspace_id,provider,external_account_id' },
      )
      .select()
      .single();
    if (upsertErr || !integrationRow) {
      req.log.error({ err: upsertErr?.message }, 'calendar_save_integration_failed');
      return reply.redirect(`${back}?calendar_error=save_failed`);
    }

    // Auto-create a default sync source: the primary calendar. The "primary"
    // alias is special — it always resolves to the user's main calendar.
    await getDb()
      .from('sync_sources')
      .upsert(
        {
          integration_id: integrationRow.id,
          workspace_id: stateData.workspaceId,
          external_id: 'primary',
          display_name: `${userInfo.email} (primary)`,
          status: 'active',
        },
        { onConflict: 'integration_id,external_id' },
      );

    return reply.redirect(`${back}?calendar_connected=${encodeURIComponent(userInfo.email)}`);
  });

  // ---- GET /integrations/:id/calendars -----------------------------------
  // List the user's calendars so they can pick which to sync. (Mirrors
  // /:id/folders for Drive / /:id/labels for Gmail.)
  server.get('/:id/calendars', async (req, reply) => {
    const auth = await requireAuth(req, reply);
    if (!auth) return;
    const params = z.object({ id: z.string().uuid() }).safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: 'invalid_id' });

    const { data: integration, error } = await getDb()
      .from('integrations')
      .select('*')
      .eq('id', params.data.id)
      .eq('workspace_id', auth.workspaceId)
      .maybeSingle();
    if (error) return reply.code(500).send({ error: 'db_error', detail: error.message });
    if (!integration) return reply.code(404).send({ error: 'integration_not_found' });
    if (integration.provider !== 'google_calendar')
      return reply.code(400).send({ error: 'wrong_provider' });

    let token: string;
    try {
      token = await ensureFreshToken(integration);
    } catch (err) {
      return reply.code(401).send({ error: 'token_refresh_failed', detail: String(err).slice(0, 120) });
    }

    try {
      const calendars = await listCalendars(token);
      return reply.code(200).send({ calendars });
    } catch (err) {
      return reply.code(502).send({ error: 'calendar_list_failed', detail: String(err).slice(0, 200) });
    }
  });
};

// Re-export for the worker's benefit.
export { ensureFreshToken };
