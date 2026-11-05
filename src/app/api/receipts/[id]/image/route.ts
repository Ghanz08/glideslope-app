import { NextResponse } from "next/server";
import { ownerOrError } from "@/lib/server/owner";
import { errorResponse } from "@/lib/server/errors";

// API-32: private bucket; the owner gets a signed link valid for 60 seconds.
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const o = await ownerOrError();
  if (!o.ok) return NextResponse.json(o.error, { status: o.status });
  const { id } = await params;
  const { data } = await o.supabase.from("receipts").select("image_path").eq("id", id).maybeSingle();
  if (!data?.image_path) return errorResponse(404, "TIDAK_DITEMUKAN", "Gambar nota tidak ditemukan.");
  const signed = await o.supabase.storage.from("receipts").createSignedUrl(data.image_path, 60);
  if (signed.error || !signed.data) return errorResponse(404, "TIDAK_DITEMUKAN", "Gambar nota tidak ditemukan.");
  return NextResponse.redirect(signed.data.signedUrl, 302);
}
