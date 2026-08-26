import "server-only";

import { and, eq, isNotNull, isNull } from "drizzle-orm";

import { getDb } from "@/db";
import { restaurants, staffProfiles } from "@/db/schema";

export type SupabasePasswordCredential =
  | { readonly email: string; readonly password: string }
  | { readonly phone: string; readonly password: string };

/**
 * Resolves a code/username only to the email required by Supabase Auth. The
 * query is constrained to an active, non-deleted profile and active restaurant.
 * Callers must always return the same error for no match and bad passwords.
 */
export async function resolveSupabasePasswordCredential(
  identifier: string,
  password: string,
): Promise<SupabasePasswordCredential | null> {
  if (identifier.includes("@")) return { email: identifier, password };
  if (/^\+[1-9]\d{7,14}$/.test(identifier)) return { phone: identifier, password };

  const rows = await getDb()
    .select({ email: staffProfiles.email })
    .from(staffProfiles)
    .innerJoin(restaurants, eq(restaurants.id, staffProfiles.restaurantId))
    .where(
      and(
        eq(staffProfiles.loginIdentifier, identifier),
        eq(staffProfiles.isActive, true),
        isNull(staffProfiles.deletedAt),
        isNotNull(staffProfiles.email),
        eq(restaurants.isActive, true),
      ),
    )
    .limit(1);

  return rows[0]?.email ? { email: rows[0].email, password } : null;
}
