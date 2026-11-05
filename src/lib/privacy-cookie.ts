// Shared by the server (reads it) and the eye toggle (writes it); kept out of "use client" modules on purpose,
// because a server import from a client module yields a client reference, not the string.
export const PRIVACY_COOKIE = "privasi";
