-- Gmail token storage in Vault (F-04.1) and pg_cron schedules (F-04.2, F-04.4, section 5.5 retention).
-- Tokens never live in a table: integrations.vault_secret_id only points at the Vault secret.

create or replace function public.store_gmail_secret(p_uid uuid, p_token text, p_email text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  select vault_secret_id into v_id from public.integrations where user_id = p_uid and provider = 'gmail';
  if v_id is not null and exists (select 1 from vault.secrets where id = v_id) then
    perform vault.update_secret(v_id, p_token);
  else
    v_id := vault.create_secret(p_token, 'gmail_refresh_' || p_uid::text || '_' || extract(epoch from now())::bigint, 'Gmail refresh token');
  end if;
  insert into public.integrations (user_id, provider, vault_secret_id, account_email, status, last_error)
  values (p_uid, 'gmail', v_id, p_email, 'terhubung', null)
  on conflict (user_id, provider) do update
    set vault_secret_id = excluded.vault_secret_id, account_email = excluded.account_email, status = 'terhubung', last_error = null;
  return v_id;
end $$;

create or replace function public.read_gmail_secret(p_uid uuid) returns text
language sql security definer set search_path = '' as $$
  select s.decrypted_secret from public.integrations i
  join vault.decrypted_secrets s on s.id = i.vault_secret_id
  where i.user_id = p_uid and i.provider = 'gmail'
$$;

/** Removes the secret and returns it once so the caller can revoke it at Google. */
create or replace function public.take_gmail_secret(p_uid uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_token text;
begin
  select i.vault_secret_id into v_id from public.integrations i where i.user_id = p_uid and i.provider = 'gmail';
  if v_id is not null then
    select decrypted_secret into v_token from vault.decrypted_secrets where id = v_id;
    delete from vault.secrets where id = v_id;
  end if;
  update public.integrations set vault_secret_id = null, status = 'terputus', backfill_state = null where user_id = p_uid and provider = 'gmail';
  return v_token;
end $$;

revoke all on function public.store_gmail_secret(uuid, text, text) from public, anon, authenticated;
revoke all on function public.read_gmail_secret(uuid) from public, anon, authenticated;
revoke all on function public.take_gmail_secret(uuid) from public, anon, authenticated;
grant execute on function public.store_gmail_secret(uuid, text, text) to service_role;
grant execute on function public.read_gmail_secret(uuid) to service_role;
grant execute on function public.take_gmail_secret(uuid) to service_role;

-- Schedules. They read `project_url` and `cron_secret` from Vault (see README), so no secret is in this file.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron')
     and exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_cron;
    create extension if not exists pg_net;
    perform cron.schedule('ingest-gmail', '*/5 * * * *', $c$
      select net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/ingest-gmail',
        headers := jsonb_build_object('content-type', 'application/json',
          'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')),
        body := '{"mode":"poll"}'::jsonb, timeout_milliseconds := 120000)
    $c$);
    perform cron.schedule('ingest-gmail-backfill', '*/5 * * * *', $c$
      select net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/ingest-gmail',
        headers := jsonb_build_object('content-type', 'application/json',
          'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')),
        body := '{"mode":"backfill"}'::jsonb, timeout_milliseconds := 120000)
      where exists (select 1 from public.integrations where backfill_state ->> 'status' = 'running')
    $c$);
    perform cron.schedule('process-llm-jobs', '*/5 * * * *', $c$
      select net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/process-llm-jobs',
        headers := jsonb_build_object('content-type', 'application/json',
          'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')),
        body := '{}'::jsonb, timeout_milliseconds := 120000)
    $c$);
    -- 03:00 WIB = 20:00 UTC
    perform cron.schedule('maintenance', '0 20 * * *', $c$
      select net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/maintenance',
        headers := jsonb_build_object('content-type', 'application/json',
          'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')),
        body := '{}'::jsonb, timeout_milliseconds := 120000)
    $c$);
  end if;
end $$;
