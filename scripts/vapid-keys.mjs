// Prints a fresh VAPID key pair for .env.local (F-12.3). Keys are never written to disk by this script.
const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const jwk = await crypto.subtle.exportKey("jwk", kp.privateKey);
const raw = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey));
const b64u = (b) => Buffer.from(b).toString("base64url");
console.log(`NEXT_PUBLIC_VAPID_PUBLIC_KEY=${b64u(raw)}\nVAPID_PRIVATE_KEY=${jwk.d}`);
