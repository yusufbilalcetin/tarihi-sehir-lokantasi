import type { JsonValue } from "./models";

export const IDEMPOTENCY_RECORD_STATUSES = ["PROCESSING", "COMPLETED", "FAILED"] as const;
export type IdempotencyRecordStatus = (typeof IDEMPOTENCY_RECORD_STATUSES)[number];

export interface IdempotencyIdentity {
  readonly restaurantId: string;
  /** User id for staff, or a table/session identity for anonymous QR customers. */
  readonly actorId: string;
  readonly operation: string;
  readonly key: string;
}

interface IdempotencyRecordBase {
  readonly identity: IdempotencyIdentity;
  readonly requestFingerprint: string;
  readonly createdAtEpochMs: number;
  readonly expiresAtEpochMs: number;
}

export type IdempotencyRecord<TResponse> =
  | (IdempotencyRecordBase & {
      readonly status: "PROCESSING";
    })
  | (IdempotencyRecordBase & {
      readonly status: "COMPLETED";
      readonly response: TResponse;
    })
  | (IdempotencyRecordBase & {
      readonly status: "FAILED";
      readonly failureCode: string;
    });

export type IdempotencyDecision<TResponse> =
  | { readonly action: "EXECUTE" }
  | { readonly action: "REPLAY"; readonly response: TResponse }
  | { readonly action: "IN_FLIGHT"; readonly retryAfterMs: number }
  | { readonly action: "CONFLICT" };

export function createIdempotencyScopeKey(identity: IdempotencyIdentity): string {
  return JSON.stringify([
    identity.restaurantId,
    identity.actorId,
    identity.operation,
    identity.key,
  ]);
}

/**
 * Deterministic JSON representation used as request equality material. Storage
 * adapters may hash this value before persistence to avoid storing request data.
 */
export function createIdempotencyFingerprint(value: unknown): string {
  const ancestors = new Set<object>();

  function serialize(input: unknown): string {
    if (input === null) return "null";
    if (typeof input === "string" || typeof input === "boolean") return JSON.stringify(input);
    if (typeof input === "number") {
      if (!Number.isFinite(input)) throw new TypeError("Idempotency payload numbers must be finite.");
      return JSON.stringify(Object.is(input, -0) ? 0 : input);
    }
    if (Array.isArray(input)) {
      if (ancestors.has(input)) throw new TypeError("Idempotency payload must not be circular.");
      ancestors.add(input);
      const result = `[${input.map((item) => serialize(item)).join(",")}]`;
      ancestors.delete(input);
      return result;
    }
    if (typeof input === "object") {
      const object = input as Record<string, unknown>;
      const prototype = Object.getPrototypeOf(object) as object | null;
      if (prototype !== Object.prototype && prototype !== null) {
        throw new TypeError("Idempotency payload must contain only plain JSON objects.");
      }
      if (ancestors.has(object)) throw new TypeError("Idempotency payload must not be circular.");
      ancestors.add(object);
      const entries = Object.keys(object)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${serialize(object[key])}`);
      ancestors.delete(object);
      return `{${entries.join(",")}}`;
    }

    throw new TypeError("Idempotency payload must be JSON-serializable.");
  }

  return serialize(value);
}

export function decideIdempotency<TResponse>(
  existing: IdempotencyRecord<TResponse> | null,
  requestFingerprint: string,
  nowEpochMs: number,
): IdempotencyDecision<TResponse> {
  if (!Number.isSafeInteger(nowEpochMs) || nowEpochMs < 0) {
    throw new TypeError("Idempotency clock must be a non-negative epoch millisecond value.");
  }
  if (!existing || existing.expiresAtEpochMs <= nowEpochMs) {
    return { action: "EXECUTE" };
  }
  if (existing.requestFingerprint !== requestFingerprint) {
    return { action: "CONFLICT" };
  }
  if (existing.status === "FAILED") {
    return { action: "EXECUTE" };
  }
  if (existing.status === "COMPLETED") {
    return { action: "REPLAY", response: existing.response };
  }

  return {
    action: "IN_FLIGHT",
    retryAfterMs: Math.max(0, existing.expiresAtEpochMs - nowEpochMs),
  };
}

export type IdempotencyReservationResult<TResponse> =
  | { readonly acquired: true; readonly record: IdempotencyRecord<TResponse> }
  | { readonly acquired: false; readonly existing: IdempotencyRecord<TResponse> };

/** Implementations must make `reserve` atomic for a scope key. */
export interface IdempotencyStore<TResponse> {
  find(scopeKey: string): Promise<IdempotencyRecord<TResponse> | null>;
  reserve(
    scopeKey: string,
    record: IdempotencyRecord<TResponse>,
  ): Promise<IdempotencyReservationResult<TResponse>>;
  complete(scopeKey: string, response: TResponse): Promise<void>;
  fail(scopeKey: string, failureCode: string): Promise<void>;
}

/** Compile-time contract helper for JSON-storable responses. */
export type JsonIdempotencyStore = IdempotencyStore<JsonValue>;
