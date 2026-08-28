import "server-only";

import { getDb } from "@/db";
import { getOptionalPublicEnvironment } from "@/lib/env/public";
import { getServerEnvironment } from "@/lib/env/server";
import type { UserRole } from "@/lib/domain/status";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { resolveStaffPrincipal, type StaffPrincipal } from "./foundation";
import {
  isSimpleTestLoginEnabled,
  isTestUsername,
  resolveTestAccount,
} from "./simple-test-login";
import { signInTestAccount } from "./simple-test-login.server";
import { DrizzleStaffIdentityRepository } from "./foundation/server";
import { selectStaffAuthProvider, type StaffAuthProvider } from "./provider-selection";
import { staffHomeForRole } from "./role-access";
import { createSessionToken, type StaffRole } from "./session";
import { resolveSupabasePasswordCredential } from "./staff-login-identifier";

export interface StaffLoginInput {
  readonly identifier: string;
  readonly password: string;
}

export type StaffLoginResult =
  | {
      readonly success: true;
      readonly provider: "SUPABASE";
      readonly redirectTo: string;
      readonly principal: StaffPrincipal;
    }
  | {
      readonly success: true;
      readonly provider: "LEGACY_HMAC";
      readonly redirectTo: string;
      readonly legacySessionToken: string;
    }
  | {
      readonly success: false;
      readonly provider: StaffAuthProvider;
      readonly reason: "INVALID_CREDENTIALS";
    };

function matchesLegacyCredential(
  identifier: string,
  password: string,
  expectedIdentifier: string | undefined,
  expectedPassword: string | undefined,
): boolean {
  const wantedIdentifier = expectedIdentifier?.trim();
  const wantedPassword = expectedPassword?.trim();
  return Boolean(
    wantedIdentifier &&
      wantedPassword &&
      identifier === wantedIdentifier &&
      password === wantedPassword,
  );
}

export function resolveLegacyRole(
  identifier: string,
  password: string,
  environment: NodeJS.ProcessEnv = process.env,
): StaffRole | null {
  if (
    matchesLegacyCredential(
      identifier,
      password,
      environment.ADMIN_LOGIN_CODE,
      environment.ADMIN_LOGIN_PIN,
    )
  ) {
    return "admin";
  }
  if (
    matchesLegacyCredential(
      identifier,
      password,
      environment.STAFF_LOGIN_CODE,
      environment.STAFF_LOGIN_PIN,
    )
  ) {
    return "staff";
  }
  return null;
}

/**
 * Central migration switch. Supabase is authoritative whenever its public
 * configuration exists; legacy credentials are consulted only when Supabase
 * is entirely unconfigured.
 */
export async function authenticateStaff(
  input: StaffLoginInput,
): Promise<StaffLoginResult> {
  const identifier = input.identifier.trim().toLowerCase();
  const password = input.password;
  const publicEnvironment = getOptionalPublicEnvironment();
  const provider = selectStaffAuthProvider(publicEnvironment);

  if (provider === "LEGACY_HMAC") {
    const role = resolveLegacyRole(input.identifier.trim(), password);
    if (!role) return { success: false, provider, reason: "INVALID_CREDENTIALS" };
    const domainRole: UserRole = role === "admin" ? "ADMIN" : "WAITER";
    return {
      success: true,
      provider,
      redirectTo: staffHomeForRole(domainRole),
      legacySessionToken: await createSessionToken(role),
    };
  }

  // A Supabase session without the domain database cannot be authorized or
  // tenant-scoped. Missing DB config is an explicit failure, never a reason to
  // downgrade to environment credentials.
  getServerEnvironment(["database"]);

  // The demonstration usernames, where a deployment has asked for them. A
  // username that is not one of them falls straight through to the ordinary
  // login, and with the flag off this branch does not exist at all.
  if (isSimpleTestLoginEnabled() && isTestUsername(identifier)) {
    const account = resolveTestAccount(identifier, password);
    const principal = account ? await signInTestAccount(account) : null;
    if (!principal) return { success: false, provider, reason: "INVALID_CREDENTIALS" };
    return {
      success: true,
      provider,
      redirectTo: staffHomeForRole(principal.role),
      principal,
    };
  }

  const credential = await resolveSupabasePasswordCredential(identifier, password);
  const supabase = await createSupabaseServerClient();
  if (!credential || !supabase) {
    return { success: false, provider, reason: "INVALID_CREDENTIALS" };
  }

  const { data, error } = await supabase.auth.signInWithPassword(credential);
  if (error || !data.user) {
    return { success: false, provider, reason: "INVALID_CREDENTIALS" };
  }

  try {
    const principal = await resolveStaffPrincipal(
      data.user,
      new DrizzleStaffIdentityRepository(getDb()),
    );
    return {
      success: true,
      provider,
      redirectTo: staffHomeForRole(principal.role),
      principal,
    };
  } catch {
    // An Auth user without an active restaurant profile must not retain a
    // usable staff session. The client receives the same generic failure as a
    // bad password, preventing profile/account enumeration.
    await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
    return { success: false, provider, reason: "INVALID_CREDENTIALS" };
  }
}
