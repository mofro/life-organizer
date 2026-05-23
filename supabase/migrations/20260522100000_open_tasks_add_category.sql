-- Migration: 20260522100000_open_tasks_add_category
-- Adds a category column to open_tasks so the UI's category picker is persisted.
--
-- HOW TO RUN:
--   Paste into the Supabase SQL editor (https://app.supabase.com) and click Run.
--   Or: supabase db push (if the Supabase CLI is authenticated).
--
-- Safe to run multiple times (IF NOT EXISTS guard on the add-column).

alter table public.open_tasks
  add column if not exists category text not null default 'general';

-- Index for potential future category-based filtering
create index if not exists open_tasks_user_category
  on public.open_tasks (user_id, category);
