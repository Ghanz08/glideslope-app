import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { randomBytes } from "node:crypto";
import { ownerOrError } from "@/lib/server/owner";
import { errorResponse } from "@/lib/server/errors";
import { gmailConsentUrl } from "@/lib/server/google";

export async function GET() {
  const o = await ownerOrError();
  if (!o.ok) return NextResponse.json(o.error, { status: o.status });
  const id = process.env.GOOGLE_CLIENT_ID;
  const redirect = process.env.GOOGLE_REDIRECT_URI;
  if (!id || !redirect || !process.env.GOOGLE_CLIENT_SECRET) return errorResponse(500, "OAUTH_KOSONG", "Kredensial Google belum diisi di variabel lingkungan.");
  const state = randomBytes(24).toString("base64url");
  (await cookies()).set("gs_oauth_state", state, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge: 600, path: "/api/gmail" });
  return NextResponse.redirect(gmailConsentUrl(id, redirect, state), 302);
}
