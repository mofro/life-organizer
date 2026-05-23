-- Migration: 20260523100000_rules_add_notification_channels
-- Adds per-rule notification channel routing (Option A from life-v66).
--
-- notification_channels stores where a rule dispatches: e.g. ["in_app"], ["email"], ["in_app","push"]
-- Keeps "when to fire" (condition_config) cleanly separate from "where to route".

ALTER TABLE public.rules
  ADD COLUMN IF NOT EXISTS notification_channels jsonb NOT NULL DEFAULT '["in_app"]';

-- Clean up Rule 3 (issue_unblocked): strip the stray notify_channel key that
-- was stored inside condition_config (Option B anti-pattern). Move its value
-- to notification_channels instead.
UPDATE public.rules
SET
  notification_channels = jsonb_build_array(condition_config->>'notify_channel'),
  condition_config      = condition_config - 'notify_channel'
WHERE condition_type = 'issue_unblocked'
  AND condition_config ? 'notify_channel';
