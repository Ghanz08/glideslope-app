// F-13.1 archive: one JSON per section-5 table + transactions.csv. Secrets never leave the database.
import { csvCell, zip } from "./zip";

export const EXPORT_TABLES = [
  "app_settings", "accounts", "account_checkpoints", "categories", "merchants", "merchant_aliases", "transactions", "transfer_links",
  "match_proposals", "transaction_evidence", "ingest_events", "email_sources", "integrations", "llm_jobs", "receipts", "receipt_items",
  "split_bills", "split_participants", "split_assignments", "receivables", "receivable_payments", "assets", "asset_prices", "asset_events",
  "planned_expenses", "subscriptions", "push_subscriptions", "labels", "transaction_labels",
] as const;

const SECRET_COLUMNS = new Set(["pin_hash", "pin_salt", "pin_iterations", "pin_failed_attempts", "vault_secret_id", "p256dh", "auth"]);
const CSV_COLUMNS = ["id", "occurred_at", "kind", "direction", "amount", "account", "category", "merchant_raw", "note", "status", "source", "is_one_off"];

type Row = Record<string, unknown>;

export function buildExport(tables: Partial<Record<(typeof EXPORT_TABLES)[number], Row[]>>, slug: string, date: string) {
  const enc = new TextEncoder();
  const clean = (rows: Row[]) => rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !SECRET_COLUMNS.has(k))));
  const files = EXPORT_TABLES.map((t) => ({ name: `${t}.json`, data: enc.encode(JSON.stringify(clean(tables[t] ?? []), null, 1)) }));
  const accounts = new Map((tables.accounts ?? []).map((a) => [a.id, a.name]));
  const categories = new Map((tables.categories ?? []).map((c) => [c.id, c.name]));
  const tx = (tables.transactions ?? []).filter((t) => !t.deleted_at);
  const csv = [CSV_COLUMNS.join(","), ...tx.map((t) => CSV_COLUMNS.map((c) => csvCell(c === "account" ? accounts.get(t.account_id) : c === "category" ? categories.get(t.category_id) : t[c])).join(","))].join("\n");
  files.push({ name: "transactions.csv", data: enc.encode(csv + "\n") });
  return { filename: `${slug}-export-${date.replace(/-/g, "")}.zip`, bytes: zip(files) };
}
