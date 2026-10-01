create or replace function public.consume_david_intro_voice_seconds(p_user_id uuid, p_seconds integer)
returns table (allowed boolean, voice_seconds_used integer, voice_seconds_remaining integer)
language plpgsql security definer set search_path = ''
as $function$
declare v_used integer; v_add integer := greatest(coalesce(p_seconds, 0), 0);
begin
  if p_user_id is null then return query select false, 3600, 0; return; end if;
  insert into public.david_intro_trial_usage (user_id) values (p_user_id) on conflict (user_id) do nothing;
  select u.voice_seconds_used into v_used from public.david_intro_trial_usage u where u.user_id=p_user_id for update;
  if coalesce(v_used,0) >= 3600 then return query select false,3600,0; return; end if;
  v_used := least(3600, coalesce(v_used,0)+v_add);
  update public.david_intro_trial_usage set voice_seconds_used=v_used,updated_at=now() where user_id=p_user_id;
  return query select true,v_used,greatest(3600-v_used,0);
end;$function$;
revoke all on function public.consume_david_intro_voice_seconds(uuid,integer) from public;
revoke all on function public.consume_david_intro_voice_seconds(uuid,integer) from anon;
revoke all on function public.consume_david_intro_voice_seconds(uuid,integer) from authenticated;
grant execute on function public.consume_david_intro_voice_seconds(uuid,integer) to service_role;
