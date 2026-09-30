create table if not exists public.david_intro_trial_usage (
  user_id uuid primary key references auth.users(id) on delete cascade,
  text_messages_used integer not null default 0 check (text_messages_used >= 0 and text_messages_used <= 25),
  voice_seconds_used integer not null default 0 check (voice_seconds_used >= 0 and voice_seconds_used <= 3600),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.david_intro_trial_usage enable row level security;

revoke all on table public.david_intro_trial_usage from anon;
revoke insert, update, delete on table public.david_intro_trial_usage from authenticated;
grant select on table public.david_intro_trial_usage to authenticated;

drop policy if exists "users_can_read_own_david_intro_trial_usage" on public.david_intro_trial_usage;
create policy "users_can_read_own_david_intro_trial_usage"
on public.david_intro_trial_usage
for select
to authenticated
using ((select auth.uid()) = user_id);
