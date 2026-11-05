import { NextResponse, type NextRequest } from "next/server";
import { ownerOrError } from "@/lib/server/owner";
import { getInboxItems } from "@/lib/server/inbox";

// API-19: open items (grouped per new merchant) and counts per reason
export async function GET(req: NextRequest) {
  const o = await ownerOrError();
  if (!o.ok) return NextResponse.json(o.error, { status: o.status });
  const reason = req.nextUrl.searchParams.get("reason");
  const limit = Math.min(Number(req.nextUrl.searchParams.get("limit") ?? 20) || 20, 100);
  const cursor = Number(req.nextUrl.searchParams.get("cursor") ?? 0) || 0;
  const all = await getInboxItems(o.supabase);
  const filtered = reason ? all.filter((i) => i.tx.review_reason === reason) : all;
  const counts: Record<string, number> = {};
  for (const i of all) counts[i.tx.review_reason ?? "usulan"] = (counts[i.tx.review_reason ?? "usulan"] ?? 0) + 1;
  const page = filtered.slice(cursor, cursor + limit);
  return NextResponse.json({
    groups: page.filter((i) => i.groupCount > 1).map((i) => ({ merchant_id: i.tx.merchant_id, count: i.groupCount, transaction_ids: i.groupIds })),
    items: page,
    counts,
    next_cursor: cursor + limit < filtered.length ? String(cursor + limit) : null,
  });
}
