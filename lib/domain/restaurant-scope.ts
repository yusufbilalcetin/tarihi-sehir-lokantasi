import type { EntityId, RestaurantScopedEntity } from "./models";
import type { UserRole } from "./status";

export interface RestaurantPrincipal {
  readonly userId: EntityId;
  readonly restaurantId: EntityId;
  readonly role: UserRole;
  readonly isActive: boolean;
}
export type RestaurantAccessDenialReason =
  | "AUTHENTICATION_REQUIRED"
  | "ACCOUNT_INACTIVE"
  | "RESTAURANT_SCOPE_MISMATCH"
  | "ROLE_NOT_ALLOWED";

export type RestaurantAccessDecision =
  | {
      readonly allowed: true;
      readonly principal: RestaurantPrincipal;
    }
  | {
      readonly allowed: false;
      readonly reason: RestaurantAccessDenialReason;
    };

export interface RestaurantAccessOptions {
  readonly allowedRoles?: readonly UserRole[];
}

/**
 * Central, fail-closed tenant and role check for authenticated staff operations.
 * Tenant equality is checked before roles so a valid role never bypasses isolation.
 */
export function authorizeRestaurantAccess(
  principal: RestaurantPrincipal | null | undefined,
  targetRestaurantId: EntityId,
  options: RestaurantAccessOptions = {},
): RestaurantAccessDecision {
  if (!principal) return { allowed: false, reason: "AUTHENTICATION_REQUIRED" };
  if (!principal.isActive) return { allowed: false, reason: "ACCOUNT_INACTIVE" };
  if (principal.restaurantId !== targetRestaurantId) {
    return { allowed: false, reason: "RESTAURANT_SCOPE_MISMATCH" };
  }
  if (options.allowedRoles && !options.allowedRoles.includes(principal.role)) {
    return { allowed: false, reason: "ROLE_NOT_ALLOWED" };
  }

  return { allowed: true, principal };
}

export function isInRestaurantScope(
  resource: RestaurantScopedEntity,
  restaurantId: EntityId,
): boolean {
  return resource.restaurantId === restaurantId;
}

/**
 * Defense-in-depth for already-loaded collections. Database queries must still
 * include the restaurant predicate; filtering after an unscoped query is not authorization.
 */
export function filterToRestaurantScope<T extends RestaurantScopedEntity>(
  resources: readonly T[],
  restaurantId: EntityId,
): T[] {
  return resources.filter((resource) => isInRestaurantScope(resource, restaurantId));
}
