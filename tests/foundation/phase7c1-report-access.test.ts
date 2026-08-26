import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { isDomainError } from "../../lib/api/domain-error";
import {
  requireRole,
  type StaffPrincipal,
  type ValidatedSupabaseAuthUser,
} from "../../lib/auth/foundation";
import type { UserRole } from "../../lib/domain/status";
import { REPORT_ROLES } from "../../lib/domain/report-contracts";
import {
  reportProductQuerySchema,
  reportRangeQuerySchema,
  reportReviewDetailQuerySchema,
} from "../../lib/validation";

const authUser: ValidatedSupabaseAuthUser = {
  id: "auth-user-1",
  email: "manager@example.test",
  app_metadata: {},
  user_metadata: {},
};

function principal(role: UserRole, restaurantId = "restaurant-a"): StaffPrincipal {
  return {
    user: {
      id: "staff-1",
      authUserId: authUser.id,
      restaurantId,
      name: "Test Personel",
      email: authUser.email ?? null,
      phone: null,
      isActive: true,
    },
    profile: {
      id: "staff-1",
      authUserId: authUser.id,
      restaurantId,
      name: "Test Personel",
      email: authUser.email ?? null,
      phone: null,
      role,
      isActive: true,
      deletedAt: null,
    },
    authUser,
    restaurant: {
      id: restaurantId,
      name: "Tarihi Şehir Lokantası",
      slug: "tarihi-sehir-lokantasi",
      isActive: true,
    },
    role,
    userId: "staff-1",
    restaurantId,
    isActive: true,
  };
}

function forbiddenCode(role: UserRole): string | null {
  try {
    requireRole(principal(role), REPORT_ROLES);
    return null;
  } catch (error) {
    return isDomainError(error) ? error.code : "UNKNOWN";
  }
}

test("only management roles reach the reporting surface", () => {
  assert.deepEqual([...REPORT_ROLES], ["ADMIN", "MANAGER"]);

  for (const role of ["ADMIN", "MANAGER"] as const) {
    assert.equal(forbiddenCode(role), null, `${role} must be able to read reports`);
  }
  for (const role of ["WAITER", "KITCHEN", "CASHIER"] as const) {
    assert.equal(
      forbiddenCode(role),
      "FORBIDDEN",
      `${role} must not be able to read reports`,
    );
  }
});

const REPORT_ROUTES = path.join(process.cwd(), "app", "api", "admin", "reports");

function routeFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return routeFiles(full);
    return entry.name === "route.ts" ? [full] : [];
  });
}

test("every report endpoint goes through a guarded envelope", () => {
  const files = routeFiles(REPORT_ROUTES);
  assert.ok(files.length >= 10, "the report surface should have grown, not shrunk");

  for (const file of files) {
    const source = readFileSync(file, "utf8");
    // Either envelope resolves the principal itself; a handler written outside
    // one would skip the role check entirely.
    assert.match(
      source,
      /reportRoute\(|adminRead\(/,
      `${path.relative(process.cwd(), file)} must use a guarded route envelope`,
    );
  }
});

test("no report query accepts a tenant from the client", () => {
  for (const [name, schema] of [
    ["range", reportRangeQuerySchema],
    ["products", reportProductQuerySchema],
    ["review detail", reportReviewDetailQuerySchema],
  ] as const) {
    const parsed = schema.safeParse({ range: "TODAY", restaurantId: "restaurant-b" });
    assert.equal(
      parsed.success,
      false,
      `${name} query must reject a client-supplied restaurantId`,
    );
  }
});

test("the reporting services never build an unscoped query", () => {
  // Every report read is tenant-filtered in SQL; RLS is the second boundary,
  // not the first. A `.where(` without a restaurant predicate is the exact
  // mistake that would leak another restaurant's figures.
  for (const file of [
    "lib/services/report-analytics-service.ts",
    "lib/services/report-detail-service.ts",
  ]) {
    const source = readFileSync(path.join(process.cwd(), file), "utf8");
    const clauses = source.split(".where(").slice(1);
    assert.ok(clauses.length > 0, `${file} should contain report queries`);

    for (const clause of clauses) {
      const head = clause.slice(0, 600);
      assert.match(
        head,
        // Either inline, or one of the shared predicates asserted below.
        /restaurantId|restaurant_id|\b(scope|orderScope|paymentScope|refundScope|voidScope|cancelScope|predicates)\b/,
        `${file} has a .where( with no tenant predicate`,
      );
    }

    // The shared predicates the queries above lean on must carry the tenant.
    const definitions = source.matchAll(
      /const (scope|orderScope|paymentScope|refundScope|voidScope|cancelScope|predicates)(?::[^=]+)? = ([\s\S]{0,400}?);\r?\n/g,
    );
    let found = 0;
    for (const [, name, body] of definitions) {
      found += 1;
      assert.match(
        body,
        /restaurantId/,
        `${file}: shared predicate ${name} is not tenant-scoped`,
      );
    }
    assert.ok(found > 0, `${file} should define at least one shared scope predicate`);
  }

  const detail = readFileSync(
    path.join(process.cwd(), "lib/services/report-detail-service.ts"),
    "utf8",
  );
  // The kitchen duration pairing is raw SQL, so its scoping is asserted by name.
  assert.match(detail, /started\.restaurant_id = \$\{restaurantId\}/);
  assert.match(detail, /ready\.restaurant_id = started\.restaurant_id/);
});

test("report identifiers are read from the session, never from the query", () => {
  const envelope = readFileSync(
    path.join(process.cwd(), "lib/api/report-route.ts"),
    "utf8",
  );
  assert.match(envelope, /requireCurrentStaffPrincipal\(REPORT_ROLES\)/);
  assert.doesNotMatch(envelope, /searchParams\.get\("restaurantId"\)/);

  for (const file of routeFiles(REPORT_ROUTES)) {
    const source = readFileSync(file, "utf8");
    assert.doesNotMatch(
      source,
      /restaurantId/,
      `${path.relative(process.cwd(), file)} must take the tenant from the principal`,
    );
  }
});
