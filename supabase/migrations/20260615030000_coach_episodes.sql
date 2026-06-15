-- Diario / memoria episódica navegable: un "episodio" por período (semana) que
-- el coach escribe a partir del material de ese lapso. Hace concreta y recorrible
-- la memoria del coach: narrativa, temas, ánimo/energía, progreso contra metas, y
-- hilos sueltos (lo que quedó sin cerrar). Idempotente por (workspace, period_start).
--
-- NO APLICADA EN PROD todavía — aplicar con `supabase db push` cuando Rubén dé OK.

create table if not exists public.coach_episodes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null,
  period_start timestamptz not null,
  period_end timestamptz not null,
  -- Etiqueta legible ("Semana del 9–15 jun").
  label text not null,
  -- Narrativa del período (markdown breve).
  narrative text not null,
  themes text[] not null default '{}',
  -- Lectura de ánimo / energía del período (con cuidado).
  mood text not null default '',
  -- Avance contra las metas del perfil.
  progress text not null default '',
  -- Hilos sueltos: lo que quedó abierto / sin cerrar.
  loose_threads text[] not null default '{}',
  nodes_analyzed int not null default 0,
  created_at timestamptz not null default now(),
  unique (workspace_id, period_start)
);

create index if not exists coach_episodes_workspace_period_idx
  on public.coach_episodes (workspace_id, period_start desc);

alter table public.coach_episodes enable row level security;

drop policy if exists "members can read coach_episodes" on public.coach_episodes;
create policy "members can read coach_episodes"
  on public.coach_episodes for select
  using (
    exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = coach_episodes.workspace_id and wm.user_id = auth.uid()
    )
  );

drop policy if exists "members can insert coach_episodes" on public.coach_episodes;
create policy "members can insert coach_episodes"
  on public.coach_episodes for insert
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = coach_episodes.workspace_id and wm.user_id = auth.uid()
    )
  );

drop policy if exists "members can update coach_episodes" on public.coach_episodes;
create policy "members can update coach_episodes"
  on public.coach_episodes for update
  using (
    exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = coach_episodes.workspace_id and wm.user_id = auth.uid()
    )
  );

grant select, insert, update on public.coach_episodes to authenticated;
