import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";

import postgres from "postgres";

import { readHttpE2eEnvironment } from "./http-test-environment";
import { readSupabaseIntegrationEnvironment } from "./supabase-test-environment";
import { fixtureRateLimitKeys, resetFixtureRateLimits } from "./rate-limit-reset";

/**
 * Phase 7D.4 — proves the staff-login limiter still bites, and that the test
 * reset used by the HTTP suites is precise rather than a blunt truncate.
 *
 * This exists so the E2E suites' rate-limit isolation can never quietly become
 * "the limiter is switched off in tests".
 */

const httpReadiness = readHttpE2eEnvironment();
const dbReadiness = readSupabaseIntegrationEnvironment({ requireDatabaseUrl: true });

if (!httpReadiness.ready || !dbReadiness.ready) {
  test("Phase 7D.4 rate-limit isolation", {
    skip: httpReadiness.ready ? (dbReadiness as { reason: string }).reason : httpReadiness.reason,
  }, () => undefined);
} else {
  const environment = httpReadiness.environment;
  const sql = postgres(dbReadiness.environment.databaseUrl!, {
    max: 2, prepare: false, onnotice: () => {},
  });
  const identifiers = [
    environment.waiter.identifier,
    environment.kitchen.identifier,
    environment.cashier.identifier,
    environment.otherTenantStaff.identifier,
    ...(environment.admin ? [environment.admin.identifier] : []),
  ].map((value) => value.toLowerCase());

  async function login(identifier: string, password: string): Promise<number> {
    const response = await fetch(new URL("/api/staff/login", environment.baseUrl), {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: environment.baseUrl.origin },
      body: JSON.stringify({ identifier, password }),
    });
    return response.status;
  }

  describe("Phase 7D.4 staff-login limiter and test isolation", { concurrency: false }, () => {
    before(async () => {
      await resetFixtureRateLimits(sql, identifiers);
    });

    after(async () => {
      await resetFixtureRateLimits(sql, identifiers);
      await sql.end({ timeout: 5 });
    });

    test("the limiter refuses a sixth login inside the window", async () => {
      // The policy is 5 per 15 minutes on the client-IP bucket, so the sixth
      // attempt from this address must be refused whoever it claims to be.
      const statuses: number[] = [];
      for (let attempt = 0; attempt < 6; attempt += 1) {
        statuses.push(await login(environment.waiter.identifier, environment.waiter.password));
      }
      assert.equal(
        statuses.slice(0, 5).every((status) => status === 200),
        true,
        `the first five logins should succeed, got ${statuses.join(", ")}`,
      );
      assert.equal(statuses[5], 429, `the sixth must be rate limited, got ${statuses[5]}`);
    });

    test("a wrong password is refused without being mistaken for a limit", async () => {
      await resetFixtureRateLimits(sql, identifiers);
      const status = await login(environment.waiter.identifier, "definitely-not-the-password");
      assert.equal(status, 401, `bad credentials must be 401, got ${status}`);
    });

    test("the targeted reset clears only the fixture's own buckets", async () => {
      // Trip the limiter, then plant an unrelated row and prove it survives.
      for (let attempt = 0; attempt < 6; attempt += 1) {
        await login(environment.waiter.identifier, environment.waiter.password);
      }
      const blocked = await login(environment.waiter.identifier, environment.waiter.password);
      assert.equal(blocked, 429, "precondition: the limiter is engaged");

      const foreignKey = "phase7d4-unrelated-key-that-must-survive-the-reset";
      // Idempotent: a previous aborted run may have left this sentinel behind.
      await sql`delete from api_rate_limits where key_hash = ${foreignKey}`;
      await sql`
        insert into api_rate_limits (key_hash, expires_at, request_count)
        values (${foreignKey}, now() + interval '1 hour', 1)`;

      const removed = await resetFixtureRateLimits(sql, identifiers);
      assert.ok(removed > 0, "the fixture's own rate-limit rows were removed");

      const survivors = await sql`
        select count(*)::int as count from api_rate_limits where key_hash = ${foreignKey}`;
      assert.equal(survivors[0].count, 1, "an unrelated rate-limit row must survive");
      await sql`delete from api_rate_limits where key_hash = ${foreignKey}`;

      const after = await login(environment.waiter.identifier, environment.waiter.password);
      assert.equal(after, 200, `login works again after the targeted reset, got ${after}`);
    });

    test("the reset covers every key the fixture can produce", () => {
      const keys = fixtureRateLimitKeys(identifiers);
      // One client-IP login bucket, plus one bucket per action per actor.
      assert.ok(keys.length >= 5, `expected several keys, got ${keys.length}`);
      assert.equal(new Set(keys).size, keys.length, "keys are unique");
      assert.ok(
        keys.every((key) => /^rate-limit:v1:[a-z_]+:[A-Za-z0-9_-]{43}$/.test(key)),
        `every key is a namespaced digest, got e.g. ${keys[0]}`,
      );
      assert.ok(
        !keys.some((key) => identifiers.some((identifier) => key.includes(identifier))),
        "no raw identifier leaks into a stored key",
      );
    });
  });
}
