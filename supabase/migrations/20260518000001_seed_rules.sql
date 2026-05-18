-- Seed: 4 v1 Rules Engine rules
-- Migration: 20260518000001_seed_rules
--
-- These are the starter rules defined in ARD v2 §Rules Engine Pattern.
-- They are inserted without a user_id — you must update them after signing up:
--
--   update public.rules set user_id = auth.uid() where user_id is null;
--
-- Or paste with your actual user_id substituted for the placeholder.
--
-- Rules evaluate against World State in this order of priority (0 = highest).
-- The Rules Engine checks: condition match AND priority >= priority_threshold AND cooldown elapsed.

-- HOW TO USE AFTER SIGN-UP:
--   1. Run the main schema migration first (20260518000000_...)
--   2. Sign in to the app so Supabase Auth creates your user row
--   3. In the Supabase SQL editor, run:
--        update public.rules set user_id = '<your-user-uuid>' where user_id = '00000000-0000-0000-0000-000000000001';
--      (your UUID is in Authentication → Users in the Supabase dashboard)

-- Placeholder user UUID — replace before running, or run the UPDATE above after.
do $$
declare
  placeholder_user_id uuid := '00000000-0000-0000-0000-000000000001';
begin

-- Rule 1: Open Block Matching
-- "You have a 90-minute gap — this task fits and it's high priority."
insert into public.rules (user_id, name, description, condition_type, condition_config, priority_threshold, cooldown_minutes)
values (
  placeholder_user_id,
  'Open Block — Task Fit',
  'Fires when a calendar gap is long enough for a ready task of matching priority.',
  'open_block',
  '{
    "min_block_minutes": 30,
    "match_priority_max": 1,
    "sources": ["open_tasks", "beads_ready"]
  }'::jsonb,
  1,   -- only fire for P0/P1 tasks
  120  -- no more than once every 2 hours
);

-- Rule 2: Deadline Proximity
-- "Deadline tomorrow: Review the Q3 proposal."
insert into public.rules (user_id, name, description, condition_type, condition_config, priority_threshold, cooldown_minutes)
values (
  placeholder_user_id,
  'Deadline Proximity',
  'Fires when a task deadline is within the configured window and the task is not completed.',
  'deadline_proximity',
  '{
    "warn_hours": [24, 4],
    "statuses_to_check": ["pending", "in_progress"]
  }'::jsonb,
  2,   -- fire for P0–P2 tasks
  60   -- at most once per hour per task (cooldown is per-rule, not per-task — see note)
);

-- Rule 3: Issue Unblocked
-- "life-xqz is now unblocked — it was waiting on life-men."
insert into public.rules (user_id, name, description, condition_type, condition_config, priority_threshold, cooldown_minutes)
values (
  placeholder_user_id,
  'Issue Unblocked',
  'Fires when a Beads issue transitions from blocked to ready (all its blockers are closed).',
  'issue_unblocked',
  '{
    "priority_max": 1,
    "notify_channel": "in_app"
  }'::jsonb,
  1,   -- P0/P1 only — don't spam for P3/P4 unblocks
  30
);

-- Rule 4: Task Stalled
-- "life-4qr has had no progress in 5 days and the deadline is in 10 days."
insert into public.rules (user_id, name, description, condition_type, condition_config, priority_threshold, cooldown_minutes)
values (
  placeholder_user_id,
  'Task Stalled',
  'Fires when an in-progress task has had no status change for N days and the deadline is within Y days.',
  'task_stalled',
  '{
    "stall_days": 3,
    "deadline_within_days": 14,
    "statuses_to_check": ["in_progress", "pending"]
  }'::jsonb,
  2,
  1440  -- at most once per day per stalled task
);

end $$;
