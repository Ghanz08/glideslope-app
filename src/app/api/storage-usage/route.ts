import { NextResponse } from "next/server";
import { ownerOrError } from "@/lib/server/owner";

const LIMITS = { db_mb: 500, storage_mb: 1024 };

export async function GET() {
  const o = await ownerOrError();
  if (!o.ok) return NextResponse.json(o.error, { status: o.status });
  const { data, error } = await o.supabase.rpc("rpc_storage_usage");
  const row = (data as { db_bytes: number; storage_bytes: number }[] | null)?.[0];
  if (error || !row) return NextResponse.json({ available: false });
  return NextResponse.json({ available: true, db_mb: Number(row.db_bytes) / 1048576, storage_mb: Number(row.storage_bytes) / 1048576, limits: LIMITS });
}
