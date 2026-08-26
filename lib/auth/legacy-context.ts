import type { UserRole } from "@/lib/domain/status";

import type { StaffRole } from "./session";

export interface LegacyStaffContext {
  readonly authProvider: "LEGACY_HMAC";
  readonly userId: string;
  readonly authUserId: null;
  readonly restaurantId: null;
  readonly role: Extract<UserRole, "ADMIN" | "WAITER">;
  readonly name: string;
  readonly isActive: true;
  readonly user: null;
  readonly profile: null;
  readonly restaurant: null;
}
/** Compatibility-only identity; it is never valid for tenant-scoped APIs. */
export function createLegacyStaffContext(role: StaffRole): LegacyStaffContext {
  if (role === "admin") {
    return {
      authProvider: "LEGACY_HMAC",
      userId: "legacy:admin",
      authUserId: null,
      restaurantId: null,
      role: "ADMIN",
      // A role label, not a person: this identity is synthesised, so naming a
      // real member of staff here would misattribute whatever it does. The
      // waiter branch below has always said "Personel" for the same reason.
      name: "Yönetici",
      isActive: true,
      user: null,
      profile: null,
      restaurant: null,
    };
  }

  return {
    authProvider: "LEGACY_HMAC",
    userId: "legacy:staff",
    authUserId: null,
    restaurantId: null,
    role: "WAITER",
    name: "Personel",
    isActive: true,
    user: null,
    profile: null,
    restaurant: null,
  };
}
