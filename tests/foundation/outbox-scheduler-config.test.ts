import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const vercelConfig = JSON.parse(
  readFileSync(new URL("../../vercel.json", import.meta.url), "utf8"),
) as { crons?: { path: string; schedule: string }[] };

const route = readFileSync(
  new URL("../../app/api/internal/outbox/dispatch/route.ts", import.meta.url),
  "utf8",
);

/**
 * Nothing inside the application dispatches the outbox; the scheduled call is
 * the only path realtime events have to a panel. Losing the cron entry breaks
 * realtime silently — the API keeps answering and the backlog just grows — so
 * the deployment config is asserted here rather than discovered in production.
 */
test("a scheduler is configured for the outbox dispatch endpoint", () => {
  const crons = vercelConfig.crons ?? [];
  const dispatch = crons.find((job) => job.path === "/api/internal/outbox/dispatch");
  assert.ok(dispatch, "vercel.json must schedule /api/internal/outbox/dispatch");
  assert.match(
    dispatch.schedule,
    /^\S+ \S+ \S+ \S+ \S+$/,
    "the schedule must be a five-field cron expression",
  );
});

test("the dispatch route answers the verb the scheduler can send", () => {
  // Vercel Cron issues GET only. POST stays for every other caller, so both
  // verbs must resolve to the same authenticated handler.
  assert.match(route, /export const GET = dispatch;/);
  assert.match(route, /export const POST = dispatch;/);
  assert.match(
    route,
    /isAuthorizedOutboxDispatch\(request\.headers\.get\("authorization"\), secret\)/,
    "both verbs must go through the bearer-secret check",
  );
});
