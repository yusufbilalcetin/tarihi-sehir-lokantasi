import "server-only";

import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { getDb } from "@/db";
import { isDomainError } from "@/lib/api/domain-error";
import type { UserRole } from "@/lib/domain/status";
import { getOptionalPublicEnvironment } from "@/lib/env/public";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import {
  authenticationRequiredError,
  requireRole,
  resolveStaffPrincipal,
  type StaffPrincipal,
} from "./foundation";
import { DrizzleStaffIdentityRepository } from "./foundation/server";
import { createLegacyStaffContext, type LegacyStaffContext } from "./legacy-context";
import { selectStaffAuthProvider } from "./provider-selection";
import { canAccessPanel, staffHomeForRole, type PanelArea } from "./role-access";
import { readSessionRole, SESSION_COOKIE } from "./session";

export type SupabaseStaffContext = StaffPrincipal & {
  readonly authProvider: "SUPABASE";
  readonly authUserId: string;
  readonly name: string;
};

export type CurrentStaffContext = SupabaseStaffContext | LegacyStaffContext;

export function createSupabaseStaffContext(
  principal: StaffPrincipal,
): SupabaseStaffContext {
  return {
    ...principal,
    authProvider: "SUPABASE",
    authUserId: principal.authUser.id,
    name: principal.user.name,
  };
}

async function resolveCurrentStaffContext(): Promise<CurrentStaffContext | null> {
  const publicEnvironment = getOptionalPublicEnvironment();
  const provider = selectStaffAuthProvider(publicEnvironment);

  if (provider === "LEGACY_HMAC") {
    const cookieStore = await cookies();
    const role = await readSessionRole(cookieStore.get(SESSION_COOKIE)?.value);
    return role ? createLegacyStaffContext(role) : null;
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) return null;

  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;

  try {
    const principal = await resolveStaffPrincipal(
      data.user,
      new DrizzleStaffIdentityRepository(getDb()),
    );
    return createSupabaseStaffContext(principal);
  } catch (error) {
    if (
      isDomainError(error) &&
      (error.code === "AUTHENTICATION_REQUIRED" || error.code === "ACCOUNT_INACTIVE")
    ) {
      return null;
    }
    throw error;
  }
}

/** Request-memoized, authoritative staff identity resolver. */
export const getCurrentStaffContext = cache(resolveCurrentStaffContext);

/**
 * Tenant-scoped APIs must use this helper. Legacy sessions deliberately fail
 * because they cannot prove a database restaurant/profile identity.
 */
export async function requireCurrentStaffPrincipal(
  allowedRoles?: readonly UserRole[],
): Promise<StaffPrincipal> {
  const context = await getCurrentStaffContext();
  if (!context || context.authProvider !== "SUPABASE") {
    throw authenticationRequiredError();
  }

  return allowedRoles?.length ? requireRole(context, allowedRoles) : context;
}

/** UI route guard with a narrowly-contained legacy migration fallback. */
export type PanelAccess =
  | { readonly allowed: true; readonly context: CurrentStaffContext }
  | { readonly allowed: false; readonly role: UserRole; readonly home: string };

/**
 * Decides whether this request may open `area`.
 *
 * The three outcomes are kept apart on purpose:
 *
 * - no session at all — redirect to the login page, which is where an
 *   unauthenticated visitor belongs;
 * - signed in, wrong role — *return* a refusal so the caller renders a denial
 *   at the requested URL. Redirecting here used to send the visitor to their
 *   own panel, and because Next resolves a server redirect on the client the
 *   denied panel was streamed and painted first: the operator saw the Kitchen
 *   screen, then it silently became the till;
 * - signed in, right role — hand back the context.
 */
export async function resolvePanelAccess(area: PanelArea): Promise<PanelAccess> {
  const context = await getCurrentStaffContext();
  if (!context) redirect("/staff/login");

  if (!canAccessPanel(context.role, area)) {
    return { allowed: false, role: context.role, home: staffHomeForRole(context.role) };
  }

  return { allowed: true, context };
}
