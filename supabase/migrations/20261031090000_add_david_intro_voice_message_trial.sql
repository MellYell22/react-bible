-- David's free voice trial is counted in exchanges, not minutes: every account
-- gets a handful of spoken replies once, then live voice needs Pro.
--
-- The old voice_seconds_used column stays for historical rows; nothing reads
-- or writes it any more.

alter table public.david_intro_trial_usage
  add column if not exists voice_messages_used integer not null default 0
  check (voice_messages_used >= 0);

-- Counts one spoken exchange against the trial and reports what is left.
-- The limit lives here and in FREE_VOICE_TRIAL_MESSAGES (lib/chatAccess.ts);
-- both must move together.
create or replace function public.consume_david_intro_voice_message(p_user_id uuid)
returns table (allowed boolean, voice_messages_used integer, voice_messages_remaining integer)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_used integer;
  v_limit constant integer := 5;
begin
  if p_user_id is null then
    return query select false, v_limit, 0;
    return;
  end if;

  insert into public.david_intro_trial_usage (user_id) values (p_user_id)
  on conflict (user_id) do nothing;

  select u.voice_messages_used into v_used
  from public.david_intro_trial_usage u
  where u.user_id = p_user_id
  for update;

  if coalesce(v_used, 0) >= v_limit then
    return query select false, v_limit, 0;
    return;
  end if;

  -- Both sides stay table-qualified: this function's OUT parameter is also
  -- called voice_messages_used, and an unqualified reference is ambiguous.
  update public.david_intro_trial_usage
  set voice_messages_used = david_intro_trial_usage.voice_messages_used + 1, updated_at = now()
  where user_id = p_user_id
  returning david_intro_trial_usage.voice_messages_used into v_used;

  return query select true, v_used, greatest(v_limit - v_used, 0);
end;
$function$;

revoke all on function public.consume_david_intro_voice_message(uuid) from public;
revoke all on function public.consume_david_intro_voice_message(uuid) from anon;
revoke all on function public.consume_david_intro_voice_message(uuid) from authenticated;
grant execute on function public.consume_david_intro_voice_message(uuid) to service_role;
