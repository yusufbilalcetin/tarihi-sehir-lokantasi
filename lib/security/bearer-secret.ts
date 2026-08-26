import { createHash, timingSafeEqual } from "node:crypto";

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

/**
 * Constant-time bearer check for server-to-server endpoints.
 *
 * Each protected endpoint passes its *own* secret. Secrets are never shared
 * between purposes: an outbox scheduler credential must not also authorise data
 * deletion, so a leak of one cannot be replayed against the other.
 */
export function isAuthorizedBearerSecret(
  authorizationHeader: string | null,
  expectedSecret: string,
): boolean {
  if (!authorizationHeader?.startsWith("Bearer ") || expectedSecret.length < 32) {
    return false;
  }
  const candidate = authorizationHeader.slice("Bearer ".length);
  return candidate.length >= 32 && timingSafeEqual(digest(candidate), digest(expectedSecret));
}
