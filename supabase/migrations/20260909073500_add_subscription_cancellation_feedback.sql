create table if not exists public.subscription_cancellation_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan text,
  reason text not null,
  details text,
  created_at timestamptz not null default now()
);

alter table public.subscription_cancellation_feedback enable row level security;

create policy "users_can_submit_own_cancellation_feedback"
on public.subscription_cancellation_feedback
for insert
to authenticated
with check (auth.uid() = user_id);

create index if not exists subscription_cancellation_feedback_user_id_idx
on public.subscription_cancellation_feedback(user_id);

create index if not exists subscription_cancellation_feedback_created_at_idx
on public.subscription_cancellation_feedback(created_at desc);
