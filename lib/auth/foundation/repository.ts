import type { StaffIdentityContext } from "./types";

export interface ActiveStaffLookup {
  /** Must be used as a database predicate; never load all profiles then filter. */
  readonly authUserId: string;
  /** Literal forces adapters to include active/deleted predicates in the query. */
  readonly activeOnly: true;
}
/**
 * Database-independent auth port. A production adapter should issue one query
 * scoped by `auth_user_id`, `is_active = true`, `deleted_at is null`, and active
 * restaurant. The service still revalidates every invariant as defense in depth.
 */
export interface StaffIdentityRepository {
  findStaffIdentityByAuthUserId(
    lookup: ActiveStaffLookup,
  ): Promise<StaffIdentityContext | null>;
}
