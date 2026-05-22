alter table public.user_preferences
  add column if not exists google_refresh_token text;
