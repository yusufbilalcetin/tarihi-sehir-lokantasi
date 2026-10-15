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
interface DemoProfile {
  id: string;
  email: string;
  authUserId: string | null;
}

async function findProfile(role: UserRole): Promise<DemoProfile | null> {
  const slug = process.env.DEMO_RESTAURANT_SLUG?.trim();
  const rows = await getDb()
    .select({
      id: staffProfiles.id,
      email: staffProfiles.email,
      authUserId: staffProfiles.authUserId,
    })
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
  const [row] = rows;
  return row.email ? { id: row.id, email: row.email, authUserId: row.authUserId } : null;
}

/**
 * Seeded profiles are created without a login account (`auth_user_id` null), so
 * the session below would otherwise resolve to no identity at all. The first
 * successful demo sign-in links the profile to the account it just minted.
 * Only an unlinked profile is ever touched, never one that already has an owner.
 */
async function linkProfileToAuthUser(profileId: string, authUserId: string): Promise<void> {
  await getDb()
    .update(staffProfiles)
    .set({ authUserId })
    .where(and(eq(staffProfiles.id, profileId), isNull(staffProfiles.authUserId)));
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
  const profile = await findProfile(account.role);
  if (!profile) return null;
  const { email } = profile;

  const supabase = await createSupabaseServerClient();
  if (!supabase) return null;

  const admin = getSupabaseAdminClient();
  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const tokenHash = data?.properties?.hashed_token;
  if (error || !tokenHash) return null;

  const verified = await supabase.auth.verifyOtp({ type: "magiclink", token_hash: tokenHash });
  if (verified.error || !verified.data.user) return null;

  try {
    if (!profile.authUserId) await linkProfileToAuthUser(profile.id, verified.data.user.id);
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
