import { USER_ROLES, type UserRole } from "./status";

/**
 * Who may create, promote, demote and switch off whom.
 *
 * These rules decide whether a restaurant can be locked out of its own admin
 * panel, so they live here as pure functions with no database and no request:
 * every one of them is decided the same way in a test, in a route and in a CLI.
 * The service still re-checks them inside its transaction — this module decides
 * *what* is allowed, never *whether the data is still true*.
 */

/** Turkish labels. ADMIN and MANAGER are spelled out so nobody guesses. */
export const STAFF_ROLE_LABELS: Readonly<Record<UserRole, string>> = {
  ADMIN: "Sistem Yöneticisi",
  MANAGER: "İşletme Müdürü",
  WAITER: "Garson",
  KITCHEN: "Mutfak",
  CASHIER: "Kasiyer",
};

/** The roles a manager may hand out. Deliberately excludes ADMIN and MANAGER. */
export const MANAGER_ASSIGNABLE_ROLES: readonly UserRole[] = [
  "WAITER",
  "KITCHEN",
  "CASHIER",
];

export type StaffMutationRefusal =
  | "NOT_A_MANAGER_ROLE"
  | "MANAGER_CANNOT_TOUCH_SUPERVISOR"
  | "MANAGER_CANNOT_ASSIGN_SUPERVISOR"
  | "SELF_ROLE_CHANGE"
  | "SELF_DEACTIVATION"
  | "LAST_ADMIN";

export interface StaffMutationDecision {
  readonly allowed: boolean;
  readonly reason?: StaffMutationRefusal;
}

const ALLOWED: StaffMutationDecision = { allowed: true };
function refuse(reason: StaffMutationRefusal): StaffMutationDecision {
  return { allowed: false, reason };
}

export function isUserRole(value: unknown): value is UserRole {
  return typeof value === "string" && (USER_ROLES as readonly string[]).includes(value);
}

/** ADMIN and MANAGER are the only roles with any account-management surface. */
export function canManageStaff(actorRole: UserRole): boolean {
  return actorRole === "ADMIN" || actorRole === "MANAGER";
}

/**
 * May `actorRole` create or alter an account that holds `targetRole`?
 *
 * A manager runs the floor, not the company: they may staff it with waiters,
 * cooks and cashiers, and may not touch anyone who could manage them back.
 */
export function canActOnRole(actorRole: UserRole, targetRole: UserRole): boolean {
  if (actorRole === "ADMIN") return true;
  if (actorRole !== "MANAGER") return false;
  return MANAGER_ASSIGNABLE_ROLES.includes(targetRole);
}

/** The roles this actor may choose from in a create or role-change form. */
export function assignableRoles(actorRole: UserRole): readonly UserRole[] {
  if (actorRole === "ADMIN") return USER_ROLES;
  if (actorRole === "MANAGER") return MANAGER_ASSIGNABLE_ROLES;
  return [];
}

export function checkStaffCreation(
  actorRole: UserRole,
  targetRole: UserRole,
): StaffMutationDecision {
  if (!canManageStaff(actorRole)) return refuse("NOT_A_MANAGER_ROLE");
  if (!canActOnRole(actorRole, targetRole)) return refuse("MANAGER_CANNOT_ASSIGN_SUPERVISOR");
  return ALLOWED;
}

export interface StaffUpdateSubject {
  readonly staffId: string;
  readonly role: UserRole;
  readonly isActive: boolean;
}

export interface StaffUpdateIntent {
  /** Absent means "leave the role alone". */
  readonly nextRole?: UserRole;
  /** Absent means "leave the status alone". Archiving counts as deactivating. */
  readonly nextActive?: boolean;
}

/**
 * The full rule set for changing an existing account.
 *
 * `activeAdminCount` must be counted **inside the caller's transaction**, with
 * the admin rows locked: this function only compares numbers, it cannot know
 * that another request is deactivating the other admin at the same moment.
 */
export function checkStaffUpdate(
  actor: { readonly role: UserRole; readonly staffId: string },
  subject: StaffUpdateSubject,
  intent: StaffUpdateIntent,
  activeAdminCount: number,
): StaffMutationDecision {
  if (!canManageStaff(actor.role)) return refuse("NOT_A_MANAGER_ROLE");

  // A manager may not reach an admin or another manager at all, in either
  // direction: not to rename them, not to switch them off, not to demote them.
  if (!canActOnRole(actor.role, subject.role)) {
    return refuse("MANAGER_CANNOT_TOUCH_SUPERVISOR");
  }
  if (intent.nextRole && !canActOnRole(actor.role, intent.nextRole)) {
    return refuse("MANAGER_CANNOT_ASSIGN_SUPERVISOR");
  }

  const isSelf = subject.staffId === actor.staffId;
  if (isSelf && intent.nextRole && intent.nextRole !== subject.role) {
    // Nobody promotes themselves, and nobody accidentally demotes themselves
    // out of the panel either. Role is always granted by someone else.
    return refuse("SELF_ROLE_CHANGE");
  }
  if (isSelf && intent.nextActive === false) return refuse("SELF_DEACTIVATION");

  // The restaurant must never be left without an administrator: the last active
  // admin can be neither switched off nor demoted, by anyone, including another
  // admin.
  const losesAdmin =
    subject.role === "ADMIN" &&
    subject.isActive &&
    (intent.nextActive === false || (intent.nextRole !== undefined && intent.nextRole !== "ADMIN"));
  if (losesAdmin && activeAdminCount <= 1) return refuse("LAST_ADMIN");

  return ALLOWED;
}

/** Messages the operator sees. Deliberately explain the rule, not the internals. */
export const STAFF_REFUSAL_MESSAGES: Readonly<Record<StaffMutationRefusal, string>> = {
  NOT_A_MANAGER_ROLE: "Personel yönetimi yalnızca yönetici ve müdüre açıktır.",
  MANAGER_CANNOT_TOUCH_SUPERVISOR:
    "Müdür; yönetici ve müdür hesaplarını yönetemez. Bu işlem sistem yöneticisine aittir.",
  MANAGER_CANNOT_ASSIGN_SUPERVISOR:
    "Müdür yalnızca garson, mutfak ve kasiyer rolü verebilir.",
  SELF_ROLE_CHANGE: "Kendi rolünüzü değiştiremezsiniz.",
  SELF_DEACTIVATION: "Kendi hesabınızı pasifleştiremezsiniz.",
  LAST_ADMIN:
    "Restoranın son aktif yöneticisi pasifleştirilemez veya rolü düşürülemez. Önce başka bir yönetici tanımlayın.",
};

const EMAIL = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

/**
 * Emails are compared case-insensitively everywhere, so they are stored the way
 * they are compared. Anything that is not clearly an address is refused here
 * rather than at the auth provider, where the error would be theirs to word.
 */
export function normalizeStaffEmail(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  if (normalized.length === 0 || normalized.length > 254) return null;
  return EMAIL.test(normalized) ? normalized : null;
}
