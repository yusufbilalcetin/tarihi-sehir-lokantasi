import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Print agent credentials, modelled on the QR token scheme.
 *
 * The raw token is shown once, when it is created or rotated, and never again:
 * only an HMAC digest reaches the database, so a database dump does not hand
 * anybody a working agent. The digest carries its version, which is what makes
 * rotation a real revocation rather than a rename.
 *
 * The pepper is its own secret. Reusing the outbox, maintenance or session
 * secret here would mean one leak authorises several unrelated capabilities.
 */

const TOKEN_BYTES = 32;
const DOMAIN = "sehir:printer-agent:v1";

export interface GeneratedAgentToken {
  /** Returned to the operator exactly once. Never logged, never persisted. */
  readonly rawToken: string;
  readonly tokenHash: string;
  readonly tokenVersion: number;
}

export function isAgentTokenShape(value: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(value);
}

export function hashAgentToken(
  rawToken: string,
  pepper: string,
  version: number,
): string {
  if (!Number.isInteger(version) || version < 1) {
    throw new TypeError("Agent token version must be a positive integer.");
  }
  const digest = createHmac("sha256", pepper)
    .update(`${DOMAIN}:${version}:${rawToken}`, "utf8")
    .digest("base64url");
  return `v${version}.${digest}`;
}

export function generateAgentToken(
  pepper: string,
  version = 1,
): GeneratedAgentToken {
  const rawToken = randomBytes(TOKEN_BYTES).toString("base64url");
  return { rawToken, tokenHash: hashAgentToken(rawToken, pepper, version), tokenVersion: version };
}

/**
 * Constant-time comparison against the stored digest. A malformed token, an
 * unknown token and a revoked token are all answered the same way by callers,
 * so nothing here leaks which agents exist.
 */
export function verifyAgentToken(
  rawToken: string,
  storedHash: string,
  pepper: string,
): boolean {
  if (!isAgentTokenShape(rawToken)) return false;
  const version = Number(/^v(\d+)\./.exec(storedHash)?.[1] ?? "0");
  if (!Number.isInteger(version) || version < 1) return false;

  const candidate = Buffer.from(hashAgentToken(rawToken, pepper, version), "utf8");
  const expected = Buffer.from(storedHash, "utf8");
  if (candidate.length !== expected.length) return false;
  return timingSafeEqual(candidate, expected);
}

/** Bearer header parsing kept separate from verification, for clean failures. */
export function readBearerToken(authorizationHeader: string | null): string | null {
  if (!authorizationHeader?.startsWith("Bearer ")) return null;
  const candidate = authorizationHeader.slice("Bearer ".length).trim();
  return isAgentTokenShape(candidate) ? candidate : null;
}
