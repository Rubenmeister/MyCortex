import { randomBytes } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { Db } from '@mycortex/db';
import type { WorkspaceRole } from '@mycortex/db/types';
import { requireAuth } from '../../lib/auth.js';
import { getDb } from '../../lib/db.js';
import { getEnv } from '../../lib/env.js';
import { renderInvitationEmail, sendEmail } from '../../lib/email.js';

/**
 * Look up an auth.users row by email. Supabase admin.listUsers paginates
 * at 1000 per page — beyond that, the existing single-page lookup
 * silently fails to find users (returns "not found"). This pages
 * through all users until a match is found or the pages are exhausted.
 *
 * For multi-thousand-user deployments we should swap this to a direct
 * SQL query against auth.users with an index on email; for now linear
 * pagination is fine.
 */
async function findUserByEmail(
  db: Db,
  email: string,
  maxPages = 50,
): Promise<{ id: string; email: string | null } | null> {
  const target = email.toLowerCase().trim();
  for (let page = 1; page <= maxPages; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`listUsers: ${error.message}`);
    if (!data || data.users.length === 0) return null;
    const found = data.users.find((u) => u.email?.toLowerCase() === target);
    if (found) return { id: found.id, email: found.email ?? null };
    if (data.users.length < 1000) return null; // last page
  }
  return null;
}

/**
 * Workspaces module: list/create workspaces, manage members.
 *
 * Most reads use the user-scoped `auth.db` (RLS enforces "members only see
 * their own membership"). For listing OTHER members of a workspace we need
 * to bypass RLS — the service-role client does this, AFTER we verify the
 * caller is themselves a member of the target workspace.
 */
export const workspacesModule: FastifyPluginAsync = async (server) => {
  // ---------------------------------------------------------------- LIST
  /**
   * GET /workspaces — every workspace the current user belongs to,
   * with their role in each.
   */
  server.get('/', async (req, reply) => {
    const auth = await requireAuth(req, reply);
    if (!auth) return;

    // Two queries since our hand-typed Database doesn't declare the FK
    // relationship between workspace_members and workspaces (that would
    // otherwise let us nest-select in one go via Supabase's relationship
    // resolver). Cheap enough for the current scale.
    const db = getDb();
    const { data: memberships, error: mErr } = await db
      .from('workspace_members')
      .select('workspace_id, role')
      .eq('user_id', auth.userId);
    if (mErr) return reply.code(500).send({ error: 'db_error', detail: mErr.message });

    const ids = (memberships ?? []).map((m) => m.workspace_id);
    if (ids.length === 0) return reply.code(200).send({ workspaces: [] });

    const { data: ws, error: wErr } = await db
      .from('workspaces')
      .select('id, name, slug, is_personal, owner_id, created_at')
      .in('id', ids);
    if (wErr) return reply.code(500).send({ error: 'db_error', detail: wErr.message });

    const roleByWs = new Map((memberships ?? []).map((m) => [m.workspace_id, m.role as WorkspaceRole]));
    const workspaces = (ws ?? []).map((w) => ({
      ...w,
      role: roleByWs.get(w.id) ?? ('member' as WorkspaceRole),
    }));
    // Personal first, then by created_at
    workspaces.sort((a, b) => {
      if (a.is_personal !== b.is_personal) return a.is_personal ? -1 : 1;
      return a.created_at < b.created_at ? -1 : 1;
    });

    return reply.code(200).send({ workspaces });
  });

  // ---------------------------------------------------------------- CREATE
  const CreateBody = z.object({
    name: z.string().trim().min(1).max(80),
  });
  /**
   * POST /workspaces — create a NEW non-personal workspace owned by the
   * current user. The user is automatically added as 'owner' member.
   */
  server.post('/', async (req, reply) => {
    const auth = await requireAuth(req, reply);
    if (!auth) return;
    const body = CreateBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_request', issues: body.error.issues });

    const slug = `team-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const db = getDb(); // service role: workspaces RLS allows owner self-insert but it's simpler from server side

    const { data: ws, error: e1 } = await db
      .from('workspaces')
      .insert({ name: body.data.name, slug, owner_id: auth.userId, is_personal: false })
      .select('id, name, slug, is_personal, owner_id, created_at')
      .single();
    if (e1 || !ws) return reply.code(500).send({ error: 'create_workspace_failed', detail: e1?.message });

    const { error: e2 } = await db
      .from('workspace_members')
      .insert({ workspace_id: ws.id, user_id: auth.userId, role: 'owner' });
    if (e2) return reply.code(500).send({ error: 'add_owner_failed', detail: e2.message });

    return reply.code(201).send({ workspace: { ...ws, role: 'owner' as WorkspaceRole } });
  });

  // ---------------------------------------------------------------- LIST MEMBERS
  /**
   * GET /workspaces/:id/members — list all members of a workspace the
   * caller belongs to. Uses service-role to see members other than self
   * (RLS would otherwise filter to just the caller's own row).
   */
  const IdParam = z.object({ id: z.string().uuid() });
  server.get('/:id/members', async (req, reply) => {
    const auth = await requireAuth(req, reply);
    if (!auth) return;
    const params = IdParam.safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: 'invalid_workspace_id' });

    const callerMembership = await assertMember(params.data.id, auth.userId);
    if (!callerMembership) return reply.code(403).send({ error: 'not_a_member' });

    const db = getDb();
    const { data, error } = await db
      .from('workspace_members')
      .select('user_id, role, created_at')
      .eq('workspace_id', params.data.id)
      .order('created_at', { ascending: true });
    if (error) return reply.code(500).send({ error: 'db_error', detail: error.message });

    // Pull email per user via Supabase admin API (auth.users is not directly queryable via REST).
    const members = await Promise.all(
      (data ?? []).map(async (row) => {
        const { data: u } = await db.auth.admin.getUserById(row.user_id);
        return {
          user_id: row.user_id,
          role: row.role as WorkspaceRole,
          email: u?.user?.email ?? null,
          created_at: row.created_at,
        };
      }),
    );

    return reply.code(200).send({ members });
  });

  // ---------------------------------------------------------------- INVITE
  const InviteBody = z.object({
    email: z.string().email(),
    role: z.enum(['admin', 'member', 'viewer']).default('member'),
  });
  /**
   * POST /workspaces/:id/members — invite an EXISTING user by email.
   * For MVP we only support inviting users who already have an account
   * (no email invitation flow yet). 404s if the email doesn't match an
   * auth.users entry.
   *
   * Caller must be owner or admin of the workspace.
   */
  server.post('/:id/members', async (req, reply) => {
    const auth = await requireAuth(req, reply);
    if (!auth) return;
    const params = IdParam.safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: 'invalid_workspace_id' });
    const body = InviteBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_request', issues: body.error.issues });

    const callerMembership = await assertMember(params.data.id, auth.userId);
    if (!callerMembership) return reply.code(403).send({ error: 'not_a_member' });
    if (callerMembership.role !== 'owner' && callerMembership.role !== 'admin') {
      return reply.code(403).send({ error: 'insufficient_role' });
    }

    // Resolve target user by email (admin API). Pages through all users
    // so > 1000-user deployments don't silently fail to find someone.
    const db = getDb();
    let target: { id: string; email: string | null } | null;
    try {
      target = await findUserByEmail(db, body.data.email);
    } catch (err) {
      return reply.code(500).send({ error: 'lookup_failed', detail: String(err).slice(0, 120) });
    }
    if (!target) return reply.code(404).send({ error: 'user_not_found', email: body.data.email });

    // Already a member? Idempotent — return current row.
    const { data: existing } = await db
      .from('workspace_members')
      .select('role, created_at')
      .eq('workspace_id', params.data.id)
      .eq('user_id', target.id)
      .maybeSingle();
    if (existing) {
      return reply.code(200).send({
        member: { user_id: target.id, role: existing.role, email: target.email, created_at: existing.created_at },
        already_member: true,
      });
    }

    const { error: insErr } = await db
      .from('workspace_members')
      .insert({ workspace_id: params.data.id, user_id: target.id, role: body.data.role });
    if (insErr) return reply.code(500).send({ error: 'insert_failed', detail: insErr.message });

    return reply.code(201).send({
      member: {
        user_id: target.id,
        role: body.data.role,
        email: target.email,
        created_at: new Date().toISOString(),
      },
    });
  });

  // ---------------------------------------------------------------- CHANGE ROLE
  const RoleBody = z.object({
    role: z.enum(['owner', 'admin', 'member', 'viewer']),
  });
  const MemberParams = z.object({ id: z.string().uuid(), userId: z.string().uuid() });
  /**
   * PATCH /workspaces/:id/members/:userId — change a member's role.
   * Only the workspace owner can change roles.
   */
  server.patch('/:id/members/:userId', async (req, reply) => {
    const auth = await requireAuth(req, reply);
    if (!auth) return;
    const params = MemberParams.safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: 'invalid_params' });
    const body = RoleBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_request' });

    const ws = await getWorkspaceForOwnerCheck(params.data.id);
    if (!ws) return reply.code(404).send({ error: 'workspace_not_found' });
    if (ws.owner_id !== auth.userId) return reply.code(403).send({ error: 'only_owner_can_change_roles' });

    const { error } = await getDb()
      .from('workspace_members')
      .update({ role: body.data.role })
      .eq('workspace_id', params.data.id)
      .eq('user_id', params.data.userId);
    if (error) return reply.code(500).send({ error: 'update_failed', detail: error.message });

    return reply.code(200).send({ ok: true });
  });

  // ---------------------------------------------------------------- REMOVE
  /**
   * DELETE /workspaces/:id/members/:userId — remove a member from the
   * workspace. Owner can remove anyone except themselves; non-owners can
   * only remove themselves.
   */
  server.delete('/:id/members/:userId', async (req, reply) => {
    const auth = await requireAuth(req, reply);
    if (!auth) return;
    const params = MemberParams.safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: 'invalid_params' });

    const ws = await getWorkspaceForOwnerCheck(params.data.id);
    if (!ws) return reply.code(404).send({ error: 'workspace_not_found' });
    if (ws.is_personal) return reply.code(400).send({ error: 'cannot_modify_personal_workspace' });

    const isOwnerAction = ws.owner_id === auth.userId;
    const isSelfRemoval = params.data.userId === auth.userId;
    if (!isOwnerAction && !isSelfRemoval) {
      return reply.code(403).send({ error: 'cannot_remove_others' });
    }
    if (isOwnerAction && params.data.userId === ws.owner_id) {
      return reply.code(400).send({ error: 'owner_cannot_self_remove' });
    }

    const { error } = await getDb()
      .from('workspace_members')
      .delete()
      .eq('workspace_id', params.data.id)
      .eq('user_id', params.data.userId);
    if (error) return reply.code(500).send({ error: 'delete_failed', detail: error.message });

    return reply.code(200).send({ ok: true });
  });

  // ---------------------------------------------------------------- INVITATIONS
  /**
   * POST /workspaces/:id/invitations — invite by email, even if the user
   * doesn't have an account yet. Creates a tokenized invitation row + sends
   * an email via Resend (gracefully no-ops if Resend not configured).
   *
   * Caller must be owner or admin. Idempotent: re-inviting the same email
   * to the same workspace returns the existing pending invitation.
   */
  const CreateInvitationBody = z.object({
    email: z.string().email().transform((s) => s.toLowerCase().trim()),
    role: z.enum(['admin', 'member', 'viewer']).default('member'),
  });

  server.post('/:id/invitations', async (req, reply) => {
    const auth = await requireAuth(req, reply);
    if (!auth) return;
    const params = IdParam.safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: 'invalid_workspace_id' });
    const body = CreateInvitationBody.safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'invalid_request', issues: body.error.issues });
    }

    const callerMembership = await assertMember(params.data.id, auth.userId);
    if (!callerMembership) return reply.code(403).send({ error: 'not_a_member' });
    if (callerMembership.role !== 'owner' && callerMembership.role !== 'admin') {
      return reply.code(403).send({ error: 'insufficient_role' });
    }

    const db = getDb();
    const env = getEnv();

    // Already a member? Surface that instead of creating a phantom invite.
    // Pages through users so we don't false-negative beyond 1000 accounts.
    let existingUser: { id: string; email: string | null } | null;
    try {
      existingUser = await findUserByEmail(db, body.data.email);
    } catch (err) {
      return reply.code(500).send({ error: 'lookup_failed', detail: String(err).slice(0, 120) });
    }
    if (existingUser) {
      const { data: m } = await db
        .from('workspace_members')
        .select('role')
        .eq('workspace_id', params.data.id)
        .eq('user_id', existingUser.id)
        .maybeSingle();
      if (m) {
        return reply.code(200).send({
          status: 'already_member',
          email: body.data.email,
          role: m.role,
        });
      }
    }

    // Existing pending invitation? Return as-is (don't double-send).
    const { data: existingInvite } = await db
      .from('workspace_invitations')
      .select('*')
      .eq('workspace_id', params.data.id)
      .eq('email', body.data.email)
      .is('accepted_at', null)
      .maybeSingle();
    if (existingInvite) {
      return reply.code(200).send({
        status: 'already_pending',
        invitation: existingInvite,
      });
    }

    // Look up workspace name (for the email) and inviter profile.
    const { data: ws } = await db
      .from('workspaces')
      .select('name')
      .eq('id', params.data.id)
      .maybeSingle();
    if (!ws) return reply.code(404).send({ error: 'workspace_not_found' });

    const { data: inviter } = await db.auth.admin.getUserById(auth.userId);
    const inviterEmail = inviter?.user?.email ?? 'someone';
    const inviterName =
      (inviter?.user?.user_metadata?.full_name as string | undefined) ?? null;

    // Generate token + insert invitation.
    const token = randomBytes(32).toString('base64url');
    const { data: insertedRows, error: insErr } = await db
      .from('workspace_invitations')
      .insert({
        workspace_id: params.data.id,
        email: body.data.email,
        role: body.data.role,
        token,
        invited_by: auth.userId,
      })
      .select('*')
      .limit(1);
    if (insErr || !insertedRows || insertedRows.length === 0) {
      return reply
        .code(500)
        .send({ error: 'insert_failed', detail: insErr?.message ?? 'no_rows' });
    }
    const inserted = insertedRows[0]!;

    // Send the email via Resend. Failure here is logged but doesn't fail
    // the request — the user can always re-send (we'll add that endpoint).
    const acceptUrl = `${env.WEB_BASE_URL}/invite/${token}`;
    const tpl = renderInvitationEmail({
      workspaceName: ws.name,
      inviterEmail,
      inviterName,
      role: body.data.role,
      acceptUrl,
    });
    const send = await sendEmail({
      to: body.data.email,
      subject: tpl.subject,
      html: tpl.html,
      text: tpl.text,
      tags: [
        { name: 'kind', value: 'workspace_invitation' },
        { name: 'workspace_id', value: params.data.id },
      ],
    });
    if (send.sent) {
      await db
        .from('workspace_invitations')
        .update({
          email_sent_at: new Date().toISOString(),
          email_provider_id: send.id,
          email_error: null,
        })
        .eq('id', inserted.id);
    } else {
      await db
        .from('workspace_invitations')
        .update({ email_error: send.reason.slice(0, 200) })
        .eq('id', inserted.id);
      req.log.warn(
        { reason: send.reason, email: body.data.email },
        'invitation_email_not_sent',
      );
    }

    return reply.code(201).send({
      status: 'created',
      invitation: { ...inserted, email_sent_at: send.sent ? new Date().toISOString() : null },
      email_sent: send.sent,
      accept_url: acceptUrl,
    });
  });

  /**
   * GET /workspaces/:id/invitations — list pending invitations for a
   * workspace. Caller must be owner or admin.
   */
  server.get('/:id/invitations', async (req, reply) => {
    const auth = await requireAuth(req, reply);
    if (!auth) return;
    const params = IdParam.safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: 'invalid_workspace_id' });
    const callerMembership = await assertMember(params.data.id, auth.userId);
    if (!callerMembership) return reply.code(403).send({ error: 'not_a_member' });
    if (callerMembership.role !== 'owner' && callerMembership.role !== 'admin') {
      return reply.code(403).send({ error: 'insufficient_role' });
    }

    const { data, error } = await getDb()
      .from('workspace_invitations')
      .select('id, email, role, created_at, expires_at, accepted_at, email_sent_at, email_error')
      .eq('workspace_id', params.data.id)
      .order('created_at', { ascending: false });
    if (error) return reply.code(500).send({ error: 'db_error', detail: error.message });
    return reply.code(200).send({ invitations: data ?? [] });
  });

  /**
   * DELETE /workspaces/:id/invitations/:invitationId — revoke a pending
   * invitation. Caller must be owner or admin.
   */
  server.delete('/:id/invitations/:invitationId', async (req, reply) => {
    const auth = await requireAuth(req, reply);
    if (!auth) return;
    const params = z
      .object({ id: z.string().uuid(), invitationId: z.string().uuid() })
      .safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: 'invalid_params' });
    const callerMembership = await assertMember(params.data.id, auth.userId);
    if (!callerMembership) return reply.code(403).send({ error: 'not_a_member' });
    if (callerMembership.role !== 'owner' && callerMembership.role !== 'admin') {
      return reply.code(403).send({ error: 'insufficient_role' });
    }

    const { error } = await getDb()
      .from('workspace_invitations')
      .delete()
      .eq('id', params.data.invitationId)
      .eq('workspace_id', params.data.id);
    if (error) return reply.code(500).send({ error: 'delete_failed', detail: error.message });
    return reply.code(200).send({ ok: true });
  });
};

// ---------------------------------------------------------------- helpers

async function assertMember(workspaceId: string, userId: string) {
  const { data } = await getDb()
    .from('workspace_members')
    .select('role')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .maybeSingle();
  return data;
}

async function getWorkspaceForOwnerCheck(workspaceId: string) {
  const { data } = await getDb()
    .from('workspaces')
    .select('id, owner_id, is_personal')
    .eq('id', workspaceId)
    .maybeSingle();
  return data;
}
