-- Perfil que el coach aprende del usuario: "el coach que te conoce de verdad".
-- Una fila por workspace. Lo deriva el LLM del corpus (quién sos, en qué andás,
-- tus metas, rutinas, tendencias en el tiempo = memoria episódica, y una lectura
-- de bienestar/sobrecarga). Se INYECTA en cada generación de coaching para que
-- las sugerencias sean tuyas y consistentes, sin re-derivar tu vida cada vez.
--
-- NO APLICADA EN PROD todavía — aplicar con `supabase db push` cuando Rubén dé OK.

create table if not exists public.coach_profile (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  user_id uuid not null,
  -- Quién es el usuario, en 2-4 frases.
  summary text not null default '',
  -- Ejes/temas en los que está enfocado ahora.
  focus_areas text[] not null default '{}',
  -- Metas explícitas o inferidas.
  goals text[] not null default '{}',
  -- Rutinas/hábitos detectados.
  routines text not null default '',
  -- Memoria episódica: tendencias y cambios a lo largo del tiempo.
  trends text not null default '',
  -- Lectura de bienestar / señales de sobrecarga (con cuidado).
  wellbeing text not null default '',
  -- Preferencia de tono del coach (si el usuario la fijó).
  tone_pref text,
  -- Espacio flexible para extras estructurados.
  raw jsonb not null default '{}',
  nodes_analyzed int not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.coach_profile enable row level security;

drop policy if exists "members can read coach_profile" on public.coach_profile;
create policy "members can read coach_profile"
  on public.coach_profile for select
  using (
    exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = coach_profile.workspace_id and wm.user_id = auth.uid()
    )
  );

drop policy if exists "members can insert coach_profile" on public.coach_profile;
create policy "members can insert coach_profile"
  on public.coach_profile for insert
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = coach_profile.workspace_id and wm.user_id = auth.uid()
    )
  );

drop policy if exists "members can update coach_profile" on public.coach_profile;
create policy "members can update coach_profile"
  on public.coach_profile for update
  using (
    exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = coach_profile.workspace_id and wm.user_id = auth.uid()
    )
  );

grant select, insert, update on public.coach_profile to authenticated;
