-- Paid access must be backed by a current Stripe subscription, never by the
-- cached subscription_tier label alone. Mirrors resolveAccessTier() in
-- lib/subscriptionState.js (same rules, same 3-day renewal grace).
create or replace function public.profile_access_tier(p public.profiles)
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when p.role = 'owner'
      or pg_catalog.lower(pg_catalog.btrim(coalesce(p.email, ''))) = 'alissasmith.apps@gmail.com'
      then 'owner'
    when p.subscription_tier in ('plus', 'pro')
      and p.stripe_customer_id like 'cus\_%'
      and p.stripe_subscription_id like 'sub\_%'
      and p.stripe_subscription_status in ('active', 'trialing')
      and p.stripe_current_period_end is not null
      and p.stripe_current_period_end + interval '3 days' > pg_catalog.now()
      then p.subscription_tier
    else 'free'
  end;
$$;

revoke all on function public.profile_access_tier(public.profiles) from public;
grant execute on function public.profile_access_tier(public.profiles) to authenticated, service_role;

create or replace function public.claim_reflection_usage(p_user_id uuid)
returns table (
  allowed boolean,
  claim_id uuid,
  used integer,
  remaining integer,
  daily_limit integer,
  unlimited boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_access text;
  v_today date := (pg_catalog.now() at time zone 'UTC')::date;
  v_used integer := 0;
  v_claim_id uuid;
begin
  if p_user_id is null then
    raise exception 'A user id is required.' using errcode = '22023';
  end if;

  select public.profile_access_tier(p)
    into v_access
  from public.profiles as p
  where p.id = p_user_id;

  if not found then
    raise exception 'Profile not found.' using errcode = 'P0001';
  end if;

  if v_access in ('owner', 'plus', 'pro') then
    return query
      select true, null::uuid, 0, null::integer, 3, true;
    return;
  end if;

  -- Serialize claims for this user and UTC day so simultaneous requests can
  -- never slip past the three-reflection allowance.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'reflection:' || p_user_id::text || ':' || v_today::text,
      0
    )
  );

  select count(*)::integer
    into v_used
  from public.daily_feature_usage as usage
  where usage.user_id = p_user_id
    and usage.feature = 'reflection'
    and usage.created_at >= (v_today::timestamp at time zone 'UTC')
    and usage.created_at < ((v_today + 1)::timestamp at time zone 'UTC');

  if v_used >= 3 then
    return query
      select false, null::uuid, v_used, 0, 3, false;
    return;
  end if;

  insert into public.daily_feature_usage (user_id, feature)
  values (p_user_id, 'reflection')
  returning id into v_claim_id;

  v_used := v_used + 1;
  return query
    select true, v_claim_id, v_used, 3 - v_used, 3, false;
end;
$$;

revoke all on function public.claim_reflection_usage(uuid) from public;
revoke all on function public.claim_reflection_usage(uuid) from anon;
revoke all on function public.claim_reflection_usage(uuid) from authenticated;
grant execute on function public.claim_reflection_usage(uuid) to service_role;

comment on function public.claim_reflection_usage(uuid) is
  'Atomically grants up to three daily reflection requests to free users; Plus, Pro, and owner accounts are unlimited.';
