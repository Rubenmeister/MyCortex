-- Telegram multi-user: link a Telegram chat to a MyCortex user + workspace
-- so each team member can send to the same bot and have their messages
-- routed to their own brain.
--
-- Tables:
--   telegram_links — long-lived chat_id → (user_id, workspace_id).
--   telegram_link_tokens — short-lived one-time tokens used during the
--     vinculation handshake.
--
-- Linking flow:
--   1. User clicks "Vincular Telegram" in /app/settings/integrations.
--   2. API POSTs /integrations/telegram/start-link → returns a token +
--      a t.me deep link with that token as the /start payload.
--   3. User clicks the deep link → Telegram opens the bot with /start TOKEN.
--   4. Bot receives /start TOKEN → validates against telegram_link_tokens
--      (not expired, not used) → upserts a telegram_links row → marks
--      token as used.
--   5. Future messages from that chat_id route to the linked user + workspace.

create table if not exists public.telegram_links (
  -- Telegram chat_id is a 64-bit integer; bigint matches.
  chat_id bigint primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  -- Telegram profile metadata captured at link time. Useful for the UI.
  telegram_username text,
  telegram_first_name text,
  linked_at timestamptz not null default now(),
  -- Audit: which token was redeemed to create this link.
  linked_by_token text
);

create index if not exists telegram_links_user_idx
  on public.telegram_links (user_id);

create table if not exists public.telegram_link_tokens (
  token text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '15 minutes'),
  used_at timestamptz,
  used_by_chat_id bigint
);

create index if not exists telegram_link_tokens_user_idx
  on public.telegram_link_tokens (user_id)
  where used_at is null;

-- RLS: users can read their own links + tokens (for the UI to show
-- "linked accounts" + pending link state). Writes are service-role only.
alter table public.telegram_links enable row level security;
alter table public.telegram_link_tokens enable row level security;

drop policy if exists "users read own telegram links" on public.telegram_links;
create policy "users read own telegram links"
  on public.telegram_links
  for select
  using (user_id = auth.uid());

drop policy if exists "users delete own telegram links" on public.telegram_links;
create policy "users delete own telegram links"
  on public.telegram_links
  for delete
  using (user_id = auth.uid());

drop policy if exists "users read own link tokens" on public.telegram_link_tokens;
create policy "users read own link tokens"
  on public.telegram_link_tokens
  for select
  using (user_id = auth.uid());

grant select, delete on public.telegram_links to authenticated;
grant select on public.telegram_link_tokens to authenticated;
