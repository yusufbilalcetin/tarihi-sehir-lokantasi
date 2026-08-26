import type { UserRole } from "@/lib/domain/status";

import {
  accountInactiveError,
  authenticationRequiredError,
  invalidStaffIdentityError,
  restaurantScopeViolationError,
  roleForbiddenError,
} from "./errors";
import type { StaffPrincipal } from "./types";

/** Pure assertion for already-resolved Supabase migration principals. */
export function requireStaff(
  principal: StaffPrincipal | null | undefined,
): StaffPrincipal {
  if (!principal) throw authenticationRequiredError();
  if (
    !principal.isActive ||
    !principal.user.isActive ||
    !principal.profile.isActive ||
    principal.profile.deletedAt !== null ||
    !principal.restaurant.isActive
  ) {
    throw accountInactiveError();
  }
  if (
    principal.userId !== principal.user.id ||
    principal.user.id !== principal.profile.id ||
    principal.authUser.id !== principal.profile.authUserId ||
    principal.restaurantId !== principal.restaurant.id ||
    principal.user.restaurantId !== principal.restaurantId ||
    principal.profile.restaurantId !== principal.restaurantId ||
    principal.profile.role !== principal.role
  ) {
    throw invalidStaffIdentityError();
  }
  return principal;
}

export function requireRole(
  principal: StaffPrincipal | null | undefined,
  allowedRoles: UserRole | readonly UserRole[],
): StaffPrincipal {
  const staff = requireStaff(principal);
  const roles = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];
  if (!roles.includes(staff.role)) throw roleForbiddenError();
  return staff;
}

/**
 * Must be called before a restaurant-owned repository method. Repositories must
 * still include restaurantId in their SQL predicate; this assertion is not a
 * substitute for query-level tenancy.
 */
export function requireRestaurantAccess(
  principal: StaffPrincipal | null | undefined,
  targetRestaurantId: string,
): StaffPrincipal {
  const staff = requireStaff(principal);
  if (!targetRestaurantId || staff.restaurantId !== targetRestaurantId) {
    throw restaurantScopeViolationError();
  }
  return staff;
}
