-- Restore the production migration that hardens the auth.users trigger function.
-- The auth trigger may invoke this SECURITY DEFINER function, but clients must
-- not be able to call it directly.

revoke all on function public.handle_new_user() from public;
revoke all on function public.handle_new_user() from anon;
revoke all on function public.handle_new_user() from authenticated;
grant execute on function public.handle_new_user() to service_role;
