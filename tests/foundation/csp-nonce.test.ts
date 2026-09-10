import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { isProtectedStaffPath } from "../../lib/auth/role-access";

/**
 * The nonce CSP only works if three things stay true: the login page never
 * becomes a protected path (the matcher now covers it, so a redirect there
 * would loop), every branch that returns a response carries the policy, and
 * nothing re-introduces 'unsafe-inline' into script-src.
 */

const proxySource = readFileSync(path.join(process.cwd(), "proxy.ts"), "utf8");

test("the login page is never treated as a protected path", () => {
  // The matcher deliberately includes /staff/login so the page can receive a
  // nonce. If it were also protected, handleStaffAuth would redirect it to
  // itself for ever.
  assert.equal(isProtectedStaffPath("/staff/login"), false);
  assert.equal(isProtectedStaffPath("/staff/login/"), false);
  assert.equal(isProtectedStaffPath("/staff/login/reset"), false);
});

test("the panels that must stay behind the gate still are", () => {
  for (const pathname of [
    "/admin",
    "/admin/dashboard",
    "/cashier",
    "/kitchen",
    "/staff/dashboard",
    "/staff/orders",
    "/staff/tables",
    "/staff/calls",
    "/staff/profile",
  ]) {
    assert.equal(isProtectedStaffPath(pathname), true, `${pathname} must stay protected`);
  }
});

test("public paths are not swept into the auth gate by the wider matcher", () => {
  for (const pathname of ["/", "/menu/invalid", "/api/menu", "/staffing", "/administration"]) {
    assert.equal(isProtectedStaffPath(pathname), false, `${pathname} must stay public`);
  }
});

test("script-src carries a nonce and never 'unsafe-inline'", () => {
  assert.match(proxySource, /script-src 'self' 'nonce-\$\{nonce\}' 'strict-dynamic'/);
  // 'unsafe-inline' in script-src would silently make the nonce decorative.
  const scriptSrcLine = /`script-src[^`]*`/.exec(proxySource)?.[0] ?? "";
  assert.doesNotMatch(scriptSrcLine, /unsafe-inline/);
});

test("the policy is applied once, after the branch has chosen its response", () => {
  // Redirects and the invalid-menu branch build their own NextResponse; setting
  // the header on the way out is what stops any of them shipping without a CSP.
  assert.match(
    proxySource,
    /const response = await route\(request, requestHeaders\);\s*\n\s*response\.headers\.set\("Content-Security-Policy", policy\);/,
  );
});

test("the nonce is generated per request from a CSPRNG", () => {
  assert.match(proxySource, /crypto\.randomUUID\(\)/);
  // A module-level constant would be a fixed nonce for the process lifetime.
  assert.doesNotMatch(proxySource, /^const nonce =/m);
});

test("no second Content-Security-Policy is served from the static header layer", () => {
  const config = readFileSync(path.join(process.cwd(), "next.config.ts"), "utf8");
  assert.doesNotMatch(config, /"Content-Security-Policy"/);
  // The other headers must stay where they are.
  for (const header of [
    "X-Content-Type-Options",
    "Referrer-Policy",
    "Permissions-Policy",
    "Strict-Transport-Security",
  ]) {
    assert.ok(config.includes(header), `${header} must remain in next.config.ts`);
  }
});

test("the hand-written menu script is nonced, since Next.js will not do it", () => {
  const menuPage = readFileSync(
    path.join(process.cwd(), "app/menu/[tableToken]/page.tsx"),
    "utf8",
  );
  assert.match(menuPage, /<script nonce=\{nonce\}/);
  assert.match(menuPage, /requestHeaders\.get\(CSP_NONCE_HEADER\)/);
});

test("pages that would otherwise be prerendered opt into per-request rendering", () => {
  // A prerendered shell carries a build-time nonce that no longer matches the
  // response header, so its scripts are blocked and the page never hydrates.
  for (const page of [
    "app/page.tsx",
    "app/(auth)/staff/login/page.tsx",
    "app/menu/invalid/page.tsx",
  ]) {
    const source = readFileSync(path.join(process.cwd(), page), "utf8");
    assert.match(source, /await connection\(\)/, `${page} must render per request`);
  }
});
