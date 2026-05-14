-- Catch-up migration: 'drive' and 'gmail' were added to public.ingest_source
-- directly via the Supabase SQL Editor when we launched those integrations
-- (the migrations file was never committed). Production has them; this
-- file documents the change so fresh DB initializations include them too.
--
-- Idempotent: 'add value if not exists' is a no-op when the value exists.

alter type public.ingest_source add value if not exists 'drive';
alter type public.ingest_source add value if not exists 'gmail';
