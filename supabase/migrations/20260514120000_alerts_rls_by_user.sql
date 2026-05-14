-- Tighten the smart_alerts UPDATE policy.
--
-- Before: any workspace member could mark another member's alert as
--   read/dismissed/acted. In a shared team workspace, a viewer could
--   clear the owner's badge or hide an alert.
-- After: only the user who owns the alert (alerts.user_id = auth.uid())
--   can update its lifecycle columns. Reads remain workspace-scoped so
--   members can still see each other's alerts.

drop policy if exists "members can update alerts" on public.smart_alerts;

create policy "owner can update own alerts"
  on public.smart_alerts
  for update
  using (user_id = auth.uid());
