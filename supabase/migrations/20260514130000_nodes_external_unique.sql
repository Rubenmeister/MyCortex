-- Verify the partial unique index from the initial integrations migration
-- still exists. It guards against double-insert when two sync-worker
-- runs race on the same external item (e.g. calendar-sync overlapping
-- cron + manual execution).
--
-- The index was created in 20260510000000_integrations.sql with the same
-- definition. This migration is a no-op if it's already there but
-- documents intent + works as a self-heal if anyone drops it.

create unique index if not exists nodes_workspace_external_unique
  on public.nodes (workspace_id, external_source, external_id)
  where external_id is not null;
