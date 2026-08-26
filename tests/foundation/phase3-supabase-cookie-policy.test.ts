import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const cookiePolicy = readFileSync(
  new URL("../../lib/supabase/cookie-options.ts", import.meta.url),
  "utf8",
);
const consumers = [
  "../../proxy.ts",
  "../../lib/supabase/server.ts",
  "../../lib/supabase/browser.ts",
].map((path) => readFileSync(new URL(path, import.meta.url), "utf8"));

test("all Supabase SSR clients share a production-secure cookie policy", () => {
  assert.match(cookiePolicy, /sameSite: "lax"/);
  assert.match(cookiePolicy, /secure: process\.env\.NODE_ENV === "production"/);
  assert.match(cookiePolicy, /httpOnly: false/);
  for (const consumer of consumers) {
    assert.match(consumer, /cookieOptions: SUPABASE_AUTH_COOKIE_OPTIONS/);
  }
});
