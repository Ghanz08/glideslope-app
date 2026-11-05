-- Bootstrap for a given user, callable by the service role (seed script, ingest). rpc_bootstrap() delegates to it.
create or replace function public.bootstrap_user(p_uid uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into app_settings (user_id) values (p_uid) on conflict do nothing;
  if not exists (select 1 from accounts where user_id = p_uid and is_system) then
    insert into accounts (user_id, name, kind, opening_balance, opening_date, is_system, sort_order)
    values (p_uid, 'Belum ditentukan', 'cash', 0, current_date, true, 999);
  end if;
  insert into categories (user_id, name, kind, icon_key, tone_key, is_system, sort_order)
  select p_uid, c.name, c.kind, c.icon, c.tone, true, c.ord
  from (values
    ('Makan & minum', 'expense', 'utensils', 'makan', 1),
    ('Rumah tangga', 'expense', 'house', 'rumah', 2),
    ('Hiburan', 'expense', 'music', 'hiburan', 3),
    ('Belanja', 'expense', 'package', 'belanja', 4),
    ('Pendidikan', 'expense', 'graduation-cap', 'pendidikan', 5),
    ('Kesehatan', 'expense', 'square-plus', 'kesehatan', 6),
    ('Transportasi', 'expense', 'bus', 'transportasi', 7),
    ('Tagihan & langganan', 'expense', 'receipt', 'tagihan', 8),
    ('Biaya admin', 'expense', 'landmark', 'netral', 9),
    ('Lainnya', 'expense', 'circle-ellipsis', 'netral', 10),
    ('Uang saku', 'income', 'wallet', 'rumah', 1),
    ('Honor', 'income', 'briefcase', 'belanja', 2),
    ('Hadiah', 'income', 'gift', 'hiburan', 3),
    ('Lainnya', 'income', 'circle-ellipsis', 'netral', 4)
  ) as c(name, kind, icon, tone, ord)
  on conflict do nothing;
  insert into integrations (user_id, provider, status) values (p_uid, 'gmail', 'terputus') on conflict do nothing;
end $$;

revoke all on function public.bootstrap_user(uuid) from public, anon, authenticated;
grant execute on function public.bootstrap_user(uuid) to service_role;

create or replace function public.rpc_bootstrap() returns void
language plpgsql security invoker set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  -- RLS still applies to reads elsewhere; this only creates the caller's own default rows
  perform public.bootstrap_user_self();
end $$;

create or replace function public.bootstrap_user_self() returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.bootstrap_user(auth.uid());
end $$;
revoke all on function public.bootstrap_user_self() from public, anon;
grant execute on function public.bootstrap_user_self() to authenticated, service_role;
