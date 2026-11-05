export const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

/** API-12: exactly one scope, offline access, forced consent, random state. */
export function gmailConsentUrl(clientId: string, redirectUri: string, state: string): string {
  const p = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GMAIL_SCOPE,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "false",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}
