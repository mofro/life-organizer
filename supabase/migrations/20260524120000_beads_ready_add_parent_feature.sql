-- Migration: 20260524120000_beads_ready_add_parent_feature
--
-- Adds parent feature columns to beads_ready so the UI can group tasks
-- under their owning feature and the AI recommendation layer can reason
-- about feature advancement rather than isolated task priority.
--
-- HOW TO RUN:
--   Paste into the Supabase SQL editor and click Run.

alter table public.beads_ready
  add column if not exists parent_feature_id    text,   -- e.g. 'life-abc' — the feature this task belongs to
  add column if not exists parent_feature_title text,   -- display name of the parent feature
  add column if not exists parent_priority      int;    -- priority of the parent feature (0=critical, 4=backlog)
