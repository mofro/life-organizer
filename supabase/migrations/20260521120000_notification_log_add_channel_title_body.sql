-- Migration: 20260521120000_notification_log_add_channel_title_body
--
-- Adds channel, title, body to notification_log so the Rules Engine
-- can write human-readable notification content alongside the raw payload.
--
-- HOW TO RUN:
--   Paste into the Supabase SQL editor and click Run.

alter table public.notification_log
  add column if not exists channel text,   -- e.g. 'in_app', 'email', 'push'
  add column if not exists title   text,   -- notification headline
  add column if not exists body    text;   -- notification detail line
