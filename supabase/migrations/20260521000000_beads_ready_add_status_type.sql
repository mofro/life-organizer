-- Migration: 20260521000000_beads_ready_add_status_type
--
-- Adds status and issue_type to beads_ready so the UI can show
-- in-progress indicators and issue type badges on the summary row
-- without requiring a detail fetch.
--
-- HOW TO RUN:
--   Paste into the Supabase SQL editor and click Run.

alter table public.beads_ready
  add column if not exists status     text,   -- e.g. 'open', 'in_progress'
  add column if not exists issue_type text;   -- e.g. 'task', 'feature', 'bug', 'epic'
