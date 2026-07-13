-- Cierre del "loop": enlaza una tarea con la sugerencia del coach que la originó.
-- Es el eslabón que faltaba entre "Coach detecta" y "Productividad lo vuelve
-- tarea": con este link, cuando la tarea se completa el seguimiento puede marcar
-- la sugerencia como hecha, y la UI puede mostrar "esta sugerencia ya es tarea".
--
-- NO APLICADA EN PROD todavía — aplicar con `supabase db push` cuando Rubén dé OK.

alter table public.tasks
  add column if not exists source_suggestion_id uuid
    references public.coach_suggestions(id) on delete set null;

-- Para resolver rápido "¿esta sugerencia ya tiene tarea?" y el join inverso.
create index if not exists tasks_source_suggestion_idx
  on public.tasks (source_suggestion_id)
  where source_suggestion_id is not null;
