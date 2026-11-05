// Gmail API (gmail.readonly) over fetch. `fetchFn` is injectable so tests use a fake mailbox.
import { htmlToText } from "../core/parsers";

export interface Mail {
  id: string;
  internalDateMs: number;
  from: string; // bare lowercase address
  subject: string;
  text: string;
  dateIso: string;
}

export type GmailError = "rate" | "server" | "invalid_grant" | "network";

export class GmailFailure extends Error {
  constructor(public kind: GmailError, public status?: number) {
    super(`gmail ${kind}${status ? ` ${status}` : ""}`);
  }
}

type Fetch = typeof fetch;
const API = "https://gmail.googleapis.com/gmail/v1/users/me";

export async function refreshAccessToken(fetchFn: Fetch, clientId: string, clientSecret: string, refreshToken: string): Promise<string> {
  let res: Response;
  try {
    res = await fetchFn("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken }),
    });
  } catch {
    throw new GmailFailure("network");
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new GmailFailure(body?.error === "invalid_grant" ? "invalid_grant" : res.status === 429 ? "rate" : "server", res.status);
  return body.access_token as string;
}

async function call<T>(fetchFn: Fetch, token: string, path: string): Promise<T> {
  let res: Response;
  try {
    res = await fetchFn(`${API}${path}`, { headers: { authorization: `Bearer ${token}` } });
  } catch {
    throw new GmailFailure("network");
  }
  if (res.status === 429) throw new GmailFailure("rate", 429);
  if (res.status === 401) throw new GmailFailure("invalid_grant", 401);
  // Gmail reports per-user quota as 403 rateLimitExceeded / userRateLimitExceeded
  if (res.status === 403 && /ratelimit/i.test(await res.clone().text().catch(() => ""))) throw new GmailFailure("rate", 403);
  if (!res.ok) throw new GmailFailure("server", res.status);
  return (await res.json()) as T;
}

/** All message ids for a query (newest first, as Gmail returns them), 50 per page, capped. */
export async function listIds(fetchFn: Fetch, token: string, query: string, cap = 2000): Promise<string[]> {
  const ids: string[] = [];
  let page: string | undefined;
  do {
    const p = new URLSearchParams({ q: query, maxResults: "50" });
    if (page) p.set("pageToken", page);
    const r = await call<{ messages?: { id: string }[]; nextPageToken?: string }>(fetchFn, token, `/messages?${p}`);
    for (const m of r.messages ?? []) ids.push(m.id);
    page = r.nextPageToken;
  } while (page && ids.length < cap);
  return ids.slice(0, cap);
}

interface Part {
  mimeType?: string;
  body?: { data?: string };
  parts?: Part[];
  headers?: { name: string; value: string }[];
}

const b64 = (s: string) => {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
};

function bodyText(p: Part): { plain: string; html: string } {
  let plain = "";
  let html = "";
  const walk = (x: Part) => {
    if (x.mimeType === "text/plain" && x.body?.data) plain += b64(x.body.data);
    else if (x.mimeType === "text/html" && x.body?.data) html += b64(x.body.data);
    x.parts?.forEach(walk);
  };
  walk(p);
  return { plain, html };
}

export const bareAddress = (from: string) => (from.match(/<([^>]+)>/)?.[1] ?? from).trim().toLowerCase();

export async function getMail(fetchFn: Fetch, token: string, id: string): Promise<Mail> {
  const m = await call<{ id: string; internalDate: string; payload: Part }>(fetchFn, token, `/messages/${id}?format=full`);
  const h = (n: string) => m.payload.headers?.find((x) => x.name.toLowerCase() === n)?.value ?? "";
  const { plain, html } = bodyText(m.payload);
  const internal = Number(m.internalDate);
  return {
    id: m.id,
    internalDateMs: internal,
    from: bareAddress(h("from")),
    subject: h("subject").slice(0, 200),
    text: plain.trim() ? plain : htmlToText(html),
    dateIso: new Date(internal).toISOString(),
  };
}

export async function getProfileEmail(fetchFn: Fetch, token: string): Promise<string> {
  const r = await call<{ emailAddress: string }>(fetchFn, token, "/profile");
  return r.emailAddress;
}
