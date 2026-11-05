import { NextResponse } from "next/server";

// Fallback when the service worker is not active yet: the image cannot be kept, so ask to pick it again.
export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  const file = form?.get("image");
  if (file instanceof File && !file.type.startsWith("image/")) return new NextResponse("Format bukan gambar.", { status: 415 });
  return NextResponse.redirect(new URL("/nota/baru?shared=0", req.url), 303);
}
