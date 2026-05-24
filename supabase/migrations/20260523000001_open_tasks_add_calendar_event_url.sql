-- Migration: 20260523000000_open_tasks_add_calendar_event_url
-- Stores the Google Calendar event URL (htmlLink) for tasks that have been
-- scheduled. Used to show the 📅 badge and link back to the event.
--
-- HOW TO RUN:
--   Paste into the Supabase SQL editor and click Run.
--
-- Safe to run multiple times (IF NOT EXISTS guard).

alter table public.open_tasks
  add column if not exists calendar_event_url text;

create index if not exists open_tasks_calendar_event_url
  on public.open_tasks (user_id)
  where calendar_event_url is not null;
