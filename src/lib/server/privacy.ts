import "server-only";
import { cookies } from "next/headers";
import { PRIVACY_COOKIE } from "@/lib/privacy-cookie";

/** Whether the owner chose to hide balances and account numbers (privacy toggle). */
export async function privacyOn(): Promise<boolean> {
  return (await cookies()).get(PRIVACY_COOKIE)?.value === "on";
}
