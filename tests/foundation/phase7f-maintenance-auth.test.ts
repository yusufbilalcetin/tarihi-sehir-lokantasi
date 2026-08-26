import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { isAuthorizedBearerSecret } from "../../lib/security/bearer-secret";
import { validateServerEnvironment } from "../../lib/env/validation";

/**
 * Phase 7F — the maintenance endpoint is the only surface in the product that
 * deletes rows, so its credential is held to two rules: it must exist, and it
 * must not be the outbox scheduler's credential wearing a different hat.
 */

const MAINTENANCE = "m".repeat(48);
const OUTBOX = "o".repeat(48);

function issuesFor(source: Record<string, string | undefined>): readonly string[] {
  const result = validateServerEnvironment(source, ["maintenance"]);
  return result.success ? [] : result.issues.map((issue) => `${issue.name}: ${issue.reason}`);
}

test("the maintenance capability requires its own secret", () => {
  const issues = issuesFor({});
  assert.ok(
    issues.some((issue) => issue.startsWith("MAINTENANCE_SECRET")),
    `expected a MAINTENANCE_SECRET issue, got ${issues.join(" | ")}`,
  );
});

test("a short maintenance secret is refused without echoing its value", () => {
  const weak = "too-short";
  const issues = issuesFor({ MAINTENANCE_SECRET: weak });
  assert.ok(issues.some((issue) => issue.includes("MAINTENANCE_SECRET")));
  assert.ok(!issues.join(" ").includes(weak), "the rejected value must not be echoed back");
});

test("reusing the outbox scheduler secret for maintenance is refused", () => {
  const issues = issuesFor({
    MAINTENANCE_SECRET: OUTBOX,
    OUTBOX_DISPATCH_SECRET: OUTBOX,
  });
  assert.ok(
    issues.some((issue) => issue.includes("must differ from OUTBOX_DISPATCH_SECRET")),
    `expected a secret-reuse issue, got ${issues.join(" | ")}`,
  );
});

test("two independent secrets validate, and only maintenance is required for it", () => {
  const result = validateServerEnvironment(
    { MAINTENANCE_SECRET: MAINTENANCE, OUTBOX_DISPATCH_SECRET: OUTBOX },
    ["maintenance"],
  );
  assert.equal(result.success, true);
  if (!result.success) return;
  assert.equal(result.data.maintenanceSecret, MAINTENANCE);
});

test("other capabilities do not start demanding the maintenance secret", () => {
  const result = validateServerEnvironment({ OUTBOX_DISPATCH_SECRET: OUTBOX }, ["outbox-dispatch"]);
  assert.equal(result.success, true, "the outbox capability must stay independent");
});

test("the bearer check is exact and rejects near misses", () => {
  assert.equal(isAuthorizedBearerSecret(`Bearer ${MAINTENANCE}`, MAINTENANCE), true);
  for (const header of [
    null,
    "",
    MAINTENANCE,
    `Bearer ${MAINTENANCE} `,
    `Bearer ${MAINTENANCE.slice(0, -1)}x`,
    `bearer ${MAINTENANCE}`,
    `Bearer ${OUTBOX}`,
  ]) {
    assert.equal(
      isAuthorizedBearerSecret(header, MAINTENANCE),
      false,
      `header ${JSON.stringify(header)} must be refused`,
    );
  }
  // A short expected secret can never authorise anything, even if it matches.
  assert.equal(isAuthorizedBearerSecret("Bearer short", "short"), false);
});

test("no maintenance secret is ever declared as a public variable", () => {
  const example = fs.readFileSync(
    path.join(process.cwd(), ".env.example"),
    "utf8",
  );
  assert.ok(example.includes("MAINTENANCE_SECRET="), "the example must document the variable");
  assert.ok(
    !/NEXT_PUBLIC_[A-Z_]*(SECRET|MAINTENANCE)/.test(example),
    "a secret must never be exposed through a NEXT_PUBLIC_ variable",
  );
});
