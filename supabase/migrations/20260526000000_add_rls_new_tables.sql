-- Migration: 20260526000000_add_rls_new_tables
-- Add RLS policies for category_weights, block_rejections, checkin_log.
-- These tables were created in 20260524000002_c_new_tables.sql without policies.
-- DROP POLICY IF EXISTS + CREATE POLICY is the idempotent pattern used here.

alter table public.category_weights  enable row level security;
alter table public.block_rejections  enable row level security;
alter table public.checkin_log       enable row level security;

drop policy if exists "owner" on public.category_weights;
create policy "owner" on public.category_weights
  for all using (auth.uid() = user_id);

drop policy if exists "owner" on public.block_rejections;
create policy "owner" on public.block_rejections
  for all using (auth.uid() = user_id);

drop policy if exists "owner" on public.checkin_log;
create policy "owner" on public.checkin_log
  for all using (auth.uid() = user_id);
