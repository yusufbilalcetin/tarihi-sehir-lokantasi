import { USER_ROLES, type UserRole } from "@/lib/domain/status";

import {
  accountInactiveError,
  authenticationRequiredError,
  invalidStaffIdentityError,
} from "./errors";
import type { StaffIdentityRepository } from "./repository";
import type {
  StaffPrincipal,
  ValidatedSupabaseAuthUser,
} from "./types";

const AUTH_USER_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

function isUserRole(value: unknown): value is UserRole {
  return typeof value === "string" && (USER_ROLES as readonly string[]).includes(value);
}

/**
 * Resolves a provider-authenticated user to the authoritative active domain
 * profile and restaurant used by staff authorization.
 */
export async function resolveStaffPrincipal(
  authUser: ValidatedSupabaseAuthUser | null | undefined,
  repository: StaffIdentityRepository,
): Promise<StaffPrincipal> {
  if (!authUser || !AUTH_USER_ID.test(authUser.id)) {
    throw authenticationRequiredError();
  }

  // The repository contract requires a database query scoped to this auth user
  // and active profiles; it must never perform an unscoped profile read.
  let identity;
  try {
    identity = await repository.findStaffIdentityByAuthUserId({
      authUserId: authUser.id,
      activeOnly: true,
    });
  } catch (cause) {
    throw invalidStaffIdentityError(cause);
  }
  if (!identity) throw authenticationRequiredError();

  const { profile, restaurant } = identity;
  if (!profile.isActive || profile.deletedAt !== null || !restaurant.isActive) {
    throw accountInactiveError();
  }
  if (
    profile.authUserId !== authUser.id ||
    profile.restaurantId !== restaurant.id ||
    !isUserRole(profile.role)
  ) {
    throw invalidStaffIdentityError();
  }

  const activeProfile = profile as StaffPrincipal["profile"];
  const activeRestaurant = restaurant as StaffPrincipal["restaurant"];
  const user = {
    id: profile.id,
    authUserId: authUser.id,
    restaurantId: restaurant.id,
    name: profile.name,
    email: profile.email,
    phone: profile.phone,
    isActive: true,
  } as const;

  return {
    user,
    profile: activeProfile,
    authUser,
    restaurant: activeRestaurant,
    role: profile.role,
    userId: profile.id,
    restaurantId: restaurant.id,
    isActive: true,
  };
}
