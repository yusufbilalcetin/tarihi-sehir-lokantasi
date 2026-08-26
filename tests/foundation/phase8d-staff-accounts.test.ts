import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  MANAGER_ASSIGNABLE_ROLES,
  STAFF_REFUSAL_MESSAGES,
  STAFF_ROLE_LABELS,
  assignableRoles,
  canActOnRole,
  canManageStaff,
  checkStaffCreation,
  checkStaffUpdate,
  isUserRole,
  normalizeStaffEmail,
} from "../../lib/domain/staff-accounts";
import { USER_ROLES, type UserRole } from "../../lib/domain/status";
import {
  createStaffBodySchema,
  staffListQuerySchema,
  updateStaffBodySchema,
} from "../../lib/validation/admin-staff";

/**
 * Phase 8D — who may hire, promote and switch off whom.
 *
 * These rules decide whether a restaurant can be locked out of its own admin
 * panel, and whether a floor manager can quietly promote themselves. They are
 * pure, so they are settled here rather than discovered in production.
 */

const ADMIN = "admin-1";
const OTHER = "staff-2";

function subject(role: UserRole, overrides: Partial<{ staffId: string; isActive: boolean }> = {}) {
  return { staffId: OTHER, role, isActive: true, ...overrides };
}

// ------------------------------------------------------------- the role matrix

test("only ADMIN and MANAGER have any account-management surface at all", () => {
  assert.equal(canManageStaff("ADMIN"), true);
  assert.equal(canManageStaff("MANAGER"), true);
  for (const role of ["WAITER", "KITCHEN", "CASHIER"] as const) {
    assert.equal(canManageStaff(role), false, `${role} manages nobody`);
    assert.deepEqual(assignableRoles(role), []);
    assert.equal(
      checkStaffCreation(role, "WAITER").reason,
      "NOT_A_MANAGER_ROLE",
      `${role} cannot create an account`,
    );
  }
});

test("an administrator may act on every role, including another administrator", () => {
  for (const role of USER_ROLES) {
    assert.equal(canActOnRole("ADMIN", role), true);
    assert.equal(checkStaffCreation("ADMIN", role).allowed, true);
  }
  assert.deepEqual([...assignableRoles("ADMIN")], [...USER_ROLES]);
});

test("a manager staffs the floor and nothing above it", () => {
  for (const role of MANAGER_ASSIGNABLE_ROLES) {
    assert.equal(canActOnRole("MANAGER", role), true, `a manager may hire a ${role}`);
    assert.equal(checkStaffCreation("MANAGER", role).allowed, true);
  }
  // The two that would let them manage their own management.
  for (const role of ["ADMIN", "MANAGER"] as const) {
    assert.equal(canActOnRole("MANAGER", role), false);
    assert.equal(
      checkStaffCreation("MANAGER", role).reason,
      "MANAGER_CANNOT_ASSIGN_SUPERVISOR",
      `a manager cannot create a ${role}`,
    );
  }
  assert.deepEqual([...assignableRoles("MANAGER")], ["WAITER", "KITCHEN", "CASHIER"]);
});

test("a manager cannot reach an existing supervisor in any direction", () => {
  const actor = { role: "MANAGER" as const, staffId: "manager-1" };
  const plenty = 5;
  // Not to rename, not to switch off, not to demote.
  for (const intent of [{ nextActive: false }, { nextRole: "WAITER" as const }, {}]) {
    assert.equal(
      checkStaffUpdate(actor, subject("ADMIN"), intent, plenty).reason,
      "MANAGER_CANNOT_TOUCH_SUPERVISOR",
    );
    assert.equal(
      checkStaffUpdate(actor, subject("MANAGER"), intent, plenty).reason,
      "MANAGER_CANNOT_TOUCH_SUPERVISOR",
    );
  }
  // And cannot promote a waiter into one either.
  assert.equal(
    checkStaffUpdate(actor, subject("WAITER"), { nextRole: "ADMIN" }, plenty).reason,
    "MANAGER_CANNOT_ASSIGN_SUPERVISOR",
  );
  assert.equal(
    checkStaffUpdate(actor, subject("WAITER"), { nextRole: "CASHIER" }, plenty).allowed,
    true,
    "a waiter may still be moved to the till",
  );
});

// ---------------------------------------------------------- self-modification

test("nobody promotes or demotes themselves", () => {
  const actor = { role: "ADMIN" as const, staffId: ADMIN };
  const self = subject("ADMIN", { staffId: ADMIN });
  assert.equal(checkStaffUpdate(actor, self, { nextRole: "WAITER" }, 5).reason, "SELF_ROLE_CHANGE");
  assert.equal(
    checkStaffUpdate(actor, self, { nextRole: "ADMIN" }, 5).allowed,
    true,
    "re-stating the role you already hold changes nothing",
  );
});

test("nobody switches their own account off", () => {
  const actor = { role: "ADMIN" as const, staffId: ADMIN };
  assert.equal(
    checkStaffUpdate(actor, subject("ADMIN", { staffId: ADMIN }), { nextActive: false }, 5).reason,
    "SELF_DEACTIVATION",
  );
  // A manager locking themselves out of their own floor is the same mistake.
  assert.equal(
    checkStaffUpdate(
      { role: "MANAGER", staffId: "m-1" },
      subject("MANAGER", { staffId: "m-1" }),
      { nextActive: false },
      5,
    ).allowed,
    false,
  );
});

// ------------------------------------------------------- last-admin protection

test("the last active administrator cannot be switched off or demoted, by anyone", () => {
  const actor = { role: "ADMIN" as const, staffId: ADMIN };
  const lastAdmin = subject("ADMIN");
  assert.equal(checkStaffUpdate(actor, lastAdmin, { nextActive: false }, 1).reason, "LAST_ADMIN");
  assert.equal(checkStaffUpdate(actor, lastAdmin, { nextRole: "MANAGER" }, 1).reason, "LAST_ADMIN");
  assert.equal(checkStaffUpdate(actor, lastAdmin, { nextRole: "WAITER" }, 1).reason, "LAST_ADMIN");

  // With a second administrator in place, the same change is fine.
  assert.equal(checkStaffUpdate(actor, lastAdmin, { nextActive: false }, 2).allowed, true);
  assert.equal(checkStaffUpdate(actor, lastAdmin, { nextRole: "MANAGER" }, 2).allowed, true);
});

test("the protection is about losing an admin, not about touching one", () => {
  const actor = { role: "ADMIN" as const, staffId: ADMIN };
  // Renaming the last admin, or re-activating them, is not a loss.
  assert.equal(checkStaffUpdate(actor, subject("ADMIN"), {}, 1).allowed, true);
  assert.equal(checkStaffUpdate(actor, subject("ADMIN"), { nextActive: true }, 1).allowed, true);
  // Nor is switching off an admin who is already inactive.
  assert.equal(
    checkStaffUpdate(actor, subject("ADMIN", { isActive: false }), { nextActive: false }, 1).allowed,
    true,
  );
  // And a waiter is never protected by it.
  assert.equal(checkStaffUpdate(actor, subject("WAITER"), { nextActive: false }, 1).allowed, true);
});

test("every refusal has a message that explains the rule", () => {
  for (const reason of Object.keys(STAFF_REFUSAL_MESSAGES) as (keyof typeof STAFF_REFUSAL_MESSAGES)[]) {
    const message = STAFF_REFUSAL_MESSAGES[reason];
    assert.ok(message.length > 20, `${reason} needs a real sentence`);
    // Never leak an internal reason code to the operator's screen.
    assert.ok(!message.includes("_"), `${reason} message must not contain the code itself`);
  }
});

// --------------------------------------------------------------- role labels

test("every role has a Turkish label, and the two supervisory ones are spelled out", () => {
  for (const role of USER_ROLES) {
    assert.ok(STAFF_ROLE_LABELS[role]?.length > 0, `${role} needs a label`);
  }
  assert.equal(STAFF_ROLE_LABELS.ADMIN, "Sistem Yöneticisi");
  assert.equal(STAFF_ROLE_LABELS.MANAGER, "İşletme Müdürü");
  assert.equal(STAFF_ROLE_LABELS.WAITER, "Garson");
  assert.equal(STAFF_ROLE_LABELS.KITCHEN, "Mutfak");
  assert.equal(STAFF_ROLE_LABELS.CASHIER, "Kasiyer");
  // Labels are distinct, or the panel would show two identical options.
  assert.equal(new Set(Object.values(STAFF_ROLE_LABELS)).size, USER_ROLES.length);
});

test("only the five known roles exist", () => {
  assert.deepEqual([...USER_ROLES], ["ADMIN", "MANAGER", "WAITER", "KITCHEN", "CASHIER"]);
  assert.equal(isUserRole("OWNER"), false);
  assert.equal(isUserRole("admin"), false, "the enum is case-sensitive");
});

// ---------------------------------------------------------------- validation

test("an email is trimmed, lowercased and actually an address", () => {
  assert.equal(normalizeStaffEmail("  Selin@Ornek.COM "), "selin@ornek.com");
  for (const invalid of ["", "   ", "selin", "selin@", "@ornek.com", "selin@ornek", "a b@c.com"]) {
    assert.equal(normalizeStaffEmail(invalid), null, `${JSON.stringify(invalid)} is not an address`);
  }
  assert.equal(normalizeStaffEmail(`${"a".repeat(250)}@ornek.com`), null, "and it has a length");
});

test("no staff schema accepts a password, a token or a restaurant", () => {
  const forbidden = {
    password: "hunter2hunter2",
    passwordHash: "x",
    pin: "1234",
    restaurantId: "11111111-1111-4111-8111-111111111111",
    authUserId: "11111111-1111-4111-8111-111111111111",
    isActive: true,
  };
  for (const [field, value] of Object.entries(forbidden)) {
    const created = createStaffBodySchema.safeParse({
      name: "Selin",
      email: "selin@ornek.com",
      role: "WAITER",
      [field]: value,
    });
    assert.equal(created.success, false, `create must reject ${field}`);
  }
  for (const field of ["password", "pin", "restaurantId", "authUserId", "role_"] as const) {
    const updated = updateStaffBodySchema.safeParse({ name: "Selin", [field]: "x" });
    assert.equal(updated.success, false, `update must reject ${field}`);
  }
  // The list query is strict for the same reason: the tenant is the session's.
  assert.equal(
    staffListQuerySchema.safeParse({ restaurantId: "abc" }).success,
    false,
    "a tenant on the query string is refused outright",
  );
});

test("the create schema normalises what it accepts", () => {
  const parsed = createStaffBodySchema.parse({
    name: "  Selin Aksoy  ",
    email: "  Selin@Ornek.COM ",
    role: "CASHIER",
  });
  assert.equal(parsed.name, "Selin Aksoy");
  assert.equal(parsed.email, "selin@ornek.com");
  assert.equal(createStaffBodySchema.safeParse({ name: "", email: "a@b.co", role: "WAITER" }).success, false);
  assert.equal(createStaffBodySchema.safeParse({ name: "A", email: "a@b.co", role: "OWNER" }).success, false);
});

test("an update must actually change something", () => {
  assert.equal(updateStaffBodySchema.safeParse({}).success, false);
  assert.equal(updateStaffBodySchema.safeParse({ isActive: false }).success, true);
  assert.equal(updateStaffBodySchema.safeParse({ email: "YENI@Ornek.com" }).data?.email, "yeni@ornek.com");
});

// ------------------------------------------------------------- source boundaries

test("no staff column, service or schema stores a credential", () => {
  const schema = readFileSync(path.join(process.cwd(), "db", "schema.ts"), "utf8");
  const staffTable = schema.slice(
    schema.indexOf('"staff_profiles"'),
    schema.indexOf('"staff_profiles"') + 2_000,
  );
  for (const forbidden of ["password", "password_hash", "pin", "plain_password", "secret"]) {
    assert.ok(
      !staffTable.includes(forbidden),
      `staff_profiles must not carry a ${forbidden} column`,
    );
  }

  const service = readFileSync(
    path.join(process.cwd(), "lib", "services", "admin-staff-service.ts"),
    "utf8",
  );
  // The service may *request* a reset; it must never set or return one. A bare
  // `password:` property is how a value would be handed to the auth provider.
  assert.ok(
    !/password\s*[:=]/i.test(service),
    "the service never assigns a password value",
  );
  assert.ok(
    !service.includes("generateLink"),
    "an action link is never produced by a request handler",
  );
  assert.ok(
    service.includes("resetPasswordForEmail"),
    "setting a password is delegated to the provider's own flow",
  );
});

test("the service-role key never reaches a browser bundle", () => {
  const root = process.cwd();
  const clientFiles = [
    path.join(root, "components", "admin", "staff-manager.tsx"),
    path.join(root, "lib", "api", "endpoints.ts"),
    path.join(root, "components", "staff", "staff-session-provider.tsx"),
  ];
  for (const file of clientFiles) {
    const source = readFileSync(file, "utf8");
    assert.ok(
      !/SERVICE_ROLE|supabase\/admin|auth\.admin/.test(source),
      `${path.basename(file)} must not touch the admin auth surface`,
    );
    assert.ok(
      !/NEXT_PUBLIC_SUPABASE_SERVICE/.test(source),
      `${path.basename(file)} must not reference a public service-role variable`,
    );
  }
  // And the admin client itself is server-only.
  const adminClient = readFileSync(path.join(root, "lib", "supabase", "admin.ts"), "utf8");
  assert.ok(adminClient.startsWith('import "server-only";'), "the admin client is server-only");
});

test("the bootstrap CLI refuses a password argument and guards existing admins", () => {
  const script = readFileSync(path.join(process.cwd(), "scripts", "staff-bootstrap.ts"), "utf8");
  assert.ok(script.includes('case "--password"'), "a password flag is explicitly refused");
  assert.ok(
    script.includes("allowAdditionalAdmin"),
    "a second administrator needs an explicit override",
  );
  assert.ok(
    script.includes("existingAdmins.length > 0"),
    "the guard is on existing active administrators",
  );
  // There is no web route that grants an admin role.
  const apiRoot = path.join(process.cwd(), "app", "api");
  for (const suspicious of ["setup", "bootstrap", "make-admin"]) {
    assert.ok(
      !readdirSync(apiRoot).includes(suspicious),
      `there must be no /api/${suspicious} route`,
    );
  }
});
