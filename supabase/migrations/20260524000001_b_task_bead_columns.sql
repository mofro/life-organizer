-- Migration B: Update open_tasks category, add beads_ready.labels, recommendation_history.item_feedback
-- Phase 1 intelligence layer — life-891
--
-- 1. Migrate existing 'general' category values to 'adhoc' (new default)
-- 2. Add beads_ready.labels for future Beads-to-category mapping (Phase 2 populates)
-- 3. Add recommendation_history.item_feedback for thumbs-up/down signal accumulation

-- (1) open_tasks: migrate existing rows, update default
update public.open_tasks set category = 'adhoc' where category = 'general';
alter table public.open_tasks alter column category set default 'adhoc';

-- (2) beads_ready: labels for category mapping
alter table public.beads_ready
  add column if not exists labels jsonb not null default '[]';

-- (3) recommendation_history: item-level feedback array
alter table public.recommendation_history
  add column if not exists item_feedback jsonb not null default '[]';
