-- WhatsApp multi-user: link a WhatsApp phone number to a MyCortex user
-- + workspace. Mirrors telegram_links but with phone_number as the PK.
--
-- Linking flow:
--   1. User clicks "Vincular WhatsApp" in /app/settings/integrations.
--   2. API generates a 6-char token (capital letters + digits, easier to
--      type on mobile keyboard than 43-char base64) bound to (user_id,
--      workspace_id), 15-min TTL.
--   3. UI shows: "Mandá 'LINK ABC123' por WhatsApp al +593..."
--   4. WhatsApp webhook receives the message; if first word == LINK and
--      token matches, upsert a whatsapp_links row with the sender's
--      phone number.
--   5. Future messages from that number route to the linked user.

create table if not exists public.whatsapp_links (
  -- E.164 phone number without leading +, e.g. "593987654321".
  -- Stored as text because phone numbers can have leading zeros that
  -- bigint would strip.
  phone_number text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  display_name text,
  linked_at timestamptz not null default now(),
  linked_by_token text
);

create index if not exists whatsapp_links_user_idx
  on public.whatsapp_links (user_id);

create table if not exists public.whatsapp_link_tokens (
  -- 6 chars uppercase alphanumeric. Shorter than telegram tokens because
  -- WhatsApp doesn't support deep links — user types the token by hand.
  token text primary key check (length(token) = 6),
  user_id uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '15 minutes'),
  used_at timestamptz,
  used_by_phone_number text
);

create index if not exists whatsapp_link_tokens_user_idx
  on public.whatsapp_link_tokens (user_id)
  where used_at is null;

alter table public.whatsapp_links enable row level security;
alter table public.whatsapp_link_tokens enable row level security;

drop policy if exists "users read own whatsapp links" on public.whatsapp_links;
create policy "users read own whatsapp links"
  on public.whatsapp_links
  for select
  using (user_id = auth.uid());

drop policy if exists "users delete own whatsapp links" on public.whatsapp_links;
create policy "users delete own whatsapp links"
  on public.whatsapp_links
  for delete
  using (user_id = auth.uid());

drop policy if exists "users read own whatsapp link tokens" on public.whatsapp_link_tokens;
create policy "users read own whatsapp link tokens"
  on public.whatsapp_link_tokens
  for select
  using (user_id = auth.uid());

grant select, delete on public.whatsapp_links to authenticated;
grant select on public.whatsapp_link_tokens to authenticated;
