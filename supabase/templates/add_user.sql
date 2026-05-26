-- Template: add_user.sql
-- Pre-insert a new user into auth.users so they can sign in via magic link.
--
-- Sign-ups are disabled — new users MUST be pre-inserted here before they can
-- authenticate. Any magic link request for an email not in auth.users is
-- silently dropped by Supabase.
--
-- HOW TO USE
-- ----------
-- 1. Copy this file to supabase/migrations/YYYYMMDDHHMMSS_add_user_<name>.sql
-- 2. Replace all four placeholder values (marked with <...>) below
-- 3. Run: SUPABASE_ACCESS_TOKEN=sbp_... supabase db push --workdir /Users/mo/Code/life-organizer --yes
-- 4. Verify: SELECT id, email FROM auth.users;
--
-- PLACEHOLDER REFERENCE
-- ---------------------
--   <USER_UUID>   A new random UUID. Generate with: python3 -c "import uuid; print(uuid.uuid4())"
--   <EMAIL>       The user's email address (must match what they use to request a magic link)
--   <FULL_NAME>   Display name shown in the app (stored in raw_user_meta_data)
--
-- IMPORTANT: The UUID you choose here becomes the user's permanent identity.
-- All data rows created by this user will carry this UUID in their user_id column.
-- Do not change it after creation.

insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  is_super_admin,
  is_sso_user,
  created_at,
  updated_at
)
values (
  '00000000-0000-0000-0000-000000000000',  -- instance_id: always this value for hosted Supabase
  '<USER_UUID>',                            -- replace: new random UUID
  'authenticated',
  'authenticated',
  '<EMAIL>',                                -- replace: user's email address
  '',                                       -- no password — magic link only
  now(),                                    -- email pre-confirmed
  '{"provider":"email","providers":["email"]}',
  '{"full_name": "<FULL_NAME>"}',           -- replace: display name
  false,
  false,
  now(),
  now()
)
on conflict (id) do nothing;               -- idempotent: safe to re-run
