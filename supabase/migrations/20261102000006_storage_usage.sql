-- F-13.2: storage usage for the owner (database size and receipt images).
create or replace function public.rpc_storage_usage() returns table (db_bytes bigint, storage_bytes bigint)
language plpgsql security definer set search_path = '' as $$
declare v_storage bigint := 0;
begin
  if auth.uid() is null or not private.is_aal2() then raise exception 'not authorised' using errcode = '42501'; end if;
  if exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'objects') then
    execute $q$ select coalesce(sum((metadata ->> 'size')::bigint), 0) from storage.objects where bucket_id = 'receipts' $q$ into v_storage;
  end if;
  return query select pg_database_size(current_database()), v_storage;
end $$;
revoke all on function public.rpc_storage_usage() from public, anon;
grant execute on function public.rpc_storage_usage() to authenticated;
