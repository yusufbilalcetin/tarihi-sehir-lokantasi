import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";

/**
 * A public door that writes or reads the database must cost something.
 *
 * The endpoints a stranger can reach without any cookie are the ones that can
 * be hammered: each unauthenticated call that reaches PostgreSQL is a request
 * nobody has paid for, and a slug or token lookup left unmetered is also an
 * enumeration oracle. Every such endpoint spends a rate-limit budget — this
 * case is what stops the next one being added without one, which is how
 * `POST /api/guest-sessions` came to be the single public endpoint that
 * queried the database before anything had been authenticated.
 */

const API_ROOT = path.join(process.cwd(), "app", "api");

/**
 * Anything that establishes who the caller is before the handler proceeds —
 * a session, a capability, or the bearer secret the internal workers carry.
 * A shared secret is authentication too, so those routes are inside the rule
 * rather than exempted from it by hand.
 */
const AUTH_GUARDS =
  /admin(Read|Mutation|Query)|staff(Read|Route|Mutation|Query)|reportRoute|requireCustomerTableContext|requireGuestOrderContext|requireOrderTracking|printerAgentRoute|requireStaffPrincipal|requireCurrentStaff|resolvePrincipal|isAuthorizedBearerSecret|isAuthorizedOutboxDispatch/;

const MUTATION_HANDLER =
  /export\s+(?:async\s+)?(?:function|const)\s+(POST|PATCH|PUT|DELETE)\b/;

/**
 * Public mutations that legitimately spend nothing, each for a stated reason.
 * A new entry here is a deliberate decision, not a default.
 */
const EXEMPT = new Map<string, string>([
  [
    "staff/logout/route.ts",
    "clears the caller's own cookie: no lookup, nothing to enumerate or exhaust",
  ],
]);

function routeFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return routeFiles(full);
    return entry.name === "route.ts" ? [full] : [];
  });
}

const ROUTES = routeFiles(API_ROOT).map((file) => ({
  id: path.relative(API_ROOT, file).split(path.sep).join("/"),
  source: readFileSync(file, "utf8"),
}));

test("the API surface is discovered, not hard-coded", () => {
  // A broken walk would make every case below vacuously pass.
  assert.ok(ROUTES.length > 50, `only found ${ROUTES.length} routes`);
});

test("every unauthenticated mutation spends a rate-limit budget", () => {
  const unmetered = ROUTES.filter(
    (route) =>
      MUTATION_HANDLER.test(route.source) &&
      !AUTH_GUARDS.test(route.source) &&
      !EXEMPT.has(route.id) &&
      !/enforceRateLimit/.test(route.source),
  ).map((route) => route.id);

  assert.deepEqual(
    unmetered,
    [],
    `public mutation without a rate limit: ${unmetered.join(", ")}`,
  );
});

test("the guest ordering door is metered like the table door", () => {
  const guest = ROUTES.find((route) => route.id === "guest-sessions/route.ts");
  const table = ROUTES.find((route) => route.id === "table-sessions/route.ts");
  assert.ok(guest && table, "both session endpoints must exist");

  // Both open an ordering session for someone with no credential yet, so both
  // are keyed by client address and draw on the same budget.
  for (const route of [guest!, table!]) {
    assert.match(route.source, /enforceRateLimit\(request, "QR_VALIDATE"\)/, route.id);
    // A throttled caller has to be told how long to wait.
    assert.match(route.source, /retryAfterHeader\(error\)/, route.id);
  }
});

test("each exemption still names a route that exists", () => {
  // An exemption outliving its route would silently widen the rule.
  for (const [id, reason] of EXEMPT) {
    assert.ok(
      ROUTES.some((route) => route.id === id),
      `exempt route ${id} is gone (${reason}); drop the entry`,
    );
  }
});
