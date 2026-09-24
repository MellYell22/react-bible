-- Signed-in users may edit their own profile row (preferences), but billing,
-- plan, role, and email columns are server-owned. Without this guard anyone
-- could set subscription_tier = 'pro' or role = 'owner' from the browser.
-- Service-role writes (Stripe webhook, checkout sync) are unaffected.

create or replace function public.protect_profile_billing_columns()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.subscription_tier := 'free';
    new.role := 'user';
    new.subscription_status := null;
    new.stripe_customer_id := null;
    new.stripe_subscription_id := null;
    new.stripe_subscription_status := null;
    new.stripe_price_id := null;
    new.stripe_current_period_end := null;
    new.email := coalesce(auth.jwt() ->> 'email', new.email);
    return new;
  end if;

  if new.id is distinct from old.id
    or new.email is distinct from old.email
    or new.role is distinct from old.role
    or new.subscription_tier is distinct from old.subscription_tier
    or new.subscription_status is distinct from old.subscription_status
    or new.stripe_customer_id is distinct from old.stripe_customer_id
    or new.stripe_subscription_id is distinct from old.stripe_subscription_id
    or new.stripe_subscription_status is distinct from old.stripe_subscription_status
    or new.stripe_price_id is distinct from old.stripe_price_id
    or new.stripe_current_period_end is distinct from old.stripe_current_period_end
  then
    raise exception 'Billing and account fields can only be changed by the server.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists protect_profile_billing_columns on public.profiles;
create trigger protect_profile_billing_columns
  before insert or update on public.profiles
  for each row execute function public.protect_profile_billing_columns();
