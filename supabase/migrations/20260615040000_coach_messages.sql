-- Cerebro conversacional: un hilo de chat por workspace para "hablar con tu
-- coach/diario". Persiste los mensajes para tener memoria de conversación.
--
-- NO APLICADA EN PROD todavía — aplicar con `supabase db push` cuando Rubén dé OK.

create table if not exists public.coach_messages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  created_at timestamptz not null default now()
);

create index if not exists coach_messages_workspace_created_idx
  on public.coach_messages (workspace_id, created_at);

alter table public.coach_messages enable row level security;

drop policy if exists "members can read coach_messages" on public.coach_messages;
create policy "members can read coach_messages"
  on public.coach_messages for select
  using (
    exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = coach_messages.workspace_id and wm.user_id = auth.uid()
    )
  );

drop policy if exists "members can insert coach_messages" on public.coach_messages;
create policy "members can insert coach_messages"
  on public.coach_messages for insert
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = coach_messages.workspace_id and wm.user_id = auth.uid()
    )
  );

grant select, insert on public.coach_messages to authenticated;
