import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  AGENT_ONLINE_THRESHOLD_MS,
  PRINT_RETRY,
  agentPresence,
  buildDedupeKey,
  groupLinesByPrinter,
  isPrintErrorCode,
  isTerminalAttempt,
  resolveRoutes,
  retryDelayMs,
  type RouteCandidate,
} from "../../lib/domain/print-routing";
import {
  generateAgentToken,
  hashAgentToken,
  isAgentTokenShape,
  readBearerToken,
  verifyAgentToken,
} from "../../lib/security/printer-agent-token";
import { validateServerEnvironment } from "../../lib/env/validation";
import { RATE_LIMIT_POLICIES } from "../../lib/security/rate-limit";

/**
 * Phase 8C — routing decisions and agent credentials.
 *
 * The routing rules decide where a kebab and a cola each go; the credential
 * rules decide whether a machine on the restaurant's network is allowed to
 * print at all. Both are pure, so both are settled here.
 */

const PEPPER = "p".repeat(48);

function route(overrides: Partial<RouteCandidate> = {}): RouteCandidate {
  return {
    id: "route-1",
    printerId: "printer-kitchen",
    printerName: "Mutfak",
    categoryId: null,
    copies: 1,
    isActive: true,
    printerIsActive: true,
    ...overrides,
  };
}

// ----------------------------------------------------------------- routing

test("a category's own route wins over the station default", () => {
  const candidates = [
    route({ id: "default", printerId: "printer-kitchen", printerName: "Mutfak" }),
    route({
      id: "grill",
      printerId: "printer-grill",
      printerName: "Izgara",
      categoryId: "category-grill",
    }),
  ];
  assert.deepEqual(
    resolveRoutes(candidates, "category-grill").map((row) => row.printerId),
    ["printer-grill"],
  );
  // A category with no route of its own falls back to the default.
  assert.deepEqual(
    resolveRoutes(candidates, "category-soup").map((row) => row.printerId),
    ["printer-kitchen"],
  );
});

test("one category may fan out to several printers, but never twice to one", () => {
  const candidates = [
    route({ id: "a", printerId: "printer-grill", printerName: "Izgara", categoryId: "c" }),
    route({ id: "b", printerId: "printer-pass", printerName: "Expediter", categoryId: "c" }),
    // A duplicate route to the same printer must not double the ticket.
    route({ id: "c", printerId: "printer-grill", printerName: "Izgara", categoryId: "c" }),
  ];
  assert.deepEqual(
    resolveRoutes(candidates, "c").map((row) => row.printerId).sort(),
    ["printer-grill", "printer-pass"],
  );
});

test("a retired printer or a disabled route is never a destination", () => {
  assert.deepEqual(resolveRoutes([route({ isActive: false })], null), []);
  assert.deepEqual(resolveRoutes([route({ printerIsActive: false })], null), []);
  // With nothing usable the answer is an empty list, not an exception: the
  // order must still succeed.
  assert.deepEqual(resolveRoutes([], "category-a"), []);
});

test("a mixed order splits so each ticket carries only its own station's lines", () => {
  const candidates = [
    route({ id: "kitchen", printerId: "printer-kitchen", printerName: "Mutfak" }),
    route({
      id: "bar",
      printerId: "printer-bar",
      printerName: "Bar",
      categoryId: "category-drinks",
    }),
  ];
  const { batches, unrouted } = groupLinesByPrinter(
    [
      { categoryId: "category-grill", line: "Kebap" },
      { categoryId: "category-drinks", line: "Cola" },
      { categoryId: "category-grill", line: "Lahmacun" },
    ],
    candidates,
  );

  assert.equal(batches.length, 2);
  const kitchen = batches.find((batch) => batch.printerId === "printer-kitchen");
  const bar = batches.find((batch) => batch.printerId === "printer-bar");
  assert.deepEqual(kitchen?.lines, ["Kebap", "Lahmacun"], "the grill never sees the drinks");
  assert.deepEqual(bar?.lines, ["Cola"], "the bar never sees the kebabs");
  assert.equal(unrouted.length, 0);
});

test("lines with nowhere to go are reported rather than dropped", () => {
  const { batches, unrouted } = groupLinesByPrinter(
    [{ categoryId: "category-grill", line: "Kebap" }],
    [],
  );
  assert.equal(batches.length, 0);
  assert.deepEqual(unrouted, ["Kebap"], "the caller is told, and the order still stands");
});

// ------------------------------------------------------------------ dedupe

test("the dedupe key is deterministic per printed occurrence", () => {
  const first = buildDedupeKey({
    documentType: "KITCHEN_ORDER",
    sourceId: "order-a",
    printerId: "printer-kitchen",
    discriminator: "confirm",
  });
  const repeat = buildDedupeKey({
    documentType: "KITCHEN_ORDER",
    sourceId: "order-a",
    printerId: "printer-kitchen",
    discriminator: "confirm",
  });
  assert.equal(first, repeat, "a repeated confirmation collapses to one ticket");

  // A different printer, order, occurrence or document is a different ticket.
  for (const different of [
    { printerId: "printer-bar" },
    { sourceId: "order-b" },
    { discriminator: "add:xyz" },
    { documentType: "KITCHEN_CANCEL" as const },
  ]) {
    assert.notEqual(
      first,
      buildDedupeKey({
        documentType: "KITCHEN_ORDER",
        sourceId: "order-a",
        printerId: "printer-kitchen",
        discriminator: "confirm",
        ...different,
      }),
    );
  }
  assert.ok(first.length <= 160, "the key fits the column");
});

// ------------------------------------------------------------------- retry

test("backoff grows and then stops growing, and attempts are bounded", () => {
  assert.equal(retryDelayMs(0), PRINT_RETRY.baseDelayMs);
  assert.ok(retryDelayMs(3) > retryDelayMs(1), "a printer left off is polled less often");
  assert.equal(retryDelayMs(50), PRINT_RETRY.maximumDelayMs, "the delay is capped");
  assert.equal(isTerminalAttempt(PRINT_RETRY.maxAttempts - 1), false);
  assert.equal(isTerminalAttempt(PRINT_RETRY.maxAttempts), true);
  assert.ok(PRINT_RETRY.leaseMs > 0 && PRINT_RETRY.maxAttempts <= 50);
});

test("error codes are a closed set", () => {
  assert.equal(isPrintErrorCode("PRINTER_CONNECTION_FAILED"), true);
  assert.equal(isPrintErrorCode("SOMETHING_ELSE"), false);
});

test("agent presence is honest about not knowing", () => {
  const now = new Date("2026-08-15T18:00:00.000Z");
  assert.equal(agentPresence(null, now), "UNKNOWN", "an agent that never called in");
  assert.equal(agentPresence(new Date(now.getTime() - 5_000), now), "ONLINE");
  assert.equal(
    agentPresence(new Date(now.getTime() - AGENT_ONLINE_THRESHOLD_MS - 1), now),
    "OFFLINE",
  );
});

// ------------------------------------------------------------- credentials

test("an agent token verifies only against its own digest", () => {
  const token = generateAgentToken(PEPPER);
  assert.ok(isAgentTokenShape(token.rawToken), "43 base64url characters");
  assert.ok(token.tokenHash.startsWith("v1."));
  assert.ok(
    !token.tokenHash.includes(token.rawToken),
    "the digest must not contain the token itself",
  );
  assert.equal(verifyAgentToken(token.rawToken, token.tokenHash, PEPPER), true);

  // A different pepper, a different token, and a mangled token all fail.
  assert.equal(verifyAgentToken(token.rawToken, token.tokenHash, "q".repeat(48)), false);
  assert.equal(
    verifyAgentToken(generateAgentToken(PEPPER).rawToken, token.tokenHash, PEPPER),
    false,
  );
  assert.equal(verifyAgentToken("too-short", token.tokenHash, PEPPER), false);
  assert.equal(verifyAgentToken(token.rawToken, "not-a-digest", PEPPER), false);
});

test("rotation invalidates the previous token", () => {
  const first = generateAgentToken(PEPPER, 1);
  const second = generateAgentToken(PEPPER, 2);
  assert.notEqual(first.tokenHash, second.tokenHash);
  assert.equal(second.tokenVersion, 2);
  // The old raw token cannot verify against the new digest, and the new one
  // cannot verify against the old.
  assert.equal(verifyAgentToken(first.rawToken, second.tokenHash, PEPPER), false);
  assert.equal(verifyAgentToken(second.rawToken, first.tokenHash, PEPPER), false);
  // The same raw token under two versions produces two different digests.
  assert.notEqual(
    hashAgentToken(first.rawToken, PEPPER, 1),
    hashAgentToken(first.rawToken, PEPPER, 2),
  );
});

test("only a well-formed bearer header yields a token", () => {
  const token = generateAgentToken(PEPPER);
  assert.equal(readBearerToken(`Bearer ${token.rawToken}`), token.rawToken);
  for (const header of [null, "", token.rawToken, `bearer ${token.rawToken}`, "Bearer short"]) {
    assert.equal(readBearerToken(header), null, `${JSON.stringify(header)} must be refused`);
  }
});

test("the agent pepper is its own secret, required only by its own capability", () => {
  const missing = validateServerEnvironment({}, ["printer-agent"]);
  assert.equal(missing.success, false);
  if (!missing.success) {
    assert.ok(
      missing.issues.some((issue) => issue.name === "PRINTER_AGENT_TOKEN_PEPPER"),
      "the capability names its own secret",
    );
  }

  const present = validateServerEnvironment(
    { PRINTER_AGENT_TOKEN_PEPPER: PEPPER },
    ["printer-agent"],
  );
  assert.equal(present.success, true);

  // Other capabilities do not start demanding it.
  const other = validateServerEnvironment(
    { OUTBOX_DISPATCH_SECRET: "o".repeat(48) },
    ["outbox-dispatch"],
  );
  assert.equal(other.success, true);
});

test("the unauthenticated agent surface has a ceiling on hammering", () => {
  // Authentication is the expensive part of an agent request: it scans and
  // HMACs every active agent. The limit is applied before it, and it is
  // generous, because every agent in one restaurant shares one public address.
  const policy = RATE_LIMIT_POLICIES.PRINTER_AGENT;
  assert.ok(policy.limit >= 120, "a busy service polls for work every few seconds");
  assert.ok(policy.windowMs <= 60_000);

  const envelope = readFileSync(
    path.join(process.cwd(), "lib", "api", "printer-agent-route.ts"),
    "utf8",
  );
  const limitAt = envelope.indexOf("enforceRateLimit");
  const resolveAt = envelope.indexOf("await resolvePrinterAgent");
  assert.ok(limitAt > 0, "the shared envelope enforces the limit");
  assert.ok(limitAt < resolveAt, "and does so before it authenticates");
});

// --------------------------------------------------------------- boundaries

test("the agent ships no database credential and no service-role key", () => {
  const root = path.join(process.cwd(), "tools", "printer-agent", "src");
  for (const file of ["agent.ts", "config.ts", "transport.ts", "journal.ts", "index.ts"]) {
    const source = readFileSync(path.join(root, file), "utf8");
    assert.ok(
      !/SERVICE_ROLE|DATABASE_URL|postgres:\/\/|supabase/i.test(source),
      `${file} must not reference a database or service-role credential`,
    );
    // The agent forwards bytes; it never composes printer commands.
    assert.ok(
      !/\\x1b|ESC\/POS builder|0x1d/.test(source),
      `${file} must not build printer commands itself`,
    );
  }
});

test("no printer transport beyond network ESC/POS is claimed", () => {
  const transport = readFileSync(
    path.join(process.cwd(), "tools", "printer-agent", "src", "transport.ts"),
    "utf8",
  );
  assert.ok(transport.includes('from "node:net"'), "network ESC/POS is the transport");
  // Prose may mention USB; an *import* of a USB or serial driver would be a
  // capability nobody could verify in this environment.
  assert.ok(
    !/(?:import|require)[^;\n]*["'](?:usb|serialport|node-hid|escpos[^"']*)["']/i.test(transport),
    "no USB or serial driver is imported; none could be verified without hardware",
  );
});
