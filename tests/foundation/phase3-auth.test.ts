import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { createLegacyStaffContext } from "../../lib/auth/legacy-context";
import { selectStaffAuthProvider } from "../../lib/auth/provider-selection";
import {
  canAccessPanel,
  staffHomeForRole,
} from "../../lib/auth/role-access";

test("Supabase is authoritative whenever its complete public config exists", () => {
  assert.equal(
    selectStaffAuthProvider({
      supabaseUrl: "https://example.supabase.co",
      supabasePublishableKey: "publishable-key-for-test",
    }),
    "SUPABASE",
  );
  assert.equal(selectStaffAuthProvider(null), "LEGACY_HMAC");
});
test("panel role matrix enforces distinct waiter, kitchen and cashier access", () => {
  assert.equal(canAccessPanel("WAITER", "staff"), true);
  assert.equal(canAccessPanel("WAITER", "admin"), false);
  assert.equal(canAccessPanel("WAITER", "kitchen"), false);
  assert.equal(canAccessPanel("KITCHEN", "kitchen"), true);
  assert.equal(canAccessPanel("KITCHEN", "cashier"), false);
  assert.equal(canAccessPanel("KITCHEN", "admin"), false);
  assert.equal(canAccessPanel("CASHIER", "cashier"), true);
  assert.equal(canAccessPanel("CASHIER", "kitchen"), false);
  assert.equal(canAccessPanel("CASHIER", "admin"), false);
});

test("admin and manager can access every current panel area", () => {
  for (const role of ["ADMIN", "MANAGER"] as const) {
    assert.equal(canAccessPanel(role, "admin"), true);
    assert.equal(canAccessPanel(role, "staff"), true);
    assert.equal(canAccessPanel(role, "kitchen"), true);
    assert.equal(canAccessPanel(role, "cashier"), true);
  }
});

test("role homes avoid unauthorized redirect loops", () => {
  assert.equal(staffHomeForRole("ADMIN"), "/admin/dashboard");
  assert.equal(staffHomeForRole("MANAGER"), "/admin/dashboard");
  assert.equal(staffHomeForRole("WAITER"), "/staff/dashboard");
  assert.equal(staffHomeForRole("KITCHEN"), "/kitchen");
  assert.equal(staffHomeForRole("CASHIER"), "/cashier");
});

test("legacy context is explicitly unscoped and cannot impersonate a DB tenant", () => {
  const admin = createLegacyStaffContext("admin");
  const waiter = createLegacyStaffContext("staff");

  assert.deepEqual(
    {
      provider: admin.authProvider,
      authUserId: admin.authUserId,
      restaurantId: admin.restaurantId,
      role: admin.role,
      name: admin.name,
    },
    {
      provider: "LEGACY_HMAC",
      authUserId: null,
      restaurantId: null,
      role: "ADMIN",
      // A synthesised identity carries a role label, never a real person's
      // name — naming one here would misattribute whatever it does.
      name: "Yönetici",
    },
  );
  assert.equal(waiter.restaurantId, null);
  assert.equal(waiter.role, "WAITER");
});

/**
 * A legacy session carries no restaurant, so letting one reach a tenant-scoped
 * API would hand every service a null restaurantId. The shape test above only
 * proves the context is unscoped; this one pins the refusal that keeps it out.
 */
test("tenant-scoped APIs refuse every non-Supabase provider", () => {
  const source = readFileSync(
    path.join(process.cwd(), "lib/auth/current-staff.ts"),
    "utf8",
  );
  const body = source.slice(source.indexOf("export async function requireCurrentStaffPrincipal"));
  assert.ok(body, "requireCurrentStaffPrincipal must exist");

  // Fail-closed: anything that is not a resolved Supabase principal is rejected
  // before roles are consulted, so a legacy cookie cannot reach a service call.
  assert.match(body, /authProvider !== "SUPABASE"/);
  assert.match(body, /throw authenticationRequiredError\(\)/);
  assert.ok(
    body.indexOf('authProvider !== "SUPABASE"') < body.indexOf("requireRole("),
    "the provider refusal must run before the role check",
  );
});
