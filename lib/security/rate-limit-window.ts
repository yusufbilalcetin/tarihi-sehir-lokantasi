export interface RateLimitWindowState {
  readonly count: number;
  readonly windowStartedAtMs: number;
}

export interface RateLimitWindowDecision {
  readonly allowed: boolean;
  readonly retryAfterSeconds: number;
  readonly next: RateLimitWindowState;
}

/** Pure fixed-window decision shared by tests and the PostgreSQL adapter. */
export function consumeFixedWindow(
  state: RateLimitWindowState | null,
  limit: number,
  windowMs: number,
  nowMs: number,
): RateLimitWindowDecision {
  if (!Number.isSafeInteger(limit) || limit < 1) throw new TypeError("Rate limit is invalid.");
  if (!Number.isSafeInteger(windowMs) || windowMs < 1) {
    throw new TypeError("Rate-limit window is invalid.");
  }
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) throw new TypeError("Current time is invalid.");

  const active = state && state.windowStartedAtMs + windowMs > nowMs
    ? state
    : { count: 0, windowStartedAtMs: nowMs };
  const allowed = active.count < limit;
  const next = allowed ? { ...active, count: active.count + 1 } : active;
  return {
    allowed,
    retryAfterSeconds: allowed
      ? 0
      : Math.max(1, Math.ceil((active.windowStartedAtMs + windowMs - nowMs) / 1_000)),
    next,
  };
}
