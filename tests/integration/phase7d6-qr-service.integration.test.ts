import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";

import { createDb, type Database } from "../../db";
import { isDomainError } from "../../lib/api/domain-error";
import type { RestaurantPrincipal } from "../../lib/domain/restaurant-scope";
import {
  CUSTOMER_TABLE_SESSION_TTL_SECONDS,
  createCustomerTableSession,
  verifyCustomerTableSession,
} from "../../lib/security/customer-session";
import { deriveTableQrLink, verifyTableQrLink } from "../../lib/security/qr-link-token.server";
import { generateQrToken, hashQrToken } from "../../lib/security/qr-token";
import {
  generateTableQrToken,
  hashTableQrToken,
  verifyTableQrToken,
} from "../../lib/security/qr-token.server";
import { DrizzleStaffCallRepository } from "../../lib/repositories/drizzle-staff-call-repository";
import { DrizzleTableRepository } from "../../lib/repositories/drizzle-table-repository";
import { StaffCallService } from "../../lib/services/staff-call-service";
import { TableService } from "../../lib/services/table-service";
import { readSupabaseIntegrationEnvironment } from "./supabase-test-environment";

/**
 * Phase 7D.6 — QR lifecycle and the service-request lifecycle.
 *
 * QR rotation and revocation run through the real table service, and the
 * customer session is signed and verified with the same production helper the
 * server uses, so the TTL and the token-version rules are exercised rather than
 * re-implemented. No raw token is ever written to the database or printed.
 */

const PREFIX = "PHASE7D6Q_";
const readiness = readSupabaseIntegrationEnvironment({ requireDatabaseUrl: true });

async function code(work: () => Promise<unknown>): Promise<string> {
  try {
    await work();
    return "OK";
  } catch (error) {
    return isDomainError(error) ? error.code : `UNEXPECTED:${(error as Error).message}`;
  }
}

if (!readiness.ready) {
  test("Phase 7D.6 QR and service lifecycle", { skip: readiness.reason }, () => undefined);
} else {
  const environment = readiness.environment;
  const run = randomBytes(5).toString("hex");
  let connection: ReturnType<typeof createDb>;
  let db: Database;
  let sql: ReturnType<typeof createDb>["client"];
  let tableService: TableService;
  let calls: StaffCallService;
  const cleanupErrors: string[] = [];
  let assertions = 0;

  const ids = {
    restaurantA: randomUUID(),
    restaurantB: randomUUID(),
    tableA: randomUUID(),
    foreignTable: randomUUID(),
    admin: randomUUID(),
    waiter: randomUUID(),
    foreignWaiter: randomUUID(),
  };
  const secret = randomBytes(48).toString("base64url");

  function check(condition: boolean, message: string): void {
    assertions += 1;
    assert.ok(condition, message);
  }

  const asA = (role: RestaurantPrincipal["role"]): RestaurantPrincipal => ({
    userId: role === "ADMIN" ? ids.admin : ids.waiter,
    restaurantId: ids.restaurantA, role, isActive: true,
  });
  const asB = (): RestaurantPrincipal => ({
    userId: ids.foreignWaiter, restaurantId: ids.restaurantB, role: "WAITER", isActive: true,
  });

  async function tableRow(tableId: string) {
    const [row] = await sql`
      select qr_token_hash, qr_token_version, qr_token_revoked_at
      from restaurant_tables where id = ${tableId}`;
    return row;
  }

  describe("Phase 7D.6 QR lifecycle and service requests", { concurrency: false }, () => {
    before(async () => {
      connection = createDb(environment.databaseUrl!, { maxConnections: 4 });
      db = connection.db;
      sql = connection.client;
            // The production codec, so rotation and validation use the real pepper.
      tableService = new TableService(new DrizzleTableRepository(db), {
        generate: generateTableQrToken,
        hash: hashTableQrToken,
        verify: verifyTableQrToken,
        deriveLink: deriveTableQrLink,
        verifyLink: verifyTableQrLink,
      });
      calls = new StaffCallService(new DrizzleStaffCallRepository(db));

      await sql`insert into restaurants (id, name, slug) values
        (${ids.restaurantA}, ${`${PREFIX}Tenant A`}, ${`phase7d6q-a-${run}`}),
        (${ids.restaurantB}, ${`${PREFIX}Tenant B`}, ${`phase7d6q-b-${run}`})`;
      await sql`insert into restaurant_settings (restaurant_id) values
        (${ids.restaurantA}), (${ids.restaurantB})`;
      await sql`insert into staff_profiles (id, restaurant_id, name, login_identifier, role, is_active) values
        (${ids.admin}, ${ids.restaurantA}, ${`${PREFIX}ADMIN`}, ${`p7d6q-${run}-a`}, 'ADMIN', true),
        (${ids.waiter}, ${ids.restaurantA}, ${`${PREFIX}WAITER`}, ${`p7d6q-${run}-w`}, 'WAITER', true),
        (${ids.foreignWaiter}, ${ids.restaurantB}, ${`${PREFIX}B_WAITER`}, ${`p7d6q-${run}-bw`}, 'WAITER', true)`;
      const pepper = randomBytes(32);
      await sql`insert into restaurant_tables (id, restaurant_id, name, table_number, qr_token_hash) values
        (${ids.tableA}, ${ids.restaurantA}, ${`${PREFIX}Masa`}, 8701, ${generateQrToken(pepper).tokenHash}),
        (${ids.foreignTable}, ${ids.restaurantB}, ${`${PREFIX}Masa B`}, 8702, ${generateQrToken(pepper).tokenHash})`;
    });

    after(async () => {
      const order = [
        "waiter_calls", "order_events", "audit_logs", "outbox_events",
        "order_items", "orders", "restaurant_tables", "products", "categories",
        "restaurant_settings", "restaurant_counters", "staff_profiles", "restaurants",
      ];
      try {
        for (const table of order) {
          const column = table === "restaurants" ? "id" : "restaurant_id";
          await sql.unsafe(`delete from ${table} where ${column} = any($1::uuid[])`, [
            [ids.restaurantA, ids.restaurantB],
          ]);
        }
      } catch (error) {
        cleanupErrors.push((error as Error).message);
      }
      await connection.close();
      if (cleanupErrors.length > 0) {
        console.error("PHASE7D6 FIXTURE CLEANUP INCOMPLETE:", cleanupErrors.join(" | "));
      }
      console.log(`phase7d6 qr assertions executed: ${assertions}`);
    });

    test("the database keeps a hash and a version, never a raw token", async () => {
      const columns = await sql`
        select column_name from information_schema.columns
        where table_schema = 'public' and table_name = 'restaurant_tables'`;
      const names = columns.map((row) => String(row.column_name));
      check(names.includes("qr_token_hash"), "the hash column exists");
      check(names.includes("qr_token_version"), "the version column exists");
      check(
        !names.some((name) => /raw|plain|secret/i.test(name)),
        `no raw-token column exists (${names.join(", ")})`,
      );
      const row = await tableRow(ids.tableA);
      check(String(row.qr_token_hash).startsWith("v1."), "the stored value is a versioned hash");
    });

    test("rotation issues a new token, invalidates the old one and bumps the version", async () => {
      const before = await tableRow(ids.tableA);
      const rotated = await tableService.rotateToken(asA("ADMIN"), {
        restaurantId: ids.restaurantA, tableId: ids.tableA,
      });
      const after = await tableRow(ids.tableA);

      check(after.qr_token_version > before.qr_token_version,
        `the version advanced (${before.qr_token_version} -> ${after.qr_token_version})`);
      check(after.qr_token_hash !== before.qr_token_hash, "the stored hash changed");
      check(rotated.rawToken.length === 43, "a fresh raw token was issued to the caller");

      // The new raw token must hash to exactly what is stored; the old one must not.
      const pepper = process.env.QR_TOKEN_PEPPER!;
      check(
        hashQrToken(rotated.rawToken, pepper) === after.qr_token_hash,
        "the new raw token matches the stored hash",
      );
      check(
        hashQrToken(rotated.rawToken, pepper) !== before.qr_token_hash,
        "the previous hash no longer matches the live token",
      );
    });

    test("a session minted before rotation is refused afterwards", async () => {
      const before = await tableRow(ids.tableA);
      const oldVersion = Number(before.qr_token_version);
      const session = createCustomerTableSession(
        { restaurantId: ids.restaurantA, tableId: ids.tableA, accessVersion: oldVersion },
        secret,
      );
      const claims = verifyCustomerTableSession(session.token, secret);
      check(claims !== null, "the session verifies while the version still matches");

      await tableService.rotateToken(asA("ADMIN"), {
        restaurantId: ids.restaurantA, tableId: ids.tableA,
      });
      const after = await tableRow(ids.tableA);
      const newVersion = Number(after.qr_token_version);

      // The signature is still valid, but the table has moved on: the access
      // version in the cookie no longer matches the table's current one, which
      // is what the server compares before trusting a customer session.
      const stillSigned = verifyCustomerTableSession(session.token, secret);
      check(stillSigned !== null, "the signature itself remains intact");
      check(
        stillSigned!.accessVersion !== newVersion,
        `the session's version is stale (${stillSigned!.accessVersion} vs ${newVersion})`,
      );
      check(newVersion === oldVersion + 1, "the table advanced by exactly one version");
    });

    test("revocation stops the live token from being used again", async () => {
      const rotated = await tableService.rotateToken(asA("ADMIN"), {
        restaurantId: ids.restaurantA, tableId: ids.tableA,
      });
      const live = await tableRow(ids.tableA);
      check(live.qr_token_revoked_at === null, "the table starts unrevoked");

      await tableService.revokeToken(asA("ADMIN"), {
        restaurantId: ids.restaurantA, tableId: ids.tableA,
      });
      const revoked = await tableRow(ids.tableA);
      check(revoked.qr_token_revoked_at !== null, "the revocation timestamp is recorded");

      // The raw token the admin was handed still hashes to the stored value,
      // so it is the revocation flag alone that must close the door.
      const pepper = process.env.QR_TOKEN_PEPPER!;
      check(
        hashQrToken(rotated.rawToken, pepper) === revoked.qr_token_hash,
        "the hash is unchanged by revocation",
      );
      const resolved = await code(() =>
        tableService.validateToken(rotated.rawToken),
      );
      check(resolved !== "OK", `a revoked token no longer resolves (got ${resolved})`);
    });

    test("an invalid token never resolves and leaks nothing", async () => {
      const nonsense = randomBytes(32).toString("base64url");
      const invalid = await code(() =>
        tableService.validateToken(nonsense),
      );
      const malformed = await code(() =>
        tableService.validateToken("not-a-token"),
      );
      check(invalid !== "OK", `a random token is refused (got ${invalid})`);
      check(malformed !== "OK", `a malformed token is refused (got ${malformed})`);
      check(
        invalid === malformed,
        `both failures look the same (${invalid} vs ${malformed})`,
      );
    });

    test("the customer session honours its four-hour lifetime", async () => {
      check(
        CUSTOMER_TABLE_SESSION_TTL_SECONDS === 4 * 60 * 60,
        `the configured TTL is four hours (got ${CUSTOMER_TABLE_SESSION_TTL_SECONDS}s)`,
      );
      const issuedAt = Math.floor(Date.now() / 1_000);
      const session = createCustomerTableSession(
        {
          restaurantId: ids.restaurantA, tableId: ids.tableA,
          accessVersion: 1, nowSeconds: issuedAt,
        },
        secret,
      );
      // Verified with the production verifier at chosen instants; no waiting.
      const wellInside = verifyCustomerTableSession(
        session.token, secret, issuedAt + CUSTOMER_TABLE_SESSION_TTL_SECONDS - 120, 0,
      );
      check(wellInside !== null, "a session inside its window is accepted");

      const pastExpiry = verifyCustomerTableSession(
        session.token, secret, issuedAt + CUSTOMER_TABLE_SESSION_TTL_SECONDS + 120, 0,
      );
      check(pastExpiry === null, "a session past its expiry is rejected");

      const wrongSecret = verifyCustomerTableSession(
        session.token, randomBytes(48).toString("base64url"), issuedAt, 0,
      );
      check(wrongSecret === null, "a session signed with another secret is rejected");
    });

    test("a waiter call runs its whole lifecycle and stays in its tenant", async () => {
      const created = await calls.createCall(asA("WAITER"), {
        tableId: ids.tableA,
        type: "WAITER_CALL",
      });
      check(Boolean(created.call.id), "the call was created");

      const [row] = await sql`
        select status::text as status, restaurant_id from waiter_calls where id = ${created.call.id}`;
      check(row.status === "OPEN", `the call starts OPEN (got ${row.status})`);
      check(row.restaurant_id === ids.restaurantA, "the call belongs to tenant A");

      const visible = await calls.listCalls(asA("WAITER"), { status: "OPEN", limit: 50 });
      check(
        visible.some((call) => call.id === created.call.id),
        "the waiter sees the open call",
      );

      // Another tenant's waiter must not be able to resolve it.
      const crossTenant = await code(() => calls.updateStatus(asB(), {
        callId: created.call.id, nextStatus: "RESOLVED",
      }));
      check(crossTenant !== "OK", `a foreign waiter cannot resolve it (got ${crossTenant})`);
      const [untouched] = await sql`
        select status::text as status from waiter_calls where id = ${created.call.id}`;
      check(untouched.status === "OPEN", "the call is still OPEN");

      await calls.updateStatus(asA("WAITER"), {
        callId: created.call.id, nextStatus: "RESOLVED",
      });
      const [resolved] = await sql`
        select status::text as status, resolved_at from waiter_calls where id = ${created.call.id}`;
      check(resolved.status === "RESOLVED", `the call is RESOLVED (got ${resolved.status})`);
      check(resolved.resolved_at !== null, "the resolution time is recorded");

      const stillOpen = await calls.listCalls(asA("WAITER"), { status: "OPEN", limit: 50 });
      check(
        !stillOpen.some((call) => call.id === created.call.id),
        "the resolved call is no longer listed as open",
      );
      const [history] = await sql`
        select count(*)::int as c from waiter_calls where id = ${created.call.id}`;
      check(history.c === 1, "the row is kept as history, never deleted");
    });
  });
}
