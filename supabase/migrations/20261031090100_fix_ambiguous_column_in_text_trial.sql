-- consume_david_intro_text_message always threw "column reference
-- text_messages_used is ambiguous": the function's OUT parameter shares its
-- name with the column, so the unqualified right-hand side of the UPDATE
-- could not be resolved. api/david-chat.ts swallowed the failure, so the
-- free text trial never counted down and never ran out.
--
-- Qualifying the column fixes it. Behaviour is otherwise unchanged.

create or replace function public.consume_david_intro_text_message(p_user_id uuid)
returns table (allowed boolean, text_messages_used integer, text_messages_remaining integer)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_used integer;
begin
  if p_user_id is null then
    return query select false, 25, 0;
    return;
  end if;
  insert into public.david_intro_trial_usage (user_id) values (p_user_id)
  on conflict (user_id) do nothing;
  select u.text_messages_used into v_used from public.david_intro_trial_usage u where u.user_id = p_user_id for update;
  if coalesce(v_used, 0) >= 25 then
    return query select false, 25, 0;
    return;
  end if;
  update public.david_intro_trial_usage
  set text_messages_used = david_intro_trial_usage.text_messages_used + 1, updated_at = now()
  where user_id = p_user_id
  returning david_intro_trial_usage.text_messages_used into v_used;
  return query select true, v_used, greatest(25 - v_used, 0);
end;
$function$;

revoke all on function public.consume_david_intro_text_message(uuid) from public;
revoke all on function public.consume_david_intro_text_message(uuid) from anon;
revoke all on function public.consume_david_intro_text_message(uuid) from authenticated;
grant execute on function public.consume_david_intro_text_message(uuid) to service_role;
