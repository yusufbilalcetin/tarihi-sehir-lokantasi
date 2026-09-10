import assert from "node:assert/strict";
import test from "node:test";

import { DomainError } from "../../lib/api/domain-error";
import {
  requireRestaurantAccess,
  requireRole,
  resolveStaffPrincipal,
  type ActiveStaffLookup,
  type StaffIdentityContext,
  type StaffIdentityRepository,
  type StaffPrincipal,
  type ValidatedSupabaseAuthUser,
} from "../../lib/auth/foundation";

const authUser: ValidatedSupabaseAuthUser = {
  id: "auth-user-1",
  email: "waiter@example.test",
  app_metadata: {},
  user_metadata: {},
};

const activeIdentity: StaffIdentityContext = {
  profile: {
    id: "staff-1",
    authUserId: authUser.id,
    restaurantId: "restaurant-a",
    name: "Ayşe Garson",
    email: authUser.email ?? null,
    phone: null,
    role: "WAITER",
    isActive: true,
    deletedAt: null,
  },
  restaurant: {
    id: "restaurant-a",
    name: "Tarihi Şehir Lokantası",
    slug: "tarihi-sehir-lokantasi",
    isActive: true,
    timezone: "Europe/Istanbul",
  },
};

class FakeStaffRepository implements StaffIdentityRepository {
  lookup: ActiveStaffLookup | null = null;

  constructor(private readonly identity: StaffIdentityContext | null) {}

  async findStaffIdentityByAuthUserId(lookup: ActiveStaffLookup) {
    this.lookup = lookup;
    return this.identity;
  }
}

function expectDomainError(
  action: () => unknown | Promise<unknown>,
  code: DomainError["code"],
): Promise<void> {
  return assert.rejects(
    async () => action(),
    (error) => error instanceof DomainError && error.code === code,
  );
}

test("missing profile is unauthorized and lookup is auth-user plus active scoped", async () => {
  const repository = new FakeStaffRepository(null);
  await expectDomainError(
    () => resolveStaffPrincipal(authUser, repository),
    "AUTHENTICATION_REQUIRED",
  );
  assert.deepEqual(repository.lookup, { authUserId: authUser.id, activeOnly: true });
});
test("inactive profile is denied even if a repository violates its active-only contract", async () => {
  const repository = new FakeStaffRepository({
    ...activeIdentity,
    profile: { ...activeIdentity.profile, isActive: false },
  });
  await expectDomainError(() => resolveStaffPrincipal(authUser, repository), "ACCOUNT_INACTIVE");
});

test("WAITER cannot execute an admin mutation", async () => {
  const principal = await resolveStaffPrincipal(
    authUser,
    new FakeStaffRepository(activeIdentity),
  );
  assert.equal(principal.role, "WAITER");
  assert.throws(
    () => requireRole(principal, ["ADMIN", "MANAGER"]),
    (error) => error instanceof DomainError && error.code === "FORBIDDEN",
  );
});

test("cross-restaurant scope is denied", async () => {
  const principal: StaffPrincipal = await resolveStaffPrincipal(
    authUser,
    new FakeStaffRepository(activeIdentity),
  );
  assert.throws(
    () => requireRestaurantAccess(principal, "restaurant-b"),
    (error) =>
      error instanceof DomainError && error.code === "RESTAURANT_SCOPE_VIOLATION",
  );
  assert.equal(requireRestaurantAccess(principal, "restaurant-a"), principal);
});
