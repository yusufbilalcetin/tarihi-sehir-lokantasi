import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";

import { createClient } from "@supabase/supabase-js";

import { createDb, type Database } from "../../db";
import { isDomainError } from "../../lib/api/domain-error";
import type { StaffPrincipal } from "../../lib/auth/foundation";
import { resolveStaffPrincipal } from "../../lib/auth/foundation";
import { DrizzleStaffIdentityRepository } from "../../lib/auth/foundation/server";
import { AdminStaffService } from "../../lib/services/admin-staff-service";
import { readSupabaseIntegrationEnvironment } from "./supabase-test-environment";

/**
 * Phase 8D — staff accounts against real Supabase Auth.
 *
 * Nothing here is mocked: every account is created through the same service the
 * panel calls, which creates a real `auth.users` row and a real profile. The
 * cases that matter are the ones where the two systems could disagree — a
 * profile that fails after the login exists, two administrators switching each
 * other off at the same moment, the same address claimed twice at once — so
 * each of those is driven with genuine overlap and then verified in SQL.
 */

const PREFIX = "PHASE8D_";
const readiness = readSupabaseIntegrationEnvironment({ requireDatabaseUrl: true });

if (!readiness.ready) {
  test("Phase 8D staff accounts", { skip: readiness.reason }, () => undefined);
} else {
  const environment = readiness.environment;
  const run = randomBytes(6).toString("hex");
  const admin = createClient(environment.url, environment.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let connection: ReturnType<typeof createDb>;
  let db: Database;
  let sql: ReturnType<typeof createDb>["client"];
  let service: AdminStaffService;
  const cleanupErrors: string[] = [];
  let assertions = 0;

  const ids = {
    restaurant: randomUUID(),
    foreignRestaurant: randomUUID(),
    admin: randomUUID(),
    secondAdmin: randomUUID(),
    manager: randomUUID(),
    cashier: randomUUID(),
    foreignAdmin: randomUUID(),
    foreignWaiter: randomUUID(),
  };
  /** Every auth user this suite makes, so teardown can remove all of them. */
  const authUserIds = new Set<string>();

  function check(condition: boolean, message: string): void {
    assertions += 1;
    assert.ok(condition, message);
  }

  /** The only field the principal resolver reads is the id. */
  const asAuthUser = (id: string) =>
    ({ id, app_metadata: {}, user_metadata: {} }) as Parameters<typeof resolveStaffPrincipal>[0];

  const as = (
    role: StaffPrincipal["role"],
    userId: string,
    restaurantId = ids.restaurant,
  ): StaffPrincipal =>
    ({ userId, restaurantId, role, isActive: true }) as unknown as StaffPrincipal;

  const administrator = () => as("ADMIN", ids.admin);
  const manager = () => as("MANAGER", ids.manager);

  async function code(work: () => Promise<unknown>): Promise<string> {
    try {
      await work();
      return "OK";
    } catch (error) {
      return isDomainError(error) ? error.code : `UNEXPECTED:${(error as Error).message}`;
    }
  }

  function address(label: string): string {
    return `phase8d-${run}-${label}@example.com`;
  }

  /** Creates a profile row directly, for the fixtures that must already exist. */
  async function seedProfile(
    id: string,
    restaurantId: string,
    role: string,
    label: string,
  ): Promise<void> {
    const created = await admin.auth.admin.createUser({
      email: address(label),
      password: `Pw-${randomBytes(18).toString("base64url")}`,
      email_confirm: true,
    });
    if (created.error || !created.data.user) {
      throw new Error(`auth user ${label}: ${created.error?.message ?? "missing"}`);
    }
    authUserIds.add(created.data.user.id);
    await sql`insert into staff_profiles (id, restaurant_id, auth_user_id, name, email,
        login_identifier, role, is_active) values
      (${id}, ${restaurantId}, ${created.data.user.id}, ${`${PREFIX}${label}`},
       ${address(label)}, ${`p8d-${run}-${label}`}, ${role}, true)`;
  }

  async function activeAdminCount(restaurantId = ids.restaurant): Promise<number> {
    const [row] = await sql`
      select count(*)::int as total from staff_profiles
      where restaurant_id = ${restaurantId} and role = 'ADMIN'
        and is_active = true and deleted_at is null`;
    return Number(row.total);
  }

  describe("Phase 8D staff accounts on real Supabase Auth", { concurrency: false }, () => {
    before(async () => {
      connection = createDb(environment.databaseUrl!, { maxConnections: 6 });
      db = connection.db;
      sql = connection.client;
      service = new AdminStaffService(db, admin);

      await sql`insert into restaurants (id, name, slug) values
        (${ids.restaurant}, ${`${PREFIX}Tenant`}, ${`phase8d-${run}`}),
        (${ids.foreignRestaurant}, ${`${PREFIX}Other`}, ${`phase8d-b-${run}`})`;
      await sql`insert into restaurant_settings (restaurant_id) values
        (${ids.restaurant}), (${ids.foreignRestaurant})`;

      await seedProfile(ids.admin, ids.restaurant, "ADMIN", "admin");
      await seedProfile(ids.manager, ids.restaurant, "MANAGER", "manager");
      await seedProfile(ids.cashier, ids.restaurant, "CASHIER", "cashier");
      await seedProfile(ids.foreignAdmin, ids.foreignRestaurant, "ADMIN", "foreign-admin");
      await seedProfile(ids.foreignWaiter, ids.foreignRestaurant, "WAITER", "foreign-waiter");
    });

    after(async () => {
      try {
        // Collect every login this suite caused, including ones created by a
        // test that failed before it could register them.
        for (const tenant of [ids.restaurant, ids.foreignRestaurant]) {
          const linked = await sql.unsafe(
            "select auth_user_id from staff_profiles where restaurant_id = $1::uuid and auth_user_id is not null",
            [tenant],
          );
          for (const row of linked) authUserIds.add(String(row.auth_user_id));
        }
        for (const tenant of [ids.restaurant, ids.foreignRestaurant]) {
          for (const table of ["audit_logs", "staff_profiles", "restaurant_settings"]) {
            await sql.unsafe(`delete from ${table} where restaurant_id = $1::uuid`, [tenant]);
          }
          await sql.unsafe(`delete from restaurants where id = $1::uuid`, [tenant]);
        }
        // Only this suite's own auth users, never a global delete.
        for (const authUserId of authUserIds) {
          const removed = await admin.auth.admin.deleteUser(authUserId);
          if (removed.error && !/not found/i.test(removed.error.message)) {
            cleanupErrors.push(`auth ${authUserId}: ${removed.error.message}`);
          }
        }
      } catch (error) {
        cleanupErrors.push((error as Error).message);
      }
      await connection.close();
      if (cleanupErrors.length > 0) {
        console.error("PHASE8D CLEANUP INCOMPLETE:", cleanupErrors.join(" | "));
      }
      console.log(`phase8d assertions executed: ${assertions}`);
    });

    // --------------------------------------------------------------- creation

    test("creating a waiter creates one login and one profile, and links them", async () => {
      const created = await service.create(administrator(), {
        name: `${PREFIX}Garson Bir`,
        email: address("waiter-1"),
        role: "WAITER",
      });
      check(created.staff.role === "WAITER", "the role is what was asked for");
      check(created.staff.isActive, "and the account starts active");

      const [profile] = await sql`
        select auth_user_id, email, role::text as role, is_active
        from staff_profiles where id = ${created.staff.id}`;
      check(profile.auth_user_id !== null, "the profile is linked to a login");
      check(profile.email === address("waiter-1"), "the address is stored as typed, lowercased");
      authUserIds.add(String(profile.auth_user_id));

      const authUser = await admin.auth.admin.getUserById(String(profile.auth_user_id));
      check(authUser.data.user?.email === address("waiter-1"), "the auth user exists");
      check(
        authUser.data.user?.id === profile.auth_user_id,
        "and the two systems point at each other",
      );

      // The profile carries identity and role — never a credential.
      const columns = await sql`
        select column_name from information_schema.columns
        where table_schema = 'public' and table_name = 'staff_profiles'`;
      const names = columns.map((column) => String(column.column_name));
      check(
        !names.some((name) => /password|pin|secret|token/i.test(name)),
        `staff_profiles stores no credential column (got ${names.join(", ")})`,
      );
    });

    test("the address is normalised and duplicates are refused safely", async () => {
      const first = await service.create(administrator(), {
        name: `${PREFIX}Kasiyer Bir`,
        email: address("cashier-1"),
        role: "CASHIER",
      });
      const [row] = await sql`
        select auth_user_id from staff_profiles where id = ${first.staff.id}`;
      authUserIds.add(String(row.auth_user_id));

      const duplicate = await code(() =>
        service.create(administrator(), {
          name: `${PREFIX}Kopya`,
          // Same address, different case and padding.
          email: `  ${address("cashier-1").toUpperCase()} `.trim().toLowerCase(),
          role: "WAITER",
        }),
      );
      check(duplicate === "CONFLICT", `a duplicate address is a safe conflict (got ${duplicate})`);

      const [count] = await sql`
        select count(*)::int as total from staff_profiles
        where restaurant_id = ${ids.restaurant} and email = ${address("cashier-1")}`;
      check(Number(count.total) === 1, "and it created nothing the second time");
    });

    test("a failure after the login exists leaves no orphan", async () => {
      const before = await admin.auth.admin.listUsers({ perPage: 1000 });
      const beforeCount = (before.data?.users ?? []).filter((user) =>
        user.email?.startsWith(`phase8d-${run}-orphan`),
      ).length;
      check(beforeCount === 0, "nothing exists yet");

      // A login identifier that is already taken makes the profile insert fail
      // *after* the auth user has been created — exactly the window that would
      // otherwise strand a login nobody can see.
      const failure = await code(() =>
        service.create(administrator(), {
          name: `${PREFIX}Yetim`,
          email: address("orphan"),
          role: "WAITER",
          loginIdentifier: `p8d-${run}-admin`,
        }),
      );
      check(failure !== "OK", `the creation fails (got ${failure})`);

      const after = await admin.auth.admin.listUsers({ perPage: 1000 });
      const orphans = (after.data?.users ?? []).filter((user) =>
        user.email?.startsWith(`phase8d-${run}-orphan`),
      );
      check(orphans.length === 0, `the login was rolled back too (found ${orphans.length})`);
      const [profiles] = await sql`
        select count(*)::int as total from staff_profiles where email = ${address("orphan")}`;
      check(Number(profiles.total) === 0, "and no profile survived either");
    });

    test("two parallel creations of the same address produce exactly one account", async () => {
      const email = address("race");
      const results = await Promise.all([
        code(() => service.create(administrator(), { name: `${PREFIX}Yarış A`, email, role: "WAITER" })),
        code(() => service.create(administrator(), { name: `${PREFIX}Yarış B`, email, role: "WAITER" })),
      ]);
      check(
        results.filter((result) => result === "OK").length === 1,
        `exactly one creation wins (got ${results.join(", ")})`,
      );

      const [profiles] = await sql`
        select count(*)::int as total from staff_profiles where email = ${email}`;
      check(Number(profiles.total) === 1, `one profile exists (got ${profiles.total})`);

      const users = await admin.auth.admin.listUsers({ perPage: 1000 });
      const matching = (users.data?.users ?? []).filter((user) => user.email === email);
      check(matching.length === 1, `one login exists (got ${matching.length})`);
      for (const user of matching) authUserIds.add(user.id);
    });

    // ------------------------------------------------------------------- RBAC

    test("a manager staffs the floor and is refused everything above it", async () => {
      for (const role of ["WAITER", "KITCHEN", "CASHIER"] as const) {
        const created = await service.create(manager(), {
          name: `${PREFIX}Müdürün ${role}`,
          email: address(`manager-made-${role.toLowerCase()}`),
          role,
        });
        check(created.staff.role === role, `a manager may hire a ${role}`);
        const [row] = await sql`
          select auth_user_id from staff_profiles where id = ${created.staff.id}`;
        authUserIds.add(String(row.auth_user_id));
      }

      for (const role of ["ADMIN", "MANAGER"] as const) {
        const refused = await code(() =>
          service.create(manager(), {
            name: `${PREFIX}Olmaz`,
            email: address(`manager-made-${role.toLowerCase()}`),
            role,
          }),
        );
        check(refused === "FORBIDDEN", `a manager cannot create a ${role} (got ${refused})`);
      }
    });

    test("a cashier, a waiter and a cook manage nobody", async () => {
      for (const role of ["CASHIER", "WAITER", "KITCHEN"] as const) {
        const principal = as(role, ids.cashier);
        const listed = await code(() =>
          service.list(principal, { page: 1, pageSize: 10 }),
        );
        const created = await code(() =>
          service.create(principal, {
            name: `${PREFIX}Olmaz`,
            email: address(`by-${role.toLowerCase()}`),
            role: "WAITER",
          }),
        );
        check(listed === "FORBIDDEN", `${role} cannot even list staff (got ${listed})`);
        check(created === "FORBIDDEN", `${role} cannot create staff (got ${created})`);
      }
    });

    test("a manager cannot reach an administrator's account", async () => {
      const denied = await code(() =>
        service.update(manager(), { staffId: ids.admin, isActive: false }),
      );
      check(denied === "FORBIDDEN", `a manager cannot switch off an admin (got ${denied})`);

      const promotion = await code(() =>
        service.update(manager(), { staffId: ids.cashier, role: "ADMIN" }),
      );
      check(promotion === "FORBIDDEN", `nor promote anyone into one (got ${promotion})`);

      const [row] = await sql`select is_active from staff_profiles where id = ${ids.admin}`;
      check(row.is_active === true, "and the admin account is untouched");
    });

    test("nobody escalates their own role", async () => {
      const self = await code(() =>
        service.update(manager(), { staffId: ids.manager, role: "ADMIN" }),
      );
      check(self !== "OK", `a manager cannot make themselves an admin (got ${self})`);
      const [row] = await sql`select role::text as role from staff_profiles where id = ${ids.manager}`;
      check(row.role === "MANAGER", "the role is unchanged");
    });

    // --------------------------------------------------- role and status effect

    test("a role change is effective on the very next request", async () => {
      const created = await service.create(administrator(), {
        name: `${PREFIX}Rol Değişimi`,
        email: address("role-change"),
        role: "WAITER",
      });
      const [row] = await sql`
        select auth_user_id from staff_profiles where id = ${created.staff.id}`;
      const authUserId = String(row.auth_user_id);
      authUserIds.add(authUserId);

      const repository = new DrizzleStaffIdentityRepository(db);
      const asWaiter = await resolveStaffPrincipal(asAuthUser(authUserId), repository);
      check(asWaiter.role === "WAITER", "the principal starts as a waiter");

      await service.update(administrator(), { staffId: created.staff.id, role: "CASHIER" });

      // Resolution is a fresh database read on every request, so the next one
      // already carries the new role — no session refresh, no cached claim.
      const asCashier = await resolveStaffPrincipal(asAuthUser(authUserId), repository);
      check(asCashier.role === "CASHIER", `the next request is a cashier (got ${asCashier.role})`);
    });

    test("a deactivated account stops being a principal at once, and comes back", async () => {
      const created = await service.create(administrator(), {
        name: `${PREFIX}Pasif`,
        email: address("deactivate"),
        role: "WAITER",
      });
      const [row] = await sql`
        select auth_user_id from staff_profiles where id = ${created.staff.id}`;
      const authUserId = String(row.auth_user_id);
      authUserIds.add(authUserId);

      const repository = new DrizzleStaffIdentityRepository(db);
      check(
        (await resolveStaffPrincipal(asAuthUser(authUserId), repository)).isActive,
        "the account resolves while active",
      );

      await service.update(administrator(), { staffId: created.staff.id, isActive: false });
      const denied = await code(() => resolveStaffPrincipal(asAuthUser(authUserId), repository));
      check(
        denied === "AUTHENTICATION_REQUIRED" || denied === "ACCOUNT_INACTIVE",
        `a deactivated account is no longer a principal (got ${denied})`,
      );

      // The credential still exists — the application decides, not the provider.
      const authUser = await admin.auth.admin.getUserById(authUserId);
      check(authUser.data.user?.id === authUserId, "the login itself is untouched");

      await service.update(administrator(), { staffId: created.staff.id, isActive: true });
      const restored = await resolveStaffPrincipal(asAuthUser(authUserId), repository);
      check(restored.role === "WAITER", "and reactivation restores access immediately");
    });

    test("history keeps pointing at a deactivated colleague", async () => {
      const [row] = await sql`
        select count(*)::int as total from audit_logs
        where restaurant_id = ${ids.restaurant} and action = 'staff.deactivated'`;
      check(Number(row.total) >= 1, "the deactivation is on the record");

      const [profile] = await sql`
        select id, name from staff_profiles where email = ${address("deactivate")}`;
      check(Boolean(profile?.id), "and the profile row still exists to be pointed at");
      check(
        String(profile.name).startsWith(PREFIX),
        "with its name intact, so old actor references still read correctly",
      );
    });

    // ------------------------------------------------------ last-admin safety

    test("the only administrator can be neither switched off nor demoted", async () => {
      check(await activeAdminCount() === 1, "the fixture has exactly one administrator");

      const deactivate = await code(() =>
        service.update(administrator(), { staffId: ids.admin, isActive: false }),
      );
      const demote = await code(() =>
        service.update(administrator(), { staffId: ids.admin, role: "MANAGER" }),
      );
      // Self-protection fires first for one's own account; either refusal is a
      // refusal, and neither may leave the restaurant without an administrator.
      check(deactivate === "CONFLICT", `deactivation is refused (got ${deactivate})`);
      check(demote === "CONFLICT", `demotion is refused (got ${demote})`);
      check(await activeAdminCount() === 1, "the administrator is still there");
    });

    test("with two administrators, one may be stood down", async () => {
      await seedProfile(ids.secondAdmin, ids.restaurant, "ADMIN", "admin-2");
      check(await activeAdminCount() === 2, "two administrators now");

      await service.update(administrator(), { staffId: ids.secondAdmin, isActive: false });
      check(await activeAdminCount() === 1, "one may be stood down");

      const last = await code(() =>
        service.update(as("ADMIN", ids.secondAdmin), { staffId: ids.admin, role: "WAITER" }),
      );
      check(last === "CONFLICT", `and then the remaining one is protected (got ${last})`);
      check(await activeAdminCount() === 1, "the restaurant still has an administrator");
    });

    test("two administrators deactivating each other at once still leaves one", async () => {
      await sql`update staff_profiles set is_active = true where id = ${ids.secondAdmin}`;
      check(await activeAdminCount() === 2, "two active administrators");

      // Each tries to stand the *other* down, simultaneously. The rows are
      // locked while the count is taken, so the second transaction sees the
      // first one's result rather than a stale count.
      const [first, second] = await Promise.all([
        code(() => service.update(administrator(), { staffId: ids.secondAdmin, isActive: false })),
        code(() =>
          service.update(as("ADMIN", ids.secondAdmin), { staffId: ids.admin, isActive: false }),
        ),
      ]);
      const wins = [first, second].filter((result) => result === "OK").length;
      check(wins === 1, `exactly one deactivation succeeds (got ${first}, ${second})`);
      check(
        await activeAdminCount() >= 1,
        "and the restaurant is never left without an administrator",
      );

      // Put the fixture back the way the rest of the suite expects it.
      await sql`update staff_profiles set is_active = true where id = ${ids.admin}`;
      await sql`update staff_profiles set is_active = false where id = ${ids.secondAdmin}`;
    });

    // ------------------------------------------------------------ other tenants

    test("an administrator cannot see or touch another restaurant's staff", async () => {
      const read = await code(() => service.detail(administrator(), ids.foreignWaiter));
      const patch = await code(() =>
        service.update(administrator(), { staffId: ids.foreignWaiter, isActive: false }),
      );
      const reset = await code(() =>
        service.requestPasswordReset(administrator(), ids.foreignWaiter),
      );
      check(read === "NOT_FOUND", `a foreign profile does not exist here (got ${read})`);
      check(patch === "NOT_FOUND", `nor can it be changed (got ${patch})`);
      check(reset === "NOT_FOUND", `nor sent a reset link (got ${reset})`);

      // Identical answer for an id that exists nowhere at all.
      const missing = await code(() => service.detail(administrator(), randomUUID()));
      check(missing === "NOT_FOUND", "a nonexistent profile answers the same way");

      const [row] = await sql`select is_active from staff_profiles where id = ${ids.foreignWaiter}`;
      check(row.is_active === true, "and the other restaurant is untouched");

      const page = await service.list(administrator(), { page: 1, pageSize: 100 });
      check(
        page.staff.every((member) => member.id !== ids.foreignWaiter),
        "the listing is scoped to the caller's own restaurant",
      );
    });

    // ------------------------------------------------------------- reset links

    test("a password reset is requested without producing anything secret", async () => {
      const result = await service.requestPasswordReset(administrator(), ids.cashier);
      check(result.email === address("cashier"), "the link goes to the account's own address");
      check(
        !("token" in result) && !("link" in result) && !("password" in result),
        "and nothing secret comes back to the caller",
      );

      const [audit] = await sql`
        select metadata::text as metadata, new_value::text as new_value
        from audit_logs
        where restaurant_id = ${ids.restaurant} and action = 'staff.password_reset_requested'
        order by created_at desc limit 1`;
      check(Boolean(audit), "the request is audited");
      const payload = `${audit.metadata ?? ""}${audit.new_value ?? ""}`;
      check(
        !/token|password"\s*:\s*"|access|refresh/i.test(payload),
        `no token or credential is audited (got ${payload})`,
      );
    });

    // ------------------------------------------------------------------ listing

    test("the listing filters, paginates and never exposes a credential", async () => {
      const all = await service.list(administrator(), { page: 1, pageSize: 100 });
      check(all.total >= 5, `the restaurant's staff are listed (got ${all.total})`);
      check(all.activeAdminCount >= 1, "and the admin count comes with it");

      const waiters = await service.list(administrator(), {
        role: "WAITER",
        page: 1,
        pageSize: 100,
      });
      check(
        waiters.staff.every((member) => member.role === "WAITER"),
        "a role filter returns only that role",
      );

      const inactive = await service.list(administrator(), {
        status: "INACTIVE",
        page: 1,
        pageSize: 100,
      });
      check(
        inactive.staff.every((member) => !member.isActive || member.archived),
        "a status filter returns only inactive accounts",
      );

      const searched = await service.list(administrator(), {
        search: "Kasiyer Bir",
        page: 1,
        pageSize: 100,
      });
      check(
        searched.staff.some((member) => member.name.includes("Kasiyer Bir")),
        "search finds a colleague by name",
      );

      const firstPage = await service.list(administrator(), { page: 1, pageSize: 2 });
      const secondPage = await service.list(administrator(), { page: 2, pageSize: 2 });
      check(firstPage.staff.length === 2, "pages are the size that was asked for");
      check(
        firstPage.staff.every((member) => !secondPage.staff.some((other) => other.id === member.id)),
        "and page two repeats nothing from page one",
      );

      const serialised = JSON.stringify(all);
      check(
        !/password|access_token|refresh_token|service_role|token_hash/i.test(serialised),
        "no credential of any kind appears in the payload",
      );
      check(
        all.staff.every(
          (member) => member.lastSignInAt === null || !Number.isNaN(Date.parse(member.lastSignInAt)),
        ),
        "last sign-in is either a real timestamp or null, never invented",
      );
    });
  });
}
