-- Add `kind` to daily_digests so the same table can host daily AND weekly
-- digests without conflicting on (workspace, for_date). Weekly reflections
-- use Monday's date as for_date but with kind='weekly'.

alter table public.daily_digests
  add column if not exists kind text not null default 'daily';

alter table public.daily_digests
  drop constraint if exists daily_digests_kind_check;
alter table public.daily_digests
  add constraint daily_digests_kind_check
  check (kind in ('daily', 'weekly'));

-- The old unique constraint was (workspace_id, for_date). Replace it with
-- (workspace_id, for_date, kind) so a daily and a weekly can coexist for
-- the same Monday.
alter table public.daily_digests
  drop constraint if exists daily_digests_workspace_id_for_date_key;
alter table public.daily_digests
  drop constraint if exists daily_digests_workspace_for_date_kind_key;
alter table public.daily_digests
  add constraint daily_digests_workspace_for_date_kind_key
  unique (workspace_id, for_date, kind);

create index if not exists daily_digests_workspace_kind_date_idx
  on public.daily_digests (workspace_id, kind, for_date desc);
