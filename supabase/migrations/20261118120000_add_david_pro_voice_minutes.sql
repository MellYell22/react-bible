-- David's Voice Pro includes 60 minutes of live conversation per billing
-- period. This is the meter for that allowance.
--
-- One row per account per billing period, keyed by the subscription's
-- current period end. When Stripe renews the subscription the period end
-- moves forward, a fresh row starts at zero, and the minutes reset on their
-- own — no cron job, no reset step that can be missed.
--
-- The limit lives here and in PRO_VOICE_SECONDS_PER_PERIOD
-- (lib/chatAccess.ts); both must move together. The owner account is never
-- metered and never reaches this table.

create table if not exists public.david_pro_voice_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  period_end timestamptz not null,
  seconds_used integer not null default 0 check (seconds_used >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, period_end)
);

alter table public.david_pro_voice_usage enable row level security;

-- Nobody reads or writes this from the browser. The server uses the service
-- role, which bypasses RLS; with no policies, every other role is refused.
revoke all on table public.david_pro_voice_usage from anon, authenticated;

-- Adds talk time to the current period and reports what is left. The row is
-- locked while it is updated, so two heartbeats racing each other can never
-- both take the last seconds. A single call is capped at 60 seconds, so a
-- forged or replayed request cannot burn or fake a large chunk at once.
create or replace function public.consume_david_pro_voice_seconds(
  p_user_id uuid,
  p_period_end timestamptz,
  p_seconds integer
)
returns table (allowed boolean, seconds_used integer, seconds_remaining integer)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_used integer;
  v_limit constant integer := 3600;
  v_spend integer := least(greatest(coalesce(p_seconds, 0), 0), 60);
begin
  if p_user_id is null or p_period_end is null then
    return query select false, v_limit, 0;
    return;
  end if;

  insert into public.david_pro_voice_usage (user_id, period_end)
  values (p_user_id, p_period_end)
  on conflict (user_id, period_end) do nothing;

  select u.seconds_used into v_used
  from public.david_pro_voice_usage u
  where u.user_id = p_user_id and u.period_end = p_period_end
  for update;

  if coalesce(v_used, 0) >= v_limit then
    return query select false, v_limit, 0;
    return;
  end if;

  -- Table-qualified on purpose: the OUT parameter is also called seconds_used.
  update public.david_pro_voice_usage
  set seconds_used = least(david_pro_voice_usage.seconds_used + v_spend, v_limit),
      updated_at = now()
  where user_id = p_user_id and period_end = p_period_end
  returning david_pro_voice_usage.seconds_used into v_used;

  return query select (v_used < v_limit), v_used, greatest(v_limit - v_used, 0);
end;
$function$;

revoke all on function public.consume_david_pro_voice_seconds(uuid, timestamptz, integer) from public;
revoke all on function public.consume_david_pro_voice_seconds(uuid, timestamptz, integer) from anon;
revoke all on function public.consume_david_pro_voice_seconds(uuid, timestamptz, integer) from authenticated;
grant execute on function public.consume_david_pro_voice_seconds(uuid, timestamptz, integer) to service_role;
