import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../../lib/auth.js';
import { getDb } from '../../lib/db.js';

/**
 * Public-ish invitation flow:
 *   GET  /invitations/:token   → returns workspace + role for the invite.
 *                                No auth required (token is the secret).
 *   POST /invitations/:token/accept → requires auth; binds the current
 *                                user to the workspace, marks accepted.
 *
 * Tokens are 32 random bytes base64url-encoded. They live for 7 days
 * (set at insert time). Acceptance is idempotent — if the row is
 * already accepted, returns 200 with `already_accepted: true`.
 */
const TokenParam = z.object({ token: z.string().min(20).max(80) });

export const invitationsModule: FastifyPluginAsync = async (server) => {
  // ---- GET /invitations/:token ------------------------------------------
  server.get('/:token', async (req, reply) => {
    const params = TokenParam.safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: 'invalid_token' });

    const db = getDb();
    const { data: inv, error } = await db
      .from('workspace_invitations')
      .select('*')
      .eq('token', params.data.token)
      .maybeSingle();
    if (error) return reply.code(500).send({ error: 'db_error', detail: error.message });
    if (!inv) return reply.code(404).send({ error: 'invitation_not_found' });

    // Pull workspace name + inviter email for the UI to render.
    const { data: ws } = await db
      .from('workspaces')
      .select('name, is_personal')
      .eq('id', inv.workspace_id)
      .maybeSingle();
    if (!ws) return reply.code(404).send({ error: 'workspace_gone' });
    if (ws.is_personal) {
      // Defensive: personal workspaces shouldn't have invites. If somehow
      // there's a stale row, refuse.
      return reply.code(400).send({ error: 'cannot_invite_to_personal' });
    }

    const { data: inviter } = await db.auth.admin.getUserById(inv.invited_by);

    const expired = new Date(inv.expires_at).getTime() < Date.now();

    return reply.code(200).send({
      invitation: {
        id: inv.id,
        email: inv.email,
        role: inv.role,
        workspace_name: ws.name,
        inviter_email: inviter?.user?.email ?? null,
        created_at: inv.created_at,
        expires_at: inv.expires_at,
        accepted_at: inv.accepted_at,
        expired,
      },
    });
  });

  // ---- POST /invitations/:token/accept ----------------------------------
  server.post('/:token/accept', async (req, reply) => {
    const params = TokenParam.safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: 'invalid_token' });

    const auth = await requireAuth(req, reply);
    if (!auth) return;

    const db = getDb();
    const { data: inv, error } = await db
      .from('workspace_invitations')
      .select('*')
      .eq('token', params.data.token)
      .maybeSingle();
    if (error) return reply.code(500).send({ error: 'db_error', detail: error.message });
    if (!inv) return reply.code(404).send({ error: 'invitation_not_found' });

    if (inv.accepted_at) {
      return reply.code(200).send({
        already_accepted: true,
        workspace_id: inv.workspace_id,
      });
    }

    if (new Date(inv.expires_at).getTime() < Date.now()) {
      return reply.code(410).send({ error: 'invitation_expired' });
    }

    // Verify the authed user's email matches the invitation. Prevents
    // someone with a stolen token from accepting as the wrong user.
    const { data: caller } = await db.auth.admin.getUserById(auth.userId);
    if (!caller?.user?.email || caller.user.email.toLowerCase() !== inv.email.toLowerCase()) {
      return reply.code(403).send({
        error: 'email_mismatch',
        invitation_email: inv.email,
        your_email: caller?.user?.email ?? null,
      });
    }

    // Insert membership. If already a member, just mark accepted.
    const { data: existingMembership } = await db
      .from('workspace_members')
      .select('role')
      .eq('workspace_id', inv.workspace_id)
      .eq('user_id', auth.userId)
      .maybeSingle();

    if (!existingMembership) {
      const { error: addErr } = await db
        .from('workspace_members')
        .insert({
          workspace_id: inv.workspace_id,
          user_id: auth.userId,
          role: inv.role,
        });
      if (addErr) {
        return reply.code(500).send({ error: 'add_member_failed', detail: addErr.message });
      }
    }

    // Mark accepted (audit trail).
    await db
      .from('workspace_invitations')
      .update({
        accepted_at: new Date().toISOString(),
        accepted_by: auth.userId,
      })
      .eq('id', inv.id);

    return reply.code(200).send({
      accepted: true,
      workspace_id: inv.workspace_id,
      role: inv.role,
    });
  });
};
