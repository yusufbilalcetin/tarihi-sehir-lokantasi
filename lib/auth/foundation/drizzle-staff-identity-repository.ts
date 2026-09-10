import "server-only";

import { and, eq, isNull } from "drizzle-orm";

import type { Database } from "@/db";
import { restaurants, staffProfiles } from "@/db/schema";

import type { ActiveStaffLookup, StaffIdentityRepository } from "./repository";
import type { StaffIdentityContext } from "./types";

/**
 * Operational adapter for the Supabase Auth migration foundation.
 *
 * The database is injected: constructing/importing this adapter never calls
 * `getDb()` and never opens a connection. Each resolution is one scoped query
 * that applies auth-user, active-profile, not-deleted, and active-restaurant
 * predicates before returning only principal-safe columns.
 */
export class DrizzleStaffIdentityRepository implements StaffIdentityRepository {
  constructor(private readonly database: Database) {}

  async findStaffIdentityByAuthUserId(
    lookup: ActiveStaffLookup,
  ): Promise<StaffIdentityContext | null> {
    const rows = await this.database
      .select({
        profileId: staffProfiles.id,
        profileAuthUserId: staffProfiles.authUserId,
        profileRestaurantId: staffProfiles.restaurantId,
        profileName: staffProfiles.name,
        profileEmail: staffProfiles.email,
        profilePhone: staffProfiles.phone,
        profileRole: staffProfiles.role,
        profileIsActive: staffProfiles.isActive,
        profileDeletedAt: staffProfiles.deletedAt,
        restaurantId: restaurants.id,
        restaurantName: restaurants.name,
        restaurantSlug: restaurants.slug,
        restaurantIsActive: restaurants.isActive,
        restaurantTimezone: restaurants.timezone,
      })
      .from(staffProfiles)
      .innerJoin(restaurants, eq(restaurants.id, staffProfiles.restaurantId))
      .where(
        and(
          eq(staffProfiles.authUserId, lookup.authUserId),
          eq(staffProfiles.isActive, lookup.activeOnly),
          isNull(staffProfiles.deletedAt),
          eq(restaurants.isActive, true),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row?.profileAuthUserId) return null;

    return {
      profile: {
        id: row.profileId,
        authUserId: row.profileAuthUserId,
        restaurantId: row.profileRestaurantId,
        name: row.profileName,
        email: row.profileEmail,
        phone: row.profilePhone,
        role: row.profileRole,
        isActive: row.profileIsActive,
        deletedAt: row.profileDeletedAt,
      },
      restaurant: {
        id: row.restaurantId,
        name: row.restaurantName,
        slug: row.restaurantSlug,
        isActive: row.restaurantIsActive,
        timezone: row.restaurantTimezone,
      },
    };
  }
}
