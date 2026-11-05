import { NextResponse, type NextRequest } from "next/server";
import { ownerOrError } from "@/lib/server/owner";
import { errorResponse } from "@/lib/server/errors";
import { queryTransactions } from "@/lib/server/tx-query";

// API-10
export async function GET(req: NextRequest) {
  const o = await ownerOrError();
  if (!o.ok) return NextResponse.json(o.error, { status: o.status });
  const p = req.nextUrl.searchParams;
  const limit = p.get("limit");
  if (limit && !/^\d+$/.test(limit)) return errorResponse(400, "PARAMETER_SALAH", "Parameter limit tidak valid.");
  const r = await queryTransactions(o.supabase, {
    jenis: p.get("kind") ?? p.get("jenis") ?? undefined,
    kategori: p.get("category") ?? undefined,
    akun: p.get("account") ?? undefined,
    dari: p.get("from") ?? undefined,
    sampai: p.get("to") ?? undefined,
    bulan: p.get("bulan") ?? undefined,
    status: p.get("status") ?? undefined,
    label: p.get("label") ?? undefined,
    q: p.get("q") ?? undefined,
    cursor: p.get("cursor") ?? undefined,
    limit: limit ? Number(limit) : 30,
  });
  if (!r) return errorResponse(400, "PARAMETER_SALAH", "Parameter tidak valid.");
  return NextResponse.json(r);
}
