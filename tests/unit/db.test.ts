import { beforeAll, describe, expect, it } from "vitest";
import { addUser, asUser, createDb, type Db } from "../db/harness";

const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";
let db: Db;

const one = async <T = Record<string, unknown>>(q: Db["query"], sql: string, p: unknown[] = []) => (await q<T>(sql, p)).rows[0];

beforeAll(async () => {
  db = await createDb();
  await addUser(db, A);
  await addUser(db, B, true); // second account only possible with the service-only flag
  for (const u of [A, B]) await asUser(db, u, "aal2", (q) => q("select rpc_bootstrap()"));
}, 60_000);

async function account(uid: string, name: string, opening = 1_000_000) {
  return asUser(db, uid, "aal2", async (q) =>
    (await one<{ id: string }>(q, `insert into accounts (name, kind, opening_balance, opening_date) values ($1,'bank',$2,'2026-01-01') returning id`, [name, opening])).id,
  );
}
const cat = (uid: string, name: string) =>
  asUser(db, uid, "aal2", async (q) => (await one<{ id: string }>(q, `select id from categories where name=$1 and kind='expense'`, [name])).id);
const balance = (uid: string, acc: string) =>
  asUser(db, uid, "aal2", async (q) => Number((await one<{ b: string }>(q, `select account_balance_at($1, '2030-12-31') b`, [acc])).b));

describe("F-01.1 single owner + RLS aal2", () => {
  it("a third signup is rejected and no row is added", async () => {
    await expect(addUser(db, "00000000-0000-4000-8000-00000000000c")).rejects.toThrow(/Pendaftaran ditutup/);
    expect((await db.query(`select count(*)::int n from auth.users`)).rows[0]).toEqual({ n: 2 });
  });
  it("aal1 session reads 0 rows", async () => {
    const acc = await account(A, "Mandiri");
    expect(acc).toBeTruthy();
    const rows = await asUser(db, A, "aal1", async (q) => (await q(`select * from transactions`)).rows.length + (await q(`select * from accounts`)).rows.length);
    expect(rows).toBe(0);
  });
  it("aal1 cannot write", async () => {
    await expect(asUser(db, A, "aal1", (q) => q(`insert into accounts (name, kind, opening_balance, opening_date) values ('X','bank',0,'2026-01-01')`)))
      .rejects.toThrow(/row-level security/);
  });
  it("user B cannot read user A rows", async () => {
    const seen = await asUser(db, B, "aal2", async (q) => (await q(`select * from accounts where name = 'Mandiri'`)).rows.length);
    expect(seen).toBe(0);
  });
  it("RLS is enabled on every public table", async () => {
    const r = await db.query<{ relname: string }>(
      `select relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and not c.relrowsecurity`);
    expect(r.rows).toEqual([]);
  });
  it("app_settings has no plain PIN column", async () => {
    const r = await db.query<{ column_name: string }>(`select column_name from information_schema.columns where table_name='app_settings'`);
    const cols = r.rows.map((x) => x.column_name);
    expect(cols).toContain("pin_hash");
    expect(cols).not.toContain("pin");
  });
});

describe("F-02.1 accounts", () => {
  it("duplicate names (case-insensitive) are rejected among active accounts", async () => {
    await account(A, "BNI");
    await expect(account(A, "bni")).rejects.toThrow(/duplicate key/);
  });
  it("bootstrap creates exactly one system account", async () => {
    const n = await asUser(db, A, "aal2", async (q) => (await one<{ n: number }>(q, `select count(*)::int n from accounts where is_system`)).n);
    expect(n).toBe(1);
  });
});

describe("F-02.2 balance + F-03.3 transfer", () => {
  it("1.000.000 − 28.000 + 105.000 = 1.077.000; ignored rows excluded; rows before opening excluded", async () => {
    const acc = await account(A, "Saldo test");
    const food = await cat(A, "Makan & minum");
    await asUser(db, A, "aal2", async (q) => {
      await q(`insert into transactions (account_id,direction,amount,occurred_at,kind,category_id,status,source) values ($1,'out',28000,'2026-11-14T05:00Z','expense',$2,'confirmed','manual')`, [acc, food]);
      await q(`insert into transactions (account_id,direction,amount,occurred_at,kind,status,source) values ($1,'in',105000,'2026-11-14T06:00Z','repayment','confirmed','manual')`, [acc]);
      await q(`insert into transactions (account_id,direction,amount,occurred_at,kind,status,review_reason,source) values ($1,'out',5000,'2026-11-14T06:00Z','expense','ignored',null,'email')`, [acc]);
      await q(`insert into transactions (account_id,direction,amount,occurred_at,kind,category_id,status,source) values ($1,'out',7000,'2025-12-30T06:00Z','expense',$2,'confirmed','manual')`, [acc, food]);
    });
    expect(await balance(A, acc)).toBe(1_077_000);
  });

  it("transfer 100.000 + fee 1.000: from −101.000, to +100.000; client_id idempotent", async () => {
    const from = await account(A, "From");
    const to = await account(A, "To");
    const cid = "11111111-1111-4111-8111-111111111111";
    const l1 = await asUser(db, A, "aal2", async (q) => (await one<{ id: string }>(q, `select rpc_create_transfer($1,$2,100000,1000,now(),$3) id`, [from, to, cid])).id);
    const l2 = await asUser(db, A, "aal2", async (q) => (await one<{ id: string }>(q, `select rpc_create_transfer($1,$2,100000,1000,now(),$3) id`, [from, to, cid])).id);
    expect(l1).toBe(l2);
    expect(await balance(A, from)).toBe(899_000);
    expect(await balance(A, to)).toBe(1_100_000);
  });

  it("same account transfer is rejected", async () => {
    const x = await account(A, "Same");
    await expect(asUser(db, A, "aal2", (q) => q(`select rpc_create_transfer($1,$1,1,0,now(),gen_random_uuid())`, [x]))).rejects.toThrow(/AKUN_SAMA/);
  });

  it("deleting one side deletes both sides and the fee; restore brings them back", async () => {
    const from = await account(A, "DelFrom");
    const to = await account(A, "DelTo");
    await asUser(db, A, "aal2", async (q) => {
      const link = (await one<{ id: string }>(q, `select rpc_create_transfer($1,$2,50000,2500,now(),gen_random_uuid()) id`, [from, to])).id;
      const l = await one<{ in_transaction_id: string }>(q, `select in_transaction_id from transfer_links where id=$1`, [link]);
      const ids = (await one<{ ids: string[] }>(q, `select rpc_delete_transaction($1) ids`, [l.in_transaction_id])).ids;
      expect(ids).toHaveLength(3);
    });
    expect(await balance(A, from)).toBe(1_000_000);
    expect(await balance(A, to)).toBe(1_000_000);
  });
});

describe("F-05.2/05.3 review and proposals", () => {
  it("confirm on the system account is refused", async () => {
    await asUser(db, A, "aal2", async (q) => {
      const sys = (await one<{ id: string }>(q, `select id from accounts where is_system`)).id;
      const tx = (await one<{ id: string }>(q, `insert into transactions (account_id,direction,amount,occurred_at,kind,status,review_reason,source) values ($1,'out',1000,now(),'expense','needs_review','akun_tidak_dikenal','email') returning id`, [sys])).id;
      await expect(q(`select rpc_confirm_review($1, null, null, false)`, [tx])).rejects.toThrow(/AKUN_BELUM_DITENTUKAN/);
    }).catch((e) => expect(String(e)).toMatch(/AKUN_BELUM_DITENTUKAN/));
  });

  it("confirming a new merchant confirms all its open merchant_baru items", async () => {
    const acc = await account(A, "Bulk");
    const food = await cat(A, "Makan & minum");
    const n = await asUser(db, A, "aal2", async (q) => {
      const m = (await one<{ id: string }>(q, `insert into merchants (display_name, match_key) values ('Warung X','warung x') returning id`)).id;
      const ids: string[] = [];
      for (let i = 0; i < 3; i++)
        ids.push((await one<{ id: string }>(q, `insert into transactions (account_id,direction,amount,occurred_at,kind,merchant_id,status,review_reason,source) values ($1,'out',15000,now(),'expense',$2,'needs_review','merchant_baru','email') returning id`, [acc, m])).id);
      await q(`select rpc_confirm_review($1,$2,null,true)`, [ids[0], food]);
      return (await one<{ n: number }>(q, `select count(*)::int n from transactions where merchant_id=$1 and status='confirmed'`, [m])).n;
    });
    expect(n).toBe(3);
  });

  it("accepted transfer proposal turns both into transfer + Rp 1.000 fee", async () => {
    const m = await account(A, "PropOut");
    const o = await account(A, "PropIn");
    const food = await cat(A, "Makan & minum");
    await asUser(db, A, "aal2", async (q) => {
      const a = (await one<{ id: string }>(q, `insert into transactions (account_id,direction,amount,occurred_at,kind,category_id,status,source) values ($1,'out',101000,now(),'expense',$2,'confirmed','email') returning id`, [m, food])).id;
      const b = (await one<{ id: string }>(q, `insert into transactions (account_id,direction,amount,occurred_at,kind,status,review_reason,source) values ($1,'in',100000,now(),'income','needs_review','transfer_tidak_jelas','email') returning id`, [o])).id;
      const p = (await one<{ id: string }>(q, `insert into match_proposals (type,transaction_id,other_transaction_id,score,fee_amount) values ('transfer',$1,$2,0.8,1000) returning id`, [a, b])).id;
      await q(`select rpc_accept_proposal($1)`, [p]);
      const kinds = (await q<{ kind: string; amount: string }>(`select kind, amount from transactions where account_id in ($1,$2) and deleted_at is null order by amount`, [m, o])).rows;
      expect(kinds.map((k) => [k.kind, Number(k.amount)])).toEqual([["fee", 1000], ["transfer", 100000], ["transfer", 100000]]);
    });
    expect(await balance(A, m)).toBe(1_000_000 - 101_000);
  });
});

describe("F-07.3 redemption + F-10.3 receivables", () => {
  it("deposit redemption: account +50 jt, asset 0 and archived, kind redemption", async () => {
    const acc = await account(A, "RedeemTo", 0);
    await asUser(db, A, "aal2", async (q) => {
      const asset = (await one<{ id: string }>(q, `insert into assets (name,type,quantity,maturity_date,destination_account_id) values ('Deposito A','deposit',1,'2027-02-14',$1) returning id`, [acc])).id;
      await q(`insert into asset_prices (asset_id,as_of,unit_price) values ($1,'2026-11-01',50000000)`, [asset]);
    });
    await expect(
      asUser(db, A, "aal2", (q) => q(`select rpc_redeem_asset(id,60000000,$1,0,'2027-02-14') from assets where name='Deposito A'`, [acc])),
    ).rejects.toThrow(/MELEBIHI_NILAI/);
    await asUser(db, A, "aal2", async (q) => {
      const asset = (await one<{ id: string }>(q, `select id from assets where name='Deposito A'`)).id;
      await q(`select rpc_redeem_asset($1,50000000,$2,0,'2027-02-14')`, [asset, acc]);
      const a = await one<{ quantity: string; archived_at: string | null }>(q, `select quantity, archived_at from assets where id=$1`, [asset]);
      expect(Number(a.quantity)).toBe(0);
      expect(a.archived_at).not.toBeNull();
      expect((await one<{ kind: string }>(q, `select kind from transactions where account_id=$1`, [acc])).kind).toBe("redemption");
    });
    expect(await balance(A, acc)).toBe(50_000_000);
  });

  it("share creates receivables; partial repayment → partially_paid; full → settled", async () => {
    const acc = await account(A, "RepayTo", 0);
    await asUser(db, A, "aal2", async (q) => {
      const r = (await one<{ id: string }>(q, `insert into receipts (status,total,subtotal) values ('confirmed',210000,210000) returning id`)).id;
      const s = (await one<{ id: string }>(q, `insert into split_bills (receipt_id,title,occurred_on,total) values ($1,'Makan','2026-11-14',210000) returning id`, [r])).id;
      await q(`insert into split_participants (split_bill_id,name,is_owner,share_amount,position) values ($1,'Aku',true,105000,1),($1,'Budi',false,105000,2)`, [s]);
      await q(`select rpc_share_split($1)`, [s]);
      const rec = (await one<{ id: string }>(q, `select id from receivables where person_name='Budi'`)).id;
      await q(`select rpc_record_repayment($1,60000,$2,now())`, [rec, acc]);
      expect((await one<{ status: string; remaining: string }>(q, `select status, remaining from receivables where id=$1`, [rec]))).toMatchObject({ status: "partially_paid" });
      await q(`select rpc_record_repayment($1,45000,$2,now())`, [rec, acc]);
      expect((await one<{ status: string }>(q, `select status from split_bills where id=$1`, [s])).status).toBe("settled");
    });
    expect(await balance(A, acc)).toBe(105_000);
  });
});

describe("PH-2 money rules", () => {
  it("a transfer adds only its fee to expense totals and nothing to income", async () => {
    const from = await account(A, "TotFrom");
    const to = await account(A, "TotTo");
    const totals = () =>
      asUser(db, A, "aal2", async (q) =>
        one<{ spend: string; income: string }>(q, `select
          coalesce(sum(amount) filter (where kind in ('expense','fee')), 0) spend,
          coalesce(sum(amount) filter (where kind = 'income'), 0) income
          from transactions where account_id in ($1,$2) and deleted_at is null and status <> 'ignored'`, [from, to]));
    const before = await totals();
    await asUser(db, A, "aal2", (q) => q(`select rpc_create_transfer($1,$2,100000,1000,now(),gen_random_uuid())`, [from, to]));
    const after = await totals();
    expect(Number(after.spend) - Number(before.spend)).toBe(1000);
    expect(Number(after.income)).toBe(Number(before.income));
  });

  it("client_id is unique per user (double submit keeps one row)", async () => {
    const acc = await account(A, "Idem");
    const food = await cat(A, "Makan & minum");
    const cid = "22222222-2222-4222-8222-222222222222";
    const ins = (q: Db["query"]) =>
      q(`insert into transactions (client_id,account_id,direction,amount,occurred_at,kind,category_id,status,source) values ($1,$2,'out',28000,now(),'expense',$3,'confirmed','manual')`, [cid, acc, food]);
    await asUser(db, A, "aal2", ins);
    await expect(asUser(db, A, "aal2", ins)).rejects.toThrow(/duplicate key/);
    expect(await balance(A, acc)).toBe(1_000_000 - 28_000);
  });

  it("archiving keeps transactions and history", async () => {
    const acc = await account(A, "Arsip");
    const food = await cat(A, "Makan & minum");
    await asUser(db, A, "aal2", async (q) => {
      for (let i = 0; i < 10; i++)
        await q(`insert into transactions (account_id,direction,amount,occurred_at,kind,category_id,status,source) values ($1,'out',1000,now(),'expense',$2,'confirmed','manual')`, [acc, food]);
      await q(`update accounts set archived_at = now() where id = $1`, [acc]);
      expect((await one<{ n: number }>(q, `select count(*)::int n from transactions where account_id=$1 and deleted_at is null`, [acc])).n).toBe(10);
    });
  });
});

describe("F-07.1 purchase", () => {
  it("buying Rp 5.000.000 of a fund lowers the account, not spending; funds stay equal", async () => {
    const acc = await account(A, "BeliDari", 10_000_000);
    await asUser(db, A, "aal2", async (q) => {
      const asset = (await one<{ id: string }>(q, `insert into assets (name,type,quantity) values ('RD','money_market_fund',0) returning id`)).id;
      await q(`insert into asset_prices (asset_id,as_of,unit_price) values ($1,'2026-01-01',1000)`, [asset]);
      await q(`select rpc_purchase_asset($1,5000000,5000,$2,'2026-11-14')`, [asset, acc]);
      const v = await one<{ v: string }>(q, `select asset_value($1,'2026-12-31') v`, [asset]);
      expect(Number(v.v)).toBe(5_000_000);
      const k = await one<{ kind: string }>(q, `select kind from transactions where account_id=$1`, [acc]);
      expect(k.kind).toBe("investment");
    });
    expect(await balance(A, acc)).toBe(5_000_000);
  });
});

describe("F-10.3 repayment proposal", () => {
  it("accepting settles Budi's Rp 105.000 and the money is not income", async () => {
    const acc = await account(A, "BNI-repay", 0);
    await asUser(db, A, "aal2", async (q) => {
      const r = (await one<{ id: string }>(q, `insert into receipts (status,total,subtotal) values ('confirmed',210000,210000) returning id`)).id;
      const s = (await one<{ id: string }>(q, `insert into split_bills (receipt_id,title,occurred_on,total) values ($1,'Makan','2026-11-14',210000) returning id`, [r])).id;
      await q(`insert into split_participants (split_bill_id,name,is_owner,share_amount,position) values ($1,'Aku',true,105000,1),($1,'Budi',false,105000,2)`, [s]);
      await q(`select rpc_share_split($1)`, [s]);
      const rec = (await one<{ id: string }>(q, `select r.id from receivables r join split_participants p on p.id = r.split_participant_id where p.split_bill_id = $1`, [s])).id;
      const tx = (await one<{ id: string }>(q, `insert into transactions (account_id,direction,amount,occurred_at,kind,status,review_reason,source,merchant_raw) values ($1,'in',105000,now(),'income','needs_review','transfer_tidak_jelas','email','BUDI') returning id`, [acc])).id;
      const p = (await one<{ id: string }>(q, `insert into match_proposals (type,transaction_id,receivable_id,score) values ('repayment',$1,$2,0.9) returning id`, [tx, rec])).id;
      await q(`select rpc_accept_proposal($1)`, [p]);
      expect((await one<{ status: string }>(q, `select status from receivables where id=$1`, [rec])).status).toBe("settled");
      expect((await one<{ kind: string }>(q, `select kind from transactions where id=$1`, [tx])).kind).toBe("repayment");
      expect((await one<{ n: number }>(q, `select count(*)::int n from transactions where account_id=$1 and kind='income'`, [acc])).n).toBe(0);
    });
    expect(await balance(A, acc)).toBe(105_000);
  });
});

describe("F-08.4 labels", () => {
  it("names are unique per owner (case-insensitive); another account cannot see or attach to them", async () => {
    const acc = await account(A, "Label bank");
    const [label, tx] = await asUser(db, A, "aal2", async (q) => [
      (await one<{ id: string }>(q, `insert into labels (name, auto_one_off, target_amount) values ('Umroh 2026', true, 35000000) returning id`)).id,
      (await one<{ id: string }>(q, `insert into transactions (account_id, direction, amount, occurred_at, kind, status, review_reason, source, merchant_raw)
        values ($1, 'out', 12500000, '2026-10-13T03:00:00Z', 'expense', 'needs_review', 'nominal_besar', 'email', 'SITI NUR AISYAH') returning id`, [acc])).id,
    ]);
    await expect(asUser(db, A, "aal2", (q) => q(`insert into labels (name) values ('umroh 2026')`))).rejects.toThrow(/labels_name_uq/);
    await asUser(db, A, "aal2", (q) => q(`insert into transaction_labels (transaction_id, label_id) values ($1, $2)`, [tx, label]));
    expect(await asUser(db, B, "aal2", async (q) => (await q(`select * from labels`)).rows.length + (await q(`select * from transaction_labels`)).rows.length)).toBe(0);
    const own = await asUser(db, B, "aal2", async (q) => (await one<{ id: string }>(q, `insert into labels (name) values ('Punya B') returning id`)).id);
    await expect(asUser(db, B, "aal2", (q) => q(`insert into transaction_labels (transaction_id, label_id) values ($1, $2)`, [tx, own]))).rejects.toThrow(/row-level security/);
    await expect(asUser(db, B, "aal2", (q) => q(`insert into transaction_labels (transaction_id, label_id) values ($1, $2)`, [tx, label]))).rejects.toThrow(/row-level security/);
  });
});

describe("F-03.3 top-up into transfer", () => {
  it("an outgoing top-up becomes a linked transfer: wallet +amount, no longer spending; a second conversion is refused", async () => {
    const bank = await account(A, "Bank konversi", 1_000_000);
    const wallet = await account(A, "Dompet uji", 0);
    const tx = await asUser(db, A, "aal2", async (q) =>
      (await one<{ id: string }>(q, `insert into transactions (account_id, direction, amount, occurred_at, kind, status, review_reason, source, merchant_raw)
        values ($1, 'out', 50000, '2026-05-01T03:00:00Z', 'expense', 'needs_review', 'transfer_tidak_jelas', 'email', 'OVO') returning id`, [bank])).id);
    await asUser(db, A, "aal2", (q) => q(`select rpc_convert_to_transfer($1, $2)`, [tx, wallet]));
    expect(await balance(A, bank)).toBe(950_000);
    expect(await balance(A, wallet)).toBe(50_000);
    const kinds = await asUser(db, A, "aal2", async (q) => (await q<{ kind: string; status: string }>(`select t.kind, t.status from transactions t join transfer_links l on t.id in (l.out_transaction_id, l.in_transaction_id) where l.out_transaction_id = $1`, [tx])).rows);
    expect(kinds).toEqual([{ kind: "transfer", status: "confirmed" }, { kind: "transfer", status: "confirmed" }]);
    await expect(asUser(db, A, "aal2", (q) => q(`select rpc_convert_to_transfer($1, $2)`, [tx, wallet]))).rejects.toThrow(/BUKAN_PENGELUARAN|SUDAH_TERTAUT/);
  });
});
