-- Add 'whatsapp' as a valid ingest_source so WhatsApp-originated nodes
-- can declare their lineage. Idempotent.

alter type public.ingest_source add value if not exists 'whatsapp';
