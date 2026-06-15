-- Capa de tareas: el contenedor accionable del "loop" (Coach → Tarea → Agenda
-- → Seguimiento). Las tareas nacen a mano, de una sugerencia del coach, de un
-- action item extraído de un nodo, o de una reunión. status mueve el tablero.
--
-- NO APLICADA EN PROD todavía — aplicar con `supabase db push` cuando Rubén dé OK.

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null,
  title text not null,
  detail text,
  -- Tablero: por hacer / haciendo / hecho.
  status text not null default 'todo' check (status in ('todo', 'doing', 'done')),
  priority text not null default 'media' check (priority in ('alta', 'media', 'baja')),
  due_date timestamptz,
  -- De dónde salió la tarea (para el loop + atribución).
  origin text not null default 'manual'
    check (origin in ('manual', 'coach', 'extracted', 'meeting')),
  -- Nodo de origen (nota/mail/evento) si la tarea se extrajo de algo. on delete
  -- set null para no perder la tarea si se borra la fuente.
  source_node_id uuid references public.nodes(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists tasks_workspace_status_idx
  on public.tasks (workspace_id, status, created_at desc);

create index if not exists tasks_workspace_due_idx
  on public.tasks (workspace_id, due_date)
  where status <> 'done';

-- updated_at trigger (reusa la función del schema inicial).
drop trigger if exists tasks_updated_at on public.tasks;
create trigger tasks_updated_at
  before update on public.tasks
  for each row execute function public.handle_updated_at();

alter table public.tasks enable row level security;

drop policy if exists "members can read tasks" on public.tasks;
create policy "members can read tasks"
  on public.tasks for select
  using (
    exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = tasks.workspace_id and wm.user_id = auth.uid()
    )
  );

drop policy if exists "members can insert tasks" on public.tasks;
create policy "members can insert tasks"
  on public.tasks for insert
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = tasks.workspace_id and wm.user_id = auth.uid()
    )
  );

drop policy if exists "members can update tasks" on public.tasks;
create policy "members can update tasks"
  on public.tasks for update
  using (
    exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = tasks.workspace_id and wm.user_id = auth.uid()
    )
  );

drop policy if exists "members can delete tasks" on public.tasks;
create policy "members can delete tasks"
  on public.tasks for delete
  using (
    exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = tasks.workspace_id and wm.user_id = auth.uid()
    )
  );

grant select, insert, update, delete on public.tasks to authenticated;
