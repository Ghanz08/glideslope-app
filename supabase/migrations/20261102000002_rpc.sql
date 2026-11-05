-- Aggregate reads and atomic multi-row writes. All functions are SECURITY INVOKER, so RLS applies.

-- ---------------------------------------------------------------- bootstrap (F-01.3, F-02.1, F-03.5, F-04.5)
create or replace function public.rpc_bootstrap() returns void
language plpgsql security invoker set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  insert into app_settings (user_id) values (uid) on conflict do nothing;

  if not exists (select 1 from accounts where user_id = uid and is_system) then
    insert into accounts (user_id, name, kind, opening_balance, opening_date, is_system, sort_order)
    values (uid, 'Belum ditentukan', 'cash', 0, current_date, true, 999);
  end if;

  insert into categories (user_id, name, kind, icon_key, tone_key, is_system, sort_order)
  select uid, c.name, c.kind, c.icon, c.tone, true, c.ord
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

  insert into integrations (user_id, provider, status) values (uid, 'gmail', 'terputus') on conflict do nothing;
end $$;

-- ---------------------------------------------------------------- balances (API-05, F-02.2, Table 5.4-H inputs)
create or replace function public.account_balance_at(p_account uuid, p_as_of date) returns bigint
language sql stable security invoker set search_path = public as $$
  select a.opening_balance + coalesce(sum(case when t.direction = 'in' then t.amount else -t.amount end), 0)
  from accounts a
  left join transactions t on t.account_id = a.id
    and t.deleted_at is null and t.status <> 'ignored'
    and wib_date(t.occurred_at) >= a.opening_date
    and wib_date(t.occurred_at) <= p_as_of
  where a.id = p_account
  group by a.id
$$;

create or replace function public.rpc_account_balances(p_as_of date default (now() at time zone 'Asia/Jakarta')::date)
returns table (
  account_id uuid, name text, kind text, last4 text, sort_order int, is_system boolean, archived_at timestamptz,
  balance bigint, checkpoint_as_of date, checkpoint_balance bigint, checkpoint_computed bigint, has_auto_source_30d boolean
)
language sql stable security invoker set search_path = public as $$
  select a.id, a.name, a.kind, a.last4, a.sort_order, a.is_system, a.archived_at,
    account_balance_at(a.id, p_as_of),
    cp.as_of, cp.balance, case when cp.as_of is not null then account_balance_at(a.id, cp.as_of) end,
    exists (select 1 from transactions t where t.account_id = a.id and t.deleted_at is null
            and t.source in ('email', 'webhook') and t.occurred_at >= (p_as_of - 30)::timestamptz)
  from accounts a
  left join lateral (
    select c.as_of, c.balance from account_checkpoints c
    where c.account_id = a.id and c.as_of <= p_as_of
    order by c.as_of desc, c.created_at desc limit 1
  ) cp on true
  order by a.sort_order, a.created_at
$$;

-- ---------------------------------------------------------------- transfer (API-08, F-03.3)
create or replace function public.rpc_create_transfer(
  p_from uuid, p_to uuid, p_amount bigint, p_fee bigint, p_occurred_at timestamptz, p_client_id uuid
) returns uuid
language plpgsql security invoker set search_path = public as $$
declare v_out uuid; v_in uuid; v_fee uuid; v_link uuid; v_cat uuid;
begin
  if p_from = p_to then raise exception 'AKUN_SAMA' using errcode = '22023'; end if;
  if p_amount <= 0 or p_fee < 0 then raise exception 'VALIDASI' using errcode = '22023'; end if;
  -- idempotency: the out side carries the client id
  select l.id into v_link from transfer_links l join transactions t on t.id = l.out_transaction_id
    where t.client_id = p_client_id;
  if v_link is not null then return v_link; end if;

  insert into transactions (account_id, direction, amount, occurred_at, kind, status, source, client_id, note)
  values (p_from, 'out', p_amount, p_occurred_at, 'transfer', 'confirmed', 'manual', p_client_id, null) returning id into v_out;
  insert into transactions (account_id, direction, amount, occurred_at, kind, status, source)
  values (p_to, 'in', p_amount, p_occurred_at, 'transfer', 'confirmed', 'manual') returning id into v_in;
  if p_fee > 0 then
    select id into v_cat from categories where kind = 'expense' and name = 'Biaya admin' and is_system limit 1;
    insert into transactions (account_id, direction, amount, occurred_at, kind, category_id, status, source, merchant_raw)
    values (p_from, 'out', p_fee, p_occurred_at, 'fee', v_cat, 'confirmed', 'manual', 'Biaya admin transfer') returning id into v_fee;
  end if;
  insert into transfer_links (out_transaction_id, in_transaction_id, fee_transaction_id, created_by)
  values (v_out, v_in, v_fee, 'manual') returning id into v_link;
  return v_link;
end $$;

-- ---------------------------------------------------------------- delete / restore (API-09, F-03.4, F-03.3 edge case)
create or replace function public.linked_transaction_ids(p_id uuid) returns uuid[]
language sql stable security invoker set search_path = public as $$
  select coalesce(array_agg(distinct x) filter (where x is not null), array[p_id])
  from (
    select p_id as x
    union all select unnest(array[l.out_transaction_id, l.in_transaction_id, l.fee_transaction_id])
    from transfer_links l where p_id in (l.out_transaction_id, l.in_transaction_id, l.fee_transaction_id)
  ) s
$$;

create or replace function public.rpc_delete_transaction(p_id uuid) returns uuid[]
language plpgsql security invoker set search_path = public as $$
declare ids uuid[] := linked_transaction_ids(p_id);
begin
  update transactions set deleted_at = now() where id = any(ids) and deleted_at is null;
  if not found then raise exception 'TIDAK_DITEMUKAN' using errcode = 'P0002'; end if;
  update match_proposals set status = 'closed', resolved_at = now()
    where status = 'open' and (transaction_id = any(ids) or other_transaction_id = any(ids));
  return ids;
end $$;

create or replace function public.rpc_restore_transaction(p_id uuid) returns void
language plpgsql security invoker set search_path = public as $$
begin
  update transactions set deleted_at = null where id = any(linked_transaction_ids(p_id));
end $$;

-- ---------------------------------------------------------------- review (API-20, F-05.2, F-03.5)
create or replace function public.rpc_confirm_review(
  p_tx uuid, p_category uuid, p_account uuid, p_remember boolean, p_expected_updated_at timestamptz default null
) returns int
language plpgsql security invoker set search_path = public as $$
declare t transactions; v_sys boolean; n int := 1;
begin
  select * into t from transactions where id = p_tx and deleted_at is null for update;
  if not found then raise exception 'TIDAK_DITEMUKAN' using errcode = 'P0002'; end if;
  if p_expected_updated_at is not null and t.updated_at <> p_expected_updated_at then
    raise exception 'SUDAH_DIUBAH' using errcode = '40001';
  end if;
  if t.status not in ('needs_review', 'auto_confirmed') then raise exception 'STATUS_BERUBAH' using errcode = '40001'; end if;
  select is_system into v_sys from accounts where id = coalesce(p_account, t.account_id);
  if v_sys then raise exception 'AKUN_BELUM_DITENTUKAN' using errcode = '22023'; end if;
  if t.kind in ('expense', 'income', 'fee') and coalesce(p_category, t.category_id) is null then
    raise exception 'KATEGORI_KOSONG' using errcode = '22023';
  end if;

  update transactions set status = 'confirmed', review_reason = null,
    category_id = coalesce(p_category, category_id), account_id = coalesce(p_account, account_id)
  where id = p_tx;

  if p_remember and t.merchant_id is not null and p_category is not null then
    update merchants set default_category_id = p_category where id = t.merchant_id;
    -- bulk-apply to other open items of the same new merchant
    if t.review_reason = 'merchant_baru' then
      update transactions set status = 'confirmed', review_reason = null, category_id = p_category
      where merchant_id = t.merchant_id and status = 'needs_review' and review_reason = 'merchant_baru'
        and deleted_at is null and id <> p_tx
        and not exists (select 1 from accounts a where a.id = transactions.account_id and a.is_system);
      get diagnostics n = row_count;
      n := n + 1;
    end if;
  end if;
  return n;
end $$;

-- ---------------------------------------------------------------- proposals (API-21, F-05.3, F-09.3, F-10.3)
create or replace function public.rpc_accept_proposal(p_id uuid) returns void
language plpgsql security invoker set search_path = public as $$
declare p match_proposals; a transactions; b transactions; v_fee uuid; v_cat uuid; r receivables; v_out transactions; v_in transactions;
begin
  select * into p from match_proposals where id = p_id and status = 'open' for update;
  if not found then raise exception 'TIDAK_DITEMUKAN' using errcode = 'P0002'; end if;
  select * into a from transactions where id = p.transaction_id and deleted_at is null and status <> 'ignored';
  if not found then raise exception 'TRANSAKSI_HILANG' using errcode = '40001'; end if;

  if p.type = 'transfer' then
    select * into b from transactions where id = p.other_transaction_id and deleted_at is null and status <> 'ignored';
    if not found then raise exception 'TRANSAKSI_HILANG' using errcode = '40001'; end if;
    if exists (select 1 from transfer_links where out_transaction_id in (a.id, b.id) or in_transaction_id in (a.id, b.id)) then
      raise exception 'SUDAH_DITAUTKAN' using errcode = '40001';
    end if;
    if a.direction = 'out' then v_out := a; v_in := b; else v_out := b; v_in := a; end if;
    update transactions set kind = 'transfer', status = 'confirmed', review_reason = null, category_id = null, amount = v_in.amount
      where id = v_out.id;
    update transactions set kind = 'transfer', status = 'confirmed', review_reason = null, category_id = null where id = v_in.id;
    if p.fee_amount > 0 then
      select id into v_cat from categories where kind = 'expense' and name = 'Biaya admin' and is_system limit 1;
      insert into transactions (account_id, direction, amount, occurred_at, kind, category_id, status, source, merchant_raw)
      values (v_out.account_id, 'out', p.fee_amount, v_out.occurred_at, 'fee', v_cat, 'confirmed', v_out.source, 'Biaya admin transfer')
      returning id into v_fee;
    end if;
    insert into transfer_links (out_transaction_id, in_transaction_id, fee_transaction_id, created_by)
    values (v_out.id, v_in.id, v_fee, 'proposal');
    -- one transaction may only sit in one open proposal
    update match_proposals set status = 'closed', resolved_at = now()
      where status = 'open' and id <> p.id and (transaction_id in (a.id, b.id) or other_transaction_id in (a.id, b.id));

  elsif p.type = 'repayment' then
    select * into r from receivables where id = p.receivable_id for update;
    if r.status not in ('open', 'partially_paid') then raise exception 'PIUTANG_SELESAI' using errcode = '40001'; end if;
    if a.amount > r.remaining then raise exception 'MELEBIHI_SISA' using errcode = '22023'; end if;
    update transactions set kind = 'repayment', status = 'confirmed', review_reason = null, category_id = null where id = a.id;
    insert into receivable_payments (receivable_id, transaction_id, amount) values (r.id, a.id, a.amount);
    perform apply_receivable_payment(r.id, a.amount);
    update match_proposals set status = 'closed', resolved_at = now()
      where status = 'open' and id <> p.id and transaction_id = a.id;

  elsif p.type = 'receipt_link' then
    if exists (select 1 from transaction_evidence where transaction_id = a.id and role = 'receipt') then
      raise exception 'SUDAH_ADA_NOTA' using errcode = '40001';
    end if;
    insert into transaction_evidence (transaction_id, role, receipt_id, parsed_amount, match_score)
      select a.id, 'receipt', rc.id, rc.total, p.score from receipts rc where rc.id = p.receipt_id;
    update receipts set linked_transaction_id = a.id where id = p.receipt_id;
    update match_proposals set status = 'closed', resolved_at = now()
      where status = 'open' and id <> p.id and type = 'receipt_link' and (transaction_id = a.id or receipt_id = p.receipt_id);

  elsif p.type = 'duplicate_suspect' then
    -- accept = "these are the same": keep the main transaction, ignore the other and keep its evidence
    insert into transaction_evidence (transaction_id, role, ingest_event_id, receipt_id, parsed_amount, match_score)
      select a.id, e.role, e.ingest_event_id, e.receipt_id, e.parsed_amount, p.score
      from transaction_evidence e where e.transaction_id = p.other_transaction_id
      on conflict do nothing;
    update transactions set status = 'ignored' where id = p.other_transaction_id;
    if a.status = 'needs_review' and a.review_reason = 'duplikat_diduga' then
      update transactions set review_reason = 'kepercayaan_rendah' where id = a.id;
    end if;
  end if;

  update match_proposals set status = 'accepted', resolved_at = now() where id = p.id;
end $$;

create or replace function public.apply_receivable_payment(p_receivable uuid, p_amount bigint) returns void
language plpgsql security invoker set search_path = public as $$
declare r receivables;
begin
  update receivables set remaining = remaining - p_amount,
    status = case when remaining - p_amount = 0 then 'settled' else 'partially_paid' end,
    settled_at = case when remaining - p_amount = 0 then now() end
  where id = p_receivable returning * into r;
  if r.status = 'settled' then
    update split_bills sb set status = 'settled'
    where sb.status = 'shared' and sb.id = (select split_bill_id from split_participants where id = r.split_participant_id)
      and not exists (
        select 1 from receivables x join split_participants sp on sp.id = x.split_participant_id
        where sp.split_bill_id = sb.id and x.status in ('open', 'partially_paid'));
  end if;
end $$;

create or replace function public.rpc_reject_proposal(p_id uuid) returns void
language sql security invoker set search_path = public as $$
  update match_proposals set status = 'rejected', resolved_at = now() where id = p_id and status = 'open'
$$;

-- ---------------------------------------------------------------- receivables (API-34, F-10.3)
create or replace function public.rpc_record_repayment(p_receivable uuid, p_amount bigint, p_account uuid, p_at timestamptz)
returns uuid
language plpgsql security invoker set search_path = public as $$
declare r receivables; v_tx uuid;
begin
  select * into r from receivables where id = p_receivable for update;
  if not found then raise exception 'TIDAK_DITEMUKAN' using errcode = 'P0002'; end if;
  if r.status not in ('open', 'partially_paid') then raise exception 'PIUTANG_SELESAI' using errcode = '40001'; end if;
  if p_amount <= 0 or p_amount > r.remaining then raise exception 'MELEBIHI_SISA' using errcode = '22023'; end if;
  insert into transactions (account_id, direction, amount, occurred_at, kind, status, source, merchant_raw)
  values (p_account, 'in', p_amount, p_at, 'repayment', 'confirmed', 'manual', r.person_name || ' · pelunasan') returning id into v_tx;
  insert into receivable_payments (receivable_id, transaction_id, amount) values (r.id, v_tx, p_amount);
  perform apply_receivable_payment(r.id, p_amount);
  return v_tx;
end $$;

create or replace function public.rpc_write_off_receivable(p_receivable uuid) returns void
language plpgsql security invoker set search_path = public as $$
begin
  update receivables set status = 'written_off' where id = p_receivable and status in ('open', 'partially_paid');
  if not found then raise exception 'PIUTANG_SELESAI' using errcode = '40001'; end if;
  update split_bills sb set status = 'settled'
  where sb.status = 'shared'
    and sb.id = (select sp.split_bill_id from receivables x join split_participants sp on sp.id = x.split_participant_id where x.id = p_receivable)
    and not exists (select 1 from receivables x join split_participants sp on sp.id = x.split_participant_id
                    where sp.split_bill_id = sb.id and x.status in ('open', 'partially_paid'));
end $$;

-- ---------------------------------------------------------------- split share (API-33, F-10.1/10.3)
-- Shares are computed in TypeScript (Table 5.4-D) and written first; this flips the status and creates receivables.
create or replace function public.rpc_share_split(p_split uuid) returns void
language plpgsql security invoker set search_path = public as $$
declare s split_bills; v_sum bigint;
begin
  select * into s from split_bills where id = p_split for update;
  if not found then raise exception 'TIDAK_DITEMUKAN' using errcode = 'P0002'; end if;
  if s.status <> 'draft' then raise exception 'SUDAH_DIBAGIKAN' using errcode = '40001'; end if;
  select coalesce(sum(share_amount), 0) into v_sum from split_participants where split_bill_id = p_split;
  if v_sum <> s.total then raise exception 'JUMLAH_TIDAK_SAMA' using errcode = '22023'; end if;
  update split_bills set status = 'shared', shared_at = now() where id = p_split;
  insert into receivables (split_participant_id, person_name, amount, remaining)
  select id, name, share_amount, share_amount from split_participants
  where split_bill_id = p_split and not is_owner and share_amount > 0;
end $$;

create or replace function public.rpc_cancel_split(p_split uuid) returns void
language plpgsql security invoker set search_path = public as $$
begin
  if exists (select 1 from receivable_payments rp join receivables r on r.id = rp.receivable_id
             join split_participants sp on sp.id = r.split_participant_id where sp.split_bill_id = p_split) then
    raise exception 'SUDAH_ADA_PEMBAYARAN' using errcode = '40001';
  end if;
  update receivables set status = 'written_off'
    where status in ('open', 'partially_paid')
      and split_participant_id in (select id from split_participants where split_bill_id = p_split);
  update split_bills set status = 'cancelled' where id = p_split and status in ('draft', 'shared');
end $$;

-- ---------------------------------------------------------------- assets (API-25/27, F-07.1, F-07.3)
create or replace function public.asset_value(p_asset uuid, p_as_of date) returns bigint
language sql stable security invoker set search_path = public as $$
  select round(a.quantity * coalesce(
    (select unit_price from asset_prices p where p.asset_id = a.id and p.as_of <= p_as_of order by as_of desc limit 1), 0))::bigint
  from assets a where a.id = p_asset
$$;

create or replace function public.rpc_purchase_asset(p_asset uuid, p_amount bigint, p_quantity numeric, p_account uuid, p_on date)
returns uuid
language plpgsql security invoker set search_path = public as $$
declare v_tx uuid; v_name text;
begin
  if p_amount <= 0 or p_quantity <= 0 then raise exception 'VALIDASI' using errcode = '22023'; end if;
  select name into v_name from assets where id = p_asset and archived_at is null for update;
  if not found then raise exception 'TIDAK_DITEMUKAN' using errcode = 'P0002'; end if;
  insert into transactions (account_id, direction, amount, occurred_at, kind, status, source, merchant_raw)
  values (p_account, 'out', p_amount, (p_on::text || ' 12:00:00+07')::timestamptz, 'investment', 'confirmed', 'manual', 'Beli ' || v_name)
  returning id into v_tx;
  insert into asset_events (asset_id, kind, occurred_on, quantity_delta, amount, transaction_id)
  values (p_asset, 'purchase', p_on, p_quantity, p_amount, v_tx);
  update assets set quantity = quantity + p_quantity where id = p_asset;
  return v_tx;
end $$;

create or replace function public.rpc_redeem_asset(p_asset uuid, p_amount bigint, p_account uuid, p_fee bigint, p_on date)
returns uuid
language plpgsql security invoker set search_path = public as $$
declare a assets; v_value bigint; v_qty numeric; v_tx uuid; v_cat uuid;
begin
  select * into a from assets where id = p_asset for update;
  if not found then raise exception 'TIDAK_DITEMUKAN' using errcode = 'P0002'; end if;
  if a.archived_at is not null then raise exception 'ASET_DIARSIPKAN' using errcode = '40001'; end if;
  v_value := asset_value(p_asset, p_on);
  if p_amount <= 0 or p_fee < 0 then raise exception 'VALIDASI' using errcode = '22023'; end if;
  if p_amount > v_value then raise exception 'MELEBIHI_NILAI' using errcode = '22023'; end if;
  v_qty := case when p_amount = v_value then a.quantity else round(a.quantity * p_amount / v_value, 4) end;

  insert into transactions (account_id, direction, amount, occurred_at, kind, status, source, merchant_raw)
  values (p_account, 'in', p_amount, (p_on::text || ' 12:00:00+07')::timestamptz, 'redemption', 'confirmed', 'manual', 'Pencairan ' || a.name)
  returning id into v_tx;
  insert into asset_events (asset_id, kind, occurred_on, quantity_delta, amount, transaction_id)
  values (p_asset, 'redemption', p_on, -v_qty, p_amount, v_tx);

  if a.type = 'deposit' and p_amount < v_value then
    -- partial deposit redemption: quantity stays 1, the principal (price) is adjusted
    insert into asset_prices (asset_id, as_of, unit_price) values (p_asset, p_on, v_value - p_amount)
    on conflict (asset_id, as_of) do update set unit_price = excluded.unit_price;
  else
    update assets set quantity = quantity - v_qty,
      archived_at = case when quantity - v_qty <= 0 then now() end
    where id = p_asset;
  end if;

  if p_fee > 0 then
    select id into v_cat from categories where kind = 'expense' and name = 'Biaya admin' and is_system limit 1;
    insert into transactions (account_id, direction, amount, occurred_at, kind, category_id, status, source, merchant_raw)
    values (p_account, 'out', p_fee, (p_on::text || ' 12:00:00+07')::timestamptz, 'fee', v_cat, 'confirmed', 'manual', 'Biaya pencairan ' || a.name);
  end if;
  return v_tx;
end $$;

-- ---------------------------------------------------------------- storage bucket for receipts (F-09.1)
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'buckets') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('receipts', 'receipts', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
    on conflict (id) do nothing;
    execute $p$
      create policy receipts_owner on storage.objects for all to authenticated
      using (bucket_id = 'receipts' and (storage.foldername(name))[1] = (select auth.uid())::text and (select private.is_aal2()))
      with check (bucket_id = 'receipts' and (storage.foldername(name))[1] = (select auth.uid())::text and (select private.is_aal2()))
    $p$;
  end if;
end $$;
