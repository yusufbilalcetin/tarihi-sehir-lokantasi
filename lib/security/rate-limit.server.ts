import "server-only";

import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";

import { getDb } from "@/db";
import { DomainError } from "@/lib/api/domain-error";
import { getServerEnvironment } from "@/lib/env/server";
import {
  RATE_LIMIT_POLICIES,
  createRateLimitKey,
  type RateLimitAction,
  type RateLimitActorType,
  type RateLimitIdentity,
} from "@/lib/security/rate-limit";
import { consumeFixedWindow } from "@/lib/security/rate-limit-window";

interface RateLimitScope {
  readonly restaurantId?: string;
  readonly tableId?: string;
  readonly identifier?: string;
  /** Defaults to the identifier's shape; name it when the actor is a signed-in user. */
  readonly actorType?: RateLimitActorType;
}

const DEVELOPMENT_LIMITS = new Map<string, { count: number; resetAt: number }>();

function clientAddress(request: Request): string {
  return (
    request.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    "unknown"
  );
}

function privacyFingerprint(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex").slice(0, 32);
}

function keySecret(): string {
  const environment = getServerEnvironment();
  const configured = environment.rateLimitKeySecret ?? environment.authSecret;
  if (configured) return configured;
  if (process.env.NODE_ENV === "production") {
    throw new Error("[Rate limit] RATE_LIMIT_KEY_SECRET is required in production.");
  }
  // Development-only deterministic key. It is not accepted in production and
  // carries no user secret into logs/storage.
  return "development-rate-limit-key-not-for-production";
}

function identityFor(
  request: Request,
  action: RateLimitAction,
  scope: RateLimitScope,
): RateLimitIdentity {
  const ip = clientAddress(request);
  const actorId = scope.tableId ?? scope.identifier ?? ip;
  return {
    action,
    restaurantId: scope.restaurantId,
    actorType: scope.actorType ?? (scope.tableId ? "TABLE_SESSION" : "CLIENT_IP"),
    actorId,
    clientFingerprint: privacyFingerprint(ip),
  };
}

async function consumeDatabaseWindow(
  key: string,
  limit: number,
  windowMs: number,
  now: number,
): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  // PostgreSQL advisory locks make the count/check/insert operation atomic
  // across Vercel instances without adding a Redis dependency in this phase.
  const rows = await getDb().execute(sql<{
    request_count: number;
    reset_at_ms: number;
    accepted: boolean;
  }>`
    WITH expired_rows AS (
      SELECT id
      FROM public.api_rate_limits
      WHERE expires_at <= now()
      ORDER BY expires_at
      LIMIT 100
      FOR UPDATE SKIP LOCKED
    ), deleted_rows AS (
      DELETE FROM public.api_rate_limits AS stale
      USING expired_rows
      WHERE stale.id = expired_rows.id
      RETURNING stale.id
    )
    INSERT INTO public.api_rate_limits (
      key_hash,
      request_count,
      created_at,
      expires_at
    )
    VALUES (
      ${key},
      1,
      now(),
      now() + (${windowMs}::bigint * interval '1 millisecond')
    )
    ON CONFLICT (key_hash) DO UPDATE
    SET
      request_count = CASE
        WHEN api_rate_limits.expires_at <= now() THEN 1
        ELSE least(api_rate_limits.request_count + 1, ${limit + 1})
      END,
      created_at = CASE
        WHEN api_rate_limits.expires_at <= now() THEN now()
        ELSE api_rate_limits.created_at
      END,
      expires_at = CASE
        WHEN api_rate_limits.expires_at <= now()
          THEN now() + (${windowMs}::bigint * interval '1 millisecond')
        ELSE api_rate_limits.expires_at
      END
    RETURNING request_count,
      (extract(epoch FROM expires_at) * 1000)::bigint AS reset_at_ms,
      request_count <= ${limit} AS accepted
  `);
  const row = rows[0];
  if (!row) throw new Error("Rate-limit database operation returned no result.");
  const resetAt = Number(row.reset_at_ms);
  const accepted = row.accepted === true || row.accepted === "t";
  return {
    allowed: accepted,
    retryAfterSeconds: accepted ? 0 : Math.max(1, Math.ceil((resetAt - now) / 1_000)),
  };
}

async function consumeWindow(
  key: string,
  limit: number,
  windowMs: number,
  now: number,
): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  if (process.env.DATABASE_URL) {
    return consumeDatabaseWindow(key, limit, windowMs, now);
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("[Rate limit] Distributed database storage is required in production.");
  }
  return consumeDevelopmentWindow(key, limit, windowMs, now);
}

function consumeDevelopmentWindow(
  key: string,
  limit: number,
  windowMs: number,
  now: number,
): { allowed: boolean; retryAfterSeconds: number } {
  const existing = DEVELOPMENT_LIMITS.get(key);
  const decision = consumeFixedWindow(
    existing ? { count: existing.count, windowStartedAtMs: existing.resetAt - windowMs } : null,
    limit,
    windowMs,
    now,
  );
  DEVELOPMENT_LIMITS.set(key, {
    count: decision.next.count,
    resetAt: decision.next.windowStartedAtMs + windowMs,
  });
  return { allowed: decision.allowed, retryAfterSeconds: decision.retryAfterSeconds };
}

export async function enforceRateLimit(
  request: Request,
  action: RateLimitAction,
  scope: RateLimitScope = {},
): Promise<void> {
  const now = Date.now();
  const secret = keySecret();
  // Staff login is checked twice: once against the account being named, and
  // once against the address it is being named from. They are different
  // questions and carry their own policies — see STAFF_LOGIN_IP.
  const identities: readonly RateLimitIdentity[] =
    action === "STAFF_LOGIN" && scope.identifier
      ? [
          {
            action: "STAFF_LOGIN_IP",
            actorType: "CLIENT_IP",
            actorId: privacyFingerprint(clientAddress(request)),
          },
          identityFor(request, action, scope),
        ]
      : [identityFor(request, action, scope)];

  for (const identity of identities) {
    const policy = RATE_LIMIT_POLICIES[identity.action];
    const key = createRateLimitKey(identity, secret);
    const result = await consumeWindow(key, policy.limit, policy.windowMs, now);
    if (!result.allowed) {
      throw new DomainError("RATE_LIMITED", "Çok fazla istek gönderildi. Lütfen bekleyin.", {
        httpStatus: 429,
        details: { retryAfterSeconds: result.retryAfterSeconds },
      });
    }
  }
}
