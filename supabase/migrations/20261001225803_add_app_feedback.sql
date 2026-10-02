create table public.app_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  category text not null check (category in ('bug', 'suggestion', 'other')),
  message text not null check (char_length(btrim(message)) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index app_feedback_user_id_idx on public.app_feedback(user_id);
alter table public.app_feedback enable row level security;
revoke all on public.app_feedback from anon, authenticated;
grant insert on public.app_feedback to authenticated;
grant all on public.app_feedback to service_role;
create policy "Users submit their own feedback" on public.app_feedback for insert to authenticated with check ((select auth.uid()) = user_id);
