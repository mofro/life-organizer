alter table public.user_preferences
  add column if not exists apple_ical_url text;
