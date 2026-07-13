-- Capa 1: el CONTEXTO CURADO ("la constitución") del workspace.
--
-- A diferencia de coach_profile (que la IA INFIERE del corpus), esto lo DECLARA
-- el usuario y es AUTORITATIVO: siempre se inyecta en cada razonamiento del LLM
-- (coach, chat, ask, agenda, diario) y, si la inferencia lo contradice, gana esto.
--
-- workspace_context = el documento curado (markdown, 1 fila por workspace).
-- context_proposals = el loop bidireccional: la IA propone hechos estables; al
--   aceptarlos, se fusionan en el documento.
--
-- NO APLICADA EN PROD todavía — aplicar con `supabase db push` cuando Rubén dé OK.

create table if not exists public.workspace_context (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  -- El cuerpo curado, en markdown. Secciones por convención:
  -- ## Metas · ## Proyectos · ## Personas · ## Reglas y preferencias.
  body text not null default '',
  updated_by uuid,
  updated_at timestamptz not null default now()
);

drop trigger if exists workspace_context_updated_at on public.workspace_context;
create trigger workspace_context_updated_at
  before update on public.workspace_context
  for each row execute function public.handle_updated_at();

create table if not exists public.context_proposals (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null,
  -- Sección sugerida del documento donde encaja el hecho.
  section text not null default 'General',
  -- El hecho a agregar al contexto (1-2 líneas, declarativo).
  text text not null,
  -- Por qué la IA lo propone (evidencia breve).
  rationale text,
  source_node_ids uuid[] not null default '{}',
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'rejected')),
  created_at timestamptz not null default now(),
  decided_at timestamptz
);

create index if not exists context_proposals_workspace_open_idx
  on public.context_proposals (workspace_id, created_at desc)
  where status = 'pending';

-- Evita re-proponer el mismo hecho (el worker corre semanal): único por texto
-- normalizado dentro del workspace.
create unique index if not exists context_proposals_workspace_text_idx
  on public.context_proposals (workspace_id, lower(text));

alter table public.workspace_context enable row level security;
alter table public.context_proposals enable row level security;

drop policy if exists "members can read workspace_context" on public.workspace_context;
create policy "members can read workspace_context"
  on public.workspace_context for select
  using (
    exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = workspace_context.workspace_id and wm.user_id = auth.uid()
    )
  );

drop policy if exists "members can upsert workspace_context" on public.workspace_context;
create policy "members can upsert workspace_context"
  on public.workspace_context for insert
  with check (
    exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = workspace_context.workspace_id and wm.user_id = auth.uid()
    )
  );

drop policy if exists "members can update workspace_context" on public.workspace_context;
create policy "members can update workspace_context"
  on public.workspace_context for update
  using (
    exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = workspace_context.workspace_id and wm.user_id = auth.uid()
    )
  );

drop policy if exists "members can read context_proposals" on public.context_proposals;
create policy "members can read context_proposals"
  on public.context_proposals for select
  using (
    exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = context_proposals.workspace_id and wm.user_id = auth.uid()
    )
  );

drop policy if exists "members can insert context_proposals" on public.context_proposals;
create policy "members can insert context_proposals"
  on public.context_proposals for insert
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = context_proposals.workspace_id and wm.user_id = auth.uid()
    )
  );

drop policy if exists "members can update context_proposals" on public.context_proposals;
create policy "members can update context_proposals"
  on public.context_proposals for update
  using (
    exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = context_proposals.workspace_id and wm.user_id = auth.uid()
    )
  );

grant select, insert, update on public.workspace_context to authenticated;
grant select, insert, update on public.context_proposals to authenticated;
