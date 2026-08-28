import "server-only";

import { and, asc, eq, isNotNull, isNull } from "drizzle-orm";

import { getDb } from "@/db";
import { restaurants, staffProfiles } from "@/db/schema";
import type { UserRole } from "@/lib/domain/status";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { resolveStaffPrincipal, type StaffPrincipal } from "./foundation";
import { DrizzleStaffIdentityRepository } from "./foundation/server";
import type { TestAccount } from "./simple-test-login";

/**
 * The staff profile this username stands for.
 *
 * Scoped to one restaurant so a database that also holds fixtures from test
 * runs cannot hand back somebody else's tenant: the configured demo slug wins,
 * and without one the single active restaurant is used. More than one and no
 * slug is a configuration the resolver refuses to guess at.
 */
async function findProfileEmail(role: UserRole): Promise<string | null> {
  const slug = process.env.DEMO_RESTAURANT_SLUG?.trim();
  const rows = await getDb()
    .select({ email: staffProfiles.email, restaurantId: staffProfiles.restaurantId })
    .from(staffProfiles)
    .innerJoin(restaurants, eq(restaurants.id, staffProfiles.restaurantId))
    .where(
      and(
        eq(staffProfiles.role, role),
        eq(staffProfiles.isActive, true),
        isNull(staffProfiles.deletedAt),
        isNotNull(staffProfiles.email),
        eq(restaurants.isActive, true),
        ...(slug ? [eq(restaurants.slug, slug)] : []),
      ),
    )
    .orderBy(asc(staffProfiles.createdAt))
    .limit(2);

  if (rows.length === 0) return null;
  // Without a configured slug the resolver only picks when there is nothing to
  // pick between.
  if (!slug && rows.length > 1) return null;
  return rows[0].email;
}

/**
 * Mints a real session for an existing identity without its password.
 *
 * Supabase's admin API issues a one-time token for an address; exchanging it
 * on the server establishes exactly the session a password login would have,
 * so everything downstream — the tenant scope, the role, the cookies, the
 * refresh — is the ordinary path and not a parallel one.
 */
export async function signInTestAccount(
  account: TestAccount,
): Promise<StaffPrincipal | null> {
  const email = await findProfileEmail(account.role);
  if (!email) return null;

  const supabase = await createSupabaseServerClient();
  if (!supabase) return null;

  const admin = getSupabaseAdminClient();
  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const tokenHash = data?.properties?.hashed_token;
  if (error || !tokenHash) return null;

  const verified = await supabase.auth.verifyOtp({ type: "magiclink", token_hash: tokenHash });
  if (verified.error || !verified.data.user) return null;

  try {
    const principal = await resolveStaffPrincipal(
      verified.data.user,
      new DrizzleStaffIdentityRepository(getDb()),
    );
    // The username named a role; the profile has to agree, or this is not the
    // identity the caller asked for.
    if (principal.role !== account.role) {
      await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
      return null;
    }
    return principal;
  } catch {
    await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
    return null;
  }
}
