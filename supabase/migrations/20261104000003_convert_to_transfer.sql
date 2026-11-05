-- F-03.3: turn a one-sided outgoing transaction (e.g. a Livin' "Top-up Berhasil" to OVO) into a transfer to one of the
-- owner's accounts. The incoming side is created on the destination account and both are linked. Owner-triggered only.
create or replace function public.rpc_convert_to_transfer(p_tx uuid, p_to uuid) returns uuid
language plpgsql security invoker set search_path = public as $$
declare v_out public.transactions%rowtype; v_in uuid; v_link uuid;
begin
  select * into v_out from transactions where id = p_tx and deleted_at is null for update;
  if not found then raise exception 'TIDAK_DITEMUKAN' using errcode = 'P0002'; end if;
  if v_out.direction <> 'out' or v_out.kind <> 'expense' then raise exception 'BUKAN_PENGELUARAN' using errcode = '22023'; end if;
  if v_out.account_id = p_to then raise exception 'AKUN_SAMA' using errcode = '22023'; end if;
  if exists (select 1 from transfer_links where p_tx in (out_transaction_id, in_transaction_id, fee_transaction_id)) then
    raise exception 'SUDAH_TERTAUT' using errcode = '22023';
  end if;
  if not exists (select 1 from accounts where id = p_to and archived_at is null and not is_system) then
    raise exception 'AKUN_TIDAK_VALID' using errcode = '22023';
  end if;

  update transactions set kind = 'transfer', status = 'confirmed', review_reason = null, category_id = null, is_one_off = false
  where id = p_tx;
  insert into transactions (account_id, direction, amount, occurred_at, kind, status, source)
  values (p_to, 'in', v_out.amount, v_out.occurred_at, 'transfer', 'confirmed', v_out.source) returning id into v_in;
  insert into transfer_links (out_transaction_id, in_transaction_id, created_by) values (p_tx, v_in, 'manual') returning id into v_link;
  update match_proposals set status = 'closed', resolved_at = now()
  where status = 'open' and p_tx in (transaction_id, other_transaction_id);
  return v_link;
end $$;
