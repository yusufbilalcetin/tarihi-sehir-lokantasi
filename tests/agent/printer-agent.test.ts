import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import { AgentConfigError, loadAgentConfig } from "../../tools/printer-agent/src/config";
import { PrintJournal } from "../../tools/printer-agent/src/journal";

/**
 * The agent's two decisions that are made without the server: what a device key
 * means, and whether a job it is handed has already been printed. Both run on a
 * machine nobody is watching, so both are settled here.
 */

const workspace = mkdtempSync(path.join(tmpdir(), "printer-agent-"));
after(() => rmSync(workspace, { recursive: true, force: true }));

function configFile(body: unknown): string {
  const file = path.join(workspace, `config-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(file, JSON.stringify(body), "utf8");
  return file;
}

const VALID = {
  baseUrl: "https://example.test",
  devices: { "kitchen-main": { transport: "tcp", host: "192.168.1.50", port: 9100 } },
};

test("the device map turns a stable key into a local address", () => {
  const config = loadAgentConfig(configFile(VALID), { PRINTER_AGENT_TOKEN: "t".repeat(43) });
  assert.deepEqual(config.devices["kitchen-main"], {
    transport: "tcp",
    host: "192.168.1.50",
    port: 9100,
  });
  // Defaults exist so a minimal file works, and idle polling is slower than
  // active polling: a quiet restaurant must not poll all night at full rate.
  assert.ok(config.idlePollIntervalMs > config.pollIntervalMs);
  assert.equal(config.baseUrl, "https://example.test");
});

test("the token comes from the environment, never from the file", () => {
  assert.throws(
    () => loadAgentConfig(configFile(VALID), {}),
    AgentConfigError,
    "a missing token stops the agent rather than starting it unauthenticated",
  );
  // A config file carrying a token does not make one available: the field is
  // ignored, so a config copied for support carries no working credential.
  const withToken = loadAgentConfig(
    configFile({ ...VALID, token: "from-the-file" }),
    { PRINTER_AGENT_TOKEN: "e".repeat(43) },
  );
  assert.equal(withToken.token, "e".repeat(43));
});

test("an unusable target is refused at startup, not at the printer", () => {
  const cases: [unknown, string][] = [
    [{ ...VALID, baseUrl: "http://printer.example.test" }, "plain HTTP off loopback"],
    [{ ...VALID, baseUrl: "not-a-url" }, "a malformed base URL"],
    [{ ...VALID, devices: { a: { transport: "usb", host: "x", port: 1 } } }, "an unsupported transport"],
    [{ ...VALID, devices: { a: { transport: "tcp", host: "", port: 9100 } } }, "a blank host"],
    [{ ...VALID, devices: { a: { transport: "tcp", host: "x", port: 70_000 } } }, "an impossible port"],
    [{ ...VALID, claimLimit: 0 }, "a claim limit of zero"],
  ];
  for (const [body, description] of cases) {
    assert.throws(
      () => loadAgentConfig(configFile(body), { PRINTER_AGENT_TOKEN: "t".repeat(43) }),
      AgentConfigError,
      `${description} must be refused`,
    );
  }
  // Loopback is the one place plain HTTP is allowed, for local testing.
  const local = loadAgentConfig(
    configFile({ ...VALID, baseUrl: "http://localhost:3000" }),
    { PRINTER_AGENT_TOKEN: "t".repeat(43) },
  );
  assert.equal(local.baseUrl, "http://localhost:3000");
});

test("the journal suppresses a reprint when an acknowledgement was lost", () => {
  const file = path.join(workspace, "journal.json");
  const journal = new PrintJournal(file);
  assert.equal(journal.has("job-1"), false);
  journal.record("job-1");
  assert.equal(journal.has("job-1"), true);
  journal.record("job-1");

  // It survives a restart: the same job handed back does not print twice.
  assert.equal(new PrintJournal(file).has("job-1"), true);
  assert.equal(new PrintJournal(file).has("job-2"), false);
});

test("a corrupt journal starts the agent rather than stopping it", () => {
  const file = path.join(workspace, "corrupt.json");
  writeFileSync(file, "{ not json", "utf8");
  const journal = new PrintJournal(file);
  // One duplicate ticket after a crash beats an agent that refuses to run.
  assert.equal(journal.has("job-1"), false);
  journal.record("job-1");
  assert.equal(new PrintJournal(file).has("job-1"), true);
});

test("the journal cannot grow without limit", () => {
  const file = path.join(workspace, "bounded.json");
  const journal = new PrintJournal(file);
  for (let index = 0; index < 600; index += 1) journal.record(`job-${index}`);
  const reloaded = new PrintJournal(file);
  assert.equal(reloaded.has("job-599"), true, "the most recent jobs are kept");
  assert.equal(reloaded.has("job-0"), false, "the oldest are dropped");
});
