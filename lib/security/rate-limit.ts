import { createHmac } from "node:crypto";

export const RATE_LIMIT_ACTIONS = [
  "STAFF_LOGIN",
  "QR_VALIDATE",
  "ORDER_CREATE",
  "WAITER_CALL",
  "BILL_REQUEST",
  "PRINTER_AGENT",
  "STAFF_PASSWORD_RESET",
] as const;

export type RateLimitAction = (typeof RATE_LIMIT_ACTIONS)[number];
export const RATE_LIMIT_ACTOR_TYPES = ["CLIENT_IP", "AUTH_USER", "TABLE_SESSION"] as const;
export type RateLimitActorType = (typeof RATE_LIMIT_ACTOR_TYPES)[number];

export interface RateLimitPolicy {
  readonly limit: number;
  readonly windowMs: number;
}

export const RATE_LIMIT_POLICIES = {
  STAFF_LOGIN: { limit: 5, windowMs: 15 * 60_000 },
  QR_VALIDATE: { limit: 30, windowMs: 60_000 },
  ORDER_CREATE: { limit: 5, windowMs: 60_000 },
  WAITER_CALL: { limit: 1, windowMs: 30_000 },
  BILL_REQUEST: { limit: 1, windowMs: 2 * 60_000 },
  // Deliberately generous: every print agent in one restaurant shares that
  // restaurant's public address, and a busy service polls for work every few
  // seconds. This is a ceiling on unauthenticated hammering, not a throttle on
  // legitimate printing.
  PRINTER_AGENT: { limit: 300, windowMs: 60_000 },
  // Per target staff member: an administrator may re-send a setup link a few
  // times, but cannot use the button to mail-bomb a colleague.
  STAFF_PASSWORD_RESET: { limit: 3, windowMs: 15 * 60_000 },
} as const satisfies Record<RateLimitAction, RateLimitPolicy>;

export interface RateLimitIdentity {
  readonly action: RateLimitAction;
  /** Omit only before a restaurant is known, such as initial staff login. */
  readonly restaurantId?: string;
  readonly actorType: RateLimitActorType;
  /** Raw actor identifiers are HMACed and never included in the store key. */
  readonly actorId: string;
  /** Privacy-preserving upstream fingerprint, not a raw header/cookie. */
  readonly clientFingerprint?: string;
}

export interface RateLimitStoreConsumeInput {
  readonly key: string;
  readonly limit: number;
  readonly windowMs: number;
  readonly nowEpochMs: number;
}

export interface RateLimitStoreConsumeResult {
  readonly allowed: boolean;
  readonly remaining: number;
  readonly resetAtEpochMs: number;
}

/**
 * Production adapters must implement `consume` atomically in a shared store
 * (Redis/database). There is deliberately no process-local memory adapter:
 * serverless replicas would produce inconsistent and bypassable limits.
 */
export interface SharedRateLimitStore {
  consume(input: RateLimitStoreConsumeInput): Promise<RateLimitStoreConsumeResult>;
}

export interface RateLimitDecision extends RateLimitStoreConsumeResult {
  readonly action: RateLimitAction;
  readonly retryAfterSeconds: number;
}

const IDENTITY_VALUE = /^[^\u0000-\u001f\u007f]{1,256}$/;

function validateIdentityValue(value: string | undefined, label: string): string {
  if (!value || !IDENTITY_VALUE.test(value)) {
    throw new TypeError(`${label} must contain 1-256 printable characters.`);
  }
  return value;
}

function keySecretBytes(secret: string | Uint8Array): Uint8Array {
  const bytes = typeof secret === "string" ? new TextEncoder().encode(secret) : secret;
  if (bytes.byteLength < 32) throw new Error("Rate-limit key secret must be at least 32 bytes.");
  return bytes;
}

export function createRateLimitKey(
  identity: RateLimitIdentity,
  keySecret: string | Uint8Array,
): string {
  if (!(RATE_LIMIT_ACTIONS as readonly string[]).includes(identity.action)) {
    throw new TypeError("Rate-limit action is not supported.");
  }
  if (!(RATE_LIMIT_ACTOR_TYPES as readonly string[]).includes(identity.actorType)) {
    throw new TypeError("Rate-limit actor type is not supported.");
  }
  const restaurantId = identity.restaurantId === undefined
    ? "global"
    : validateIdentityValue(identity.restaurantId, "Restaurant ID");
  const actorId = validateIdentityValue(identity.actorId, "Actor ID");
  const clientFingerprint = identity.clientFingerprint === undefined
    ? "none"
    : validateIdentityValue(identity.clientFingerprint, "Client fingerprint");
  const canonicalIdentity = JSON.stringify([
    "v1",
    identity.action,
    restaurantId,
    identity.actorType,
    actorId,
    clientFingerprint,
  ]);
  const digest = createHmac("sha256", keySecretBytes(keySecret))
    .update("tarihi-sehir-lokantasi:rate-limit:v1\0", "utf8")
    .update(canonicalIdentity, "utf8")
    .digest("base64url");
  return `rate-limit:v1:${identity.action.toLowerCase()}:${digest}`;
}

function assertStoreResult(
  result: RateLimitStoreConsumeResult,
  input: RateLimitStoreConsumeInput,
): void {
  if (
    typeof result.allowed !== "boolean" ||
    !Number.isSafeInteger(result.remaining) ||
    result.remaining < 0 ||
    result.remaining > input.limit ||
    !Number.isSafeInteger(result.resetAtEpochMs) ||
    result.resetAtEpochMs < input.nowEpochMs
  ) {
    throw new Error("Shared rate-limit store returned an invalid result.");
  }
}

export async function consumeRateLimit(
  store: SharedRateLimitStore,
  identity: RateLimitIdentity,
  keySecret: string | Uint8Array,
  nowEpochMs: number = Date.now(),
): Promise<RateLimitDecision> {
  if (!Number.isSafeInteger(nowEpochMs) || nowEpochMs < 0) {
    throw new TypeError("Rate-limit time must be a non-negative epoch millisecond integer.");
  }
  const policy = RATE_LIMIT_POLICIES[identity.action];
  const input: RateLimitStoreConsumeInput = {
    key: createRateLimitKey(identity, keySecret),
    limit: policy.limit,
    windowMs: policy.windowMs,
    nowEpochMs,
  };
  const result = await store.consume(input);
  assertStoreResult(result, input);

  return {
    ...result,
    action: identity.action,
    retryAfterSeconds: result.allowed
      ? 0
      : Math.max(1, Math.ceil((result.resetAtEpochMs - nowEpochMs) / 1_000)),
  };
}
