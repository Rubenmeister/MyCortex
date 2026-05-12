-- Workspace invitations: invite someone by email, even if they don't have
-- a MyCortex account yet. They get a tokenized link that lets them sign up
-- (or log in) and auto-joins them to the inviting workspace.
--
-- The existing inviteMember endpoint required the target to already be a
-- registered user. This table extends that to pending invitations.

create table if not exists public.workspace_invitations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  -- Lowercase normalized email. Used to match on signup.
  email text not null,
  -- Role the invitee gets when they accept. Cannot be 'owner'.
  role text not null check (role in ('admin', 'member', 'viewer')),
  -- 32-byte random token, base64url-encoded. URL-safe.
  token text not null unique,
  -- Who sent the invite. Always a registered user.
  invited_by uuid not null,
  -- ISO timestamps. expires_at default = +7 days from creation.
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  -- Set when the invite is accepted; null while pending. Once accepted,
  -- a workspace_members row exists and this row is kept for audit.
  accepted_at timestamptz,
  accepted_by uuid,
  -- Track delivery so the UI can show "sent / failed" without re-sending
  -- on every page load.
  email_sent_at timestamptz,
  email_provider_id text,
  email_error text
);

-- One pending invitation per (workspace, email). If they accept, the row
-- stays but with accepted_at filled; if you want to re-invite the SAME
-- email to the SAME workspace, you have to delete the old row first.
create unique index if not exists workspace_invitations_pending_unique
  on public.workspace_invitations (workspace_id, lower(email))
  where accepted_at is null;

create index if not exists workspace_invitations_token_idx
  on public.workspace_invitations (token);

create index if not exists workspace_invitations_email_idx
  on public.workspace_invitations (lower(email));

-- RLS: members can read invitations of their workspace. The accept flow
-- uses service_role to look up by token (no auth required to view the
-- invitation page).
alter table public.workspace_invitations enable row level security;

drop policy if exists "members can read workspace invitations"
  on public.workspace_invitations;
create policy "members can read workspace invitations"
  on public.workspace_invitations
  for select
  using (
    exists (
      select 1
      from public.workspace_members wm
      where wm.workspace_id = workspace_invitations.workspace_id
        and wm.user_id = auth.uid()
    )
  );

grant select on public.workspace_invitations to authenticated;
