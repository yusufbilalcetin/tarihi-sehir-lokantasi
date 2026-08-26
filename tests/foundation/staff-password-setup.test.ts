import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { buildPasswordSetupLink, passwordSetupBaseUrl } from "@/lib/auth/password-setup-link";

/**
 * The gap this closes: `staff:setup-link` and the panel's reset action both
 * produced a Supabase recovery link, but the application had no page that
 * completed the flow, so a new staff member could never set a password.
 *
 * The dangerous way to close it would have been to let the provider's own
 * action_link drop a recovery session in the browser — `resolveStaffPrincipal`
 * turns ANY valid Supabase session for an active profile into a full staff
 * principal, so that session would be panel access without a password. These
 * cases pin the shape of the fix instead: the link points at this application,
 * and the token is redeemed server-side without ever writing an auth cookie.
 */

const route = readFileSync(
  path.join(process.cwd(), "app/api/staff/set-password/route.ts"),
  "utf8",
);

/**
 * Prose is not behaviour: a comment or a Turkish operator message may well say
 * "password". These checks are about the identifiers the code actually passes
 * around, so strip comments and string literals before looking.
 */
function codeOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/`(?:[^`\\]|\\.)*`/g, "``");
}

test("the setup link points at this application's own page", () => {
  const link = buildPasswordSetupLink("hashed-token-value", { APP_BASE_URL: "https://ornek.com" });
  assert.equal(link, "https://ornek.com/staff/set-password?token_hash=hashed-token-value");
});

test("a trailing slash on the configured origin does not double up", () => {
  assert.equal(passwordSetupBaseUrl({ APP_BASE_URL: "https://ornek.com/" }), "https://ornek.com");
  assert.match(
    buildPasswordSetupLink("t", { APP_BASE_URL: "https://ornek.com/" }),
    /^https:\/\/ornek\.com\/staff\/set-password\?/,
  );
});

test("the token is URL-encoded rather than pasted into the query", () => {
  const link = buildPasswordSetupLink("a+b/c=d", { APP_BASE_URL: "https://ornek.com" });
  assert.ok(!link.includes("a+b/c=d"), "a raw token would break the query string");
  assert.equal(new URL(link).searchParams.get("token_hash"), "a+b/c=d");
});

test("redeeming the token never writes an auth cookie", () => {
  assert.doesNotMatch(
    codeOnly(route),
    /createSupabaseServerClient/,
    "the set-password route must not use the cookie-backed client",
  );
  assert.doesNotMatch(route, /from "@supabase\/ssr"/, "the SSR client persists to cookies");
  assert.match(route, /persistSession:\s*false/, "the redeeming client must not persist");
  assert.match(route, /detectSessionInUrl:\s*false/);
});

test("the route redeems with the publishable key, never the service role", () => {
  assert.match(route, /supabasePublishableKey/);
  assert.doesNotMatch(codeOnly(route), /SERVICE_ROLE|getSupabaseAdminClient|serviceRoleKey/);
});

test("the route can only change the password", () => {
  const updateCalls = route.match(/updateUser\(\{[^}]*\}\)/g) ?? [];
  assert.equal(updateCalls.length, 1, "exactly one updateUser call is expected");
  assert.match(updateCalls[0], /^updateUser\(\{\s*password\s*\}\)$/);
  // Nothing that could move an account between tenants or roles.
  assert.doesNotMatch(codeOnly(route), /\brole\b|restaurantId|isActive/);
});

test("an invalid or expired token is refused without saying which", () => {
  assert.match(route, /verifyOtp\(\{\s*type:\s*"recovery",\s*token_hash:\s*tokenHash\s*\}\)/);
  assert.match(route, /status:\s*401/, "a bad token must be refused");
  assert.equal((route.match(/const INVALID_LINK =/g) ?? []).length, 1);
});

test("neither the password nor the token reaches a log or a response", () => {
  const code = codeOnly(route);
  for (const call of code.match(/logger\.\w+\([\s\S]*?\);/g) ?? []) {
    assert.doesNotMatch(call, /\bpassword\b/, `a log call passes the password: ${call}`);
    assert.doesNotMatch(call, /\btokenHash\b/, `a log call passes the token: ${call}`);
  }
  for (const call of code.match(/NextResponse\.json\([\s\S]*?\)/g) ?? []) {
    assert.doesNotMatch(call, /\bpassword\b|\btokenHash\b/, `a response echoes a secret: ${call}`);
  }
});

test("the route is rate limited and origin-checked like the login route", () => {
  assert.match(route, /assertTrustedMutationOrigin\(request\)/);
  assert.match(route, /enforceRateLimit\(request, "STAFF_PASSWORD_RESET"/);
});

test("the setup page never redeems the token itself", () => {
  const page = readFileSync(
    path.join(process.cwd(), "app/(auth)/staff/set-password/page.tsx"),
    "utf8",
  );
  assert.doesNotMatch(page, /verifyOtp|createClient/, "opening the link must not consume it");
  assert.match(page, /robots/, "a page reached by credential must not be indexed");
});

test("the CLI hands out the application link, not the provider's action_link", () => {
  for (const script of ["scripts/staff-setup-link.ts", "scripts/staff-bootstrap.ts"]) {
    const source = readFileSync(path.join(process.cwd(), script), "utf8");
    assert.match(source, /hashed_token/, `${script} must use the hashed token`);
    assert.doesNotMatch(
      codeOnly(source),
      /properties\.action_link/,
      `${script} must not print the provider's action_link`,
    );
    assert.match(source, /buildPasswordSetupLink/, `${script} must build the application link`);
  }
});
