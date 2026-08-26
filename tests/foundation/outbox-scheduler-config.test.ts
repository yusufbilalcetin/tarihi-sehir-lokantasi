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

const externalScheduler = {
  provider: "Supabase infrastructure",
  path: "/api/internal/outbox/dispatch",
  secret: "OUTBOX_DISPATCH_SECRET",
} as const;

test("Vercel does not own the externally managed Supabase scheduler", () => {
  assert.deepEqual(vercelConfig.crons ?? [], []);
  assert.equal(externalScheduler.provider, "Supabase infrastructure");
  assert.equal(externalScheduler.path, "/api/internal/outbox/dispatch");
});

test("the external scheduler endpoint keeps its authenticated POST contract", () => {
  assert.equal(externalScheduler.secret, "OUTBOX_DISPATCH_SECRET");
  assert.match(route, /export const POST = dispatch;/);
  // GET remains supported for compatibility, but Supabase Cron uses POST.
  assert.match(route, /export const GET = dispatch;/);
  assert.match(
    route,
    /isAuthorizedOutboxDispatch\(request\.headers\.get\("authorization"\), secret\)/,
    "both verbs must go through the bearer-secret check",
  );
});
