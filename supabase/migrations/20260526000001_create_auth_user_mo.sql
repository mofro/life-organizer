-- Migration: 20260526000001_create_auth_user_mo
-- Pre-insert Mo's Supabase auth user with the existing data UUID.
--
-- ALL existing data rows carry user_id = '37b3da7e-de14-45e3-9969-e1350b8a6a30'.
-- Without this row in auth.users, Supabase Auth would create a NEW UUID on first
-- sign-in, and every existing data row would become inaccessible under RLS.
--
-- DEPLOYMENT ORDER (CRITICAL — do not skip):
--   1. supabase db push   ← applies this migration
--   2. Verify:  SELECT id FROM auth.users
--               WHERE id = '37b3da7e-de14-45e3-9969-e1350b8a6a30';
--              (must return 1 row before proceeding)
--   3. netlify deploy --prod   ← enables AuthGuard in the PWA
--
-- ON CONFLICT (id) DO NOTHING makes this idempotent.

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
  '00000000-0000-0000-0000-000000000000',
  '37b3da7e-de14-45e3-9969-e1350b8a6a30',
  'authenticated',
  'authenticated',
  'g.mofro@gmail.com',
  '',
  now(),
  '{"provider":"email","providers":["email"]}',
  '{}',
  false,
  false,
  now(),
  now()
)
on conflict (id) do nothing;
