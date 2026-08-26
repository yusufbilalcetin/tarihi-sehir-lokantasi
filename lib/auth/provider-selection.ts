import type { PublicEnvironment } from "@/lib/env/validation";

export type StaffAuthProvider = "SUPABASE" | "LEGACY_HMAC";

/**
 * The migration fallback is intentionally selected only when Supabase is
 * entirely absent. A partial/invalid Supabase configuration is rejected by
 * the environment parser before this function is called and must not silently
 * fall back to legacy credentials.
 */
export function selectStaffAuthProvider(
  supabaseEnvironment: PublicEnvironment | null,
): StaffAuthProvider {
  return supabaseEnvironment ? "SUPABASE" : "LEGACY_HMAC";
}
