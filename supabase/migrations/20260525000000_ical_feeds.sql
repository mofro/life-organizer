-- Migration: 20260525000000_ical_feeds
-- Replace single apple_ical_url with ical_feeds jsonb array so users can
-- connect multiple iCal sources (iCloud, Outlook, etc.) simultaneously.
--
-- Backward compat: apple_ical_url is kept but no longer written to.
-- Existing value is migrated into ical_feeds on upgrade.

alter table public.user_preferences
  add column if not exists ical_feeds jsonb not null default '[]';

-- Migrate any existing single URL into the new array (idempotent).
update public.user_preferences
  set ical_feeds = jsonb_build_array(apple_ical_url)
  where apple_ical_url is not null
    and apple_ical_url <> ''
    and ical_feeds = '[]'::jsonb;
