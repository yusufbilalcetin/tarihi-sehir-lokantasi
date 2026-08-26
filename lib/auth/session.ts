// Edge-safe session helpers. Keep this file free of `next/headers` and other
// Node-only imports so `proxy.ts` can import it.

export type StaffRole = "staff" | "admin";

export const SESSION_COOKIE = "sehir_session";
export const SESSION_TTL_SECONDS = 12 * 60 * 60; // one shift

const ROLES: readonly string[] = ["staff", "admin"];
const encoder = new TextEncoder();

function getSessionSecret(): string {
  const secret = process.env.STAFF_SESSION_SECRET?.trim();
  if (!secret || secret.length < 32) {
    throw new Error(
      "[Auth] STAFF_SESSION_SECRET is missing or shorter than 32 characters. Add it to .env.local or your deployment environment.",
    );
  }
  return secret;
}

function getSigningKey(usage: "sign" | "verify") {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(getSessionSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    [usage],
  );
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> | null {
  try {
    const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch {
    return null;
  }
}

/** `<role>.<expiresAt>.<hmac>` — stateless, so no session store is needed. */
export async function createSessionToken(
  role: StaffRole,
  now: number = Date.now(),
): Promise<string> {
  const payload = `${role}.${now + SESSION_TTL_SECONDS * 1_000}`;
  const signature = await crypto.subtle.sign(
    "HMAC",
    await getSigningKey("sign"),
    encoder.encode(payload),
  );
  return `${payload}.${toBase64Url(new Uint8Array(signature))}`;
}

/** Returns the role only for an unexpired token with a valid signature. */
export async function readSessionRole(
  token: string | undefined | null,
  now: number = Date.now(),
): Promise<StaffRole | null> {
  if (!token) return null;

  const [role, expiresAt, signature, ...rest] = token.split(".");
  if (rest.length > 0 || !signature || !ROLES.includes(role)) return null;

  const expiry = Number(expiresAt);
  if (!Number.isFinite(expiry) || expiry <= now) return null;

  const signatureBytes = fromBase64Url(signature);
  if (!signatureBytes) return null;

  const valid = await crypto.subtle.verify(
    "HMAC",
    await getSigningKey("verify"),
    signatureBytes,
    encoder.encode(`${role}.${expiresAt}`),
  );

  return valid ? (role as StaffRole) : null;
}
