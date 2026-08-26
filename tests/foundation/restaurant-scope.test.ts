import assert from "node:assert/strict";
import test from "node:test";

import {
  authorizeRestaurantAccess,
  filterToRestaurantScope,
  type RestaurantPrincipal,
} from "../../lib/domain/restaurant-scope";

const waiter: RestaurantPrincipal = {
  userId: "user-1",
  restaurantId: "restaurant-a",
  role: "WAITER",
  isActive: true,
};

test("restaurant access is fail-closed", () => {
  assert.deepEqual(authorizeRestaurantAccess(null, "restaurant-a"), {
    allowed: false,
    reason: "AUTHENTICATION_REQUIRED",
  });
  assert.deepEqual(
    authorizeRestaurantAccess({ ...waiter, isActive: false }, "restaurant-a"),
    { allowed: false, reason: "ACCOUNT_INACTIVE" },
  );
  assert.deepEqual(authorizeRestaurantAccess(waiter, "restaurant-b"), {
    allowed: false,
    reason: "RESTAURANT_SCOPE_MISMATCH",
  });
});
test("tenant equality and allowed role are both required", () => {
  assert.deepEqual(
    authorizeRestaurantAccess(waiter, "restaurant-a", { allowedRoles: ["ADMIN"] }),
    { allowed: false, reason: "ROLE_NOT_ALLOWED" },
  );
  assert.deepEqual(
    authorizeRestaurantAccess(waiter, "restaurant-a", { allowedRoles: ["WAITER"] }),
    { allowed: true, principal: waiter },
  );
});

test("defense-in-depth collection scoping retains only the requested tenant", () => {
  const records = [
    { id: "1", restaurantId: "restaurant-a" },
    { id: "2", restaurantId: "restaurant-b" },
  ];

  assert.deepEqual(filterToRestaurantScope(records, "restaurant-a"), [records[0]]);
});
