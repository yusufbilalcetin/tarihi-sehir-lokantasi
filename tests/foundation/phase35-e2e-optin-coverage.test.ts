import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";

/**
 * Every HTTP E2E suite is opt-in, and an un-opted suite reports "skipped"
 * rather than failing. That is the right default — these suites mutate a
 * fixture — but it makes forgetting one invisible: the gate reads as closed
 * while a whole suite never ran. The provisioner is what turns the opt-ins on,
 * so what has to hold is that it knows about every one of them.
 */

const integrationDirectory = path.join(process.cwd(), "tests/integration");
const provisioner = readFileSync(
  path.join(process.cwd(), "scripts/phase7d3-e2e.ts"),
  "utf8",
);

function suiteSources(): string[] {
  return readdirSync(integrationDirectory)
    .filter((name) => name.endsWith(".ts"))
    .map((name) => readFileSync(path.join(integrationDirectory, name), "utf8"));
}

/** The per-phase opt-ins, as the suites themselves spell them. */
function requiredPhaseFlags(): string[] {
  const flags = new Set<string>();
  for (const source of suiteSources()) {
    for (const match of source.matchAll(/RUN_PHASE([0-9A-F]+)_HTTP_E2E/g)) {
      flags.add(match[1]);
    }
  }
  return [...flags].sort();
}

test("the provisioner enables every per-phase HTTP E2E opt-in", () => {
  const required = requiredPhaseFlags();
  assert.ok(required.length > 0, "expected the suites to declare per-phase opt-ins");

  const managed = provisioner.match(/const E2E_PHASES = \[([^\]]*)\]/);
  assert.ok(managed, "scripts/phase7d3-e2e.ts must list the phases it manages");
  const listed = [...managed[1].matchAll(/"([0-9A-F]+)"/g)].map((match) => match[1]).sort();

  assert.deepEqual(
    listed,
    required,
    "a suite's opt-in is not provisioned — it would skip silently and the gate would look closed",
  );
});

test("each per-phase suite gets its confirmation token and base URL too", () => {
  // The flag alone is not enough: the suites also demand a confirmation token
  // and a target origin, and refuse to run without both.
  assert.match(
    provisioner,
    /RUN_PHASE\$\{phase\}_HTTP_E2E`, "true"/,
    "the opt-in itself must be written",
  );
  assert.match(
    provisioner,
    /PHASE\$\{phase\}_HTTP_E2E_CONFIRM`, PHASE_CONFIRMATION/,
    "the confirmation token must be written",
  );
  assert.match(
    provisioner,
    /PHASE\$\{phase\}_HTTP_E2E_BASE_URL`, origin/,
    "the target origin must be written",
  );

  const confirmation = provisioner.match(/const PHASE_CONFIRMATION = "([^"]+)"/);
  assert.ok(confirmation, "the provisioner must name the confirmation token it writes");
  for (const source of suiteSources()) {
    for (const declared of source.matchAll(/const CONFIRMATION = "([^"]+)"/g)) {
      if (!/PHASE[0-9A-F]+_HTTP_E2E_CONFIRM/.test(source)) continue;
      assert.equal(
        declared[1],
        confirmation[1],
        "a suite expects a different confirmation token than the provisioner writes",
      );
    }
  }
});

test("teardown removes the per-phase variables it added", () => {
  // `down` filters the managed block out of .env.local; if the per-phase names
  // are not in that filter they survive teardown and point at a dead server.
  assert.match(
    provisioner,
    /!MANAGED\.includes\(name\) && !phaseVariableNames\(\)\.includes\(name\)/,
    "writeEnv must strip the per-phase variables as well as the shared ones",
  );
});
