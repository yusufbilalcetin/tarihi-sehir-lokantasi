import type { User as SupabaseUser } from "@supabase/supabase-js";

import type { UserRole } from "@/lib/domain/status";

/**
 * This is the safe subset of a user returned by `supabase.auth.getUser()`.
 * Callers must not construct it from unverified JWT claims or client metadata.
 */
export type ValidatedSupabaseAuthUser = Pick<
  SupabaseUser,
  "id" | "email" | "app_metadata" | "user_metadata"
>;

/** Schema-independent projection of `staff_profiles`. */
export interface StaffProfileIdentity {
  readonly id: string;
  readonly authUserId: string;
  readonly restaurantId: string;
  readonly name: string;
  readonly email: string | null;
  readonly phone: string | null;
  readonly role: UserRole;
  readonly isActive: boolean;
  readonly deletedAt: Date | string | null;
}

/** Minimum restaurant projection needed to authorize a staff identity. */
export interface StaffRestaurantIdentity {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly isActive: boolean;
}

/** Safe application user DTO derived from the staff profile. */
export interface StaffPrincipalUser {
  readonly id: string;
  readonly authUserId: string;
  readonly restaurantId: string;
  readonly name: string;
  readonly email: string | null;
  readonly phone: string | null;
  readonly isActive: true;
}

export interface StaffPrincipal {
  readonly user: StaffPrincipalUser;
  readonly profile: StaffProfileIdentity & { readonly isActive: true; readonly deletedAt: null };
  readonly authUser: ValidatedSupabaseAuthUser;
  readonly restaurant: StaffRestaurantIdentity & { readonly isActive: true };
  readonly role: UserRole;
  readonly userId: string;
  readonly restaurantId: string;
  /** Makes the resolved identity directly compatible with restaurant-scoped services. */
  readonly isActive: true;
}

export interface StaffIdentityContext {
  readonly profile: StaffProfileIdentity;
  readonly restaurant: StaffRestaurantIdentity;
}
