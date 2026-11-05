-- Fixed-window rate limiter (login, webhook, export, receipt upload). Callable by the service role only.
create or replace function public.rpc_hit_rate_limit(p_key text, p_window_seconds int, p_max int)
returns table (allowed boolean, retry_after_seconds int)
language plpgsql security definer set search_path = '' as $$
declare r private.rate_limits;
begin
  insert into private.rate_limits as rl (key, window_start, count) values (p_key, now(), 1)
  on conflict (key) do update set
    count = case when rl.window_start < now() - make_interval(secs => p_window_seconds) then 1 else rl.count + 1 end,
    window_start = case when rl.window_start < now() - make_interval(secs => p_window_seconds) then now() else rl.window_start end
  returning * into r;
  return query select r.count <= p_max,
    greatest(0, ceil(extract(epoch from (r.window_start + make_interval(secs => p_window_seconds) - now())))::int);
end $$;

create or replace function public.rpc_peek_rate_limit(p_key text, p_window_seconds int, p_max int)
returns table (allowed boolean, retry_after_seconds int)
language sql security definer set search_path = '' as $$
  select coalesce(bool_and(r.count < p_max or r.window_start < now() - make_interval(secs => p_window_seconds)), true),
    coalesce(max(greatest(0, ceil(extract(epoch from (r.window_start + make_interval(secs => p_window_seconds) - now()))))::int), 0)
  from private.rate_limits r where r.key = p_key
$$;

create or replace function public.rpc_clear_rate_limit(p_key text) returns void
language sql security definer set search_path = '' as $$ delete from private.rate_limits where key = p_key $$;

revoke all on function public.rpc_hit_rate_limit(text, int, int) from public, anon, authenticated;
revoke all on function public.rpc_peek_rate_limit(text, int, int) from public, anon, authenticated;
revoke all on function public.rpc_clear_rate_limit(text) from public, anon, authenticated;
grant execute on function public.rpc_hit_rate_limit(text, int, int) to service_role;
grant execute on function public.rpc_peek_rate_limit(text, int, int) to service_role;
grant execute on function public.rpc_clear_rate_limit(text) to service_role;
