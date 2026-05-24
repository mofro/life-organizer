-- Migration A: Add schedule + category columns to user_preferences
-- Phase 1 intelligence layer — life-qpp
--
-- weekly_schedule:      working hours per day-of-week (day 0=Sun … 6=Sat)
-- schedule_exceptions:  date-specific overrides (holidays, custom hours)
-- planning_window:      hard_floor (never before) + soft_ceiling (prefer before)
-- categories:           user-configurable task category list (replaces hard-coded taxonomy)

alter table public.user_preferences
  add column if not exists weekly_schedule jsonb not null default '[
    {"day":1,"start":"09:00","end":"18:00"},
    {"day":2,"start":"09:00","end":"18:00"},
    {"day":3,"start":"09:00","end":"18:00"},
    {"day":4,"start":"09:00","end":"18:00"},
    {"day":5,"start":"09:00","end":"18:00"}
  ]',
  add column if not exists schedule_exceptions jsonb not null default '[]',
  add column if not exists planning_window jsonb not null default '{"hard_floor":"06:00","soft_ceiling":"18:00"}',
  add column if not exists categories jsonb not null default '["professional","home","hobby","social","adhoc"]';
