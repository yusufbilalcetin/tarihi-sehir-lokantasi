/**
 * Supabase Auth migration foundation.
 *
 * Supabase Auth is authoritative whenever it is configured. The legacy HMAC
 * session remains behind one compatibility boundary only for deployments where
 * Supabase is entirely absent; it cannot authorize tenant-scoped APIs.
 */
export { requireRestaurantAccess, requireRole, requireStaff } from "./authorize";
export {
  accountInactiveError,
  authenticationRequiredError,
  invalidStaffIdentityError,
  restaurantScopeViolationError,
  roleForbiddenError,
} from "./errors";
export { resolveStaffPrincipal } from "./resolve-principal";
export type { ActiveStaffLookup, StaffIdentityRepository } from "./repository";
export type {
  StaffIdentityContext,
  StaffPrincipal,
  StaffPrincipalUser,
  StaffProfileIdentity,
  StaffRestaurantIdentity,
  ValidatedSupabaseAuthUser,
} from "./types";
