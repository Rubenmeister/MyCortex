-- Extend enums for Calendar / Notion / Slack integrations (Fase E).
-- Postgres allows ALTER TYPE ADD VALUE without a table rewrite, but each
-- ADD VALUE must be its own statement (no comma-separated list) and
-- cannot run inside a transaction. Supabase SQL editor handles each
-- statement separately, so this works.

alter type public.ingest_source add value if not exists 'calendar';
alter type public.ingest_source add value if not exists 'notion';
alter type public.ingest_source add value if not exists 'slack';

-- integrations.provider is a plain text column with a CHECK constraint
-- (see init migration). Update the check to allow the new providers.
alter table public.integrations
  drop constraint if exists integrations_provider_check;

alter table public.integrations
  add constraint integrations_provider_check
  check (provider in ('google_drive', 'gmail', 'google_calendar', 'notion', 'slack'));
