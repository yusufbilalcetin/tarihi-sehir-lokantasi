import "server-only";

import { and, asc, count, eq, ilike, isNull, or, sql } from "drizzle-orm";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getDb, type Database } from "@/db";
import { auditLogs, staffProfiles } from "@/db/schema";
import { DomainError } from "@/lib/api/domain-error";
import type { StaffPrincipal } from "@/lib/auth/foundation";
import {
  STAFF_REFUSAL_MESSAGES,
  canManageStaff,
  checkStaffCreation,
  checkStaffUpdate,
  type StaffMutationDecision,
} from "@/lib/domain/staff-accounts";
import type { UserRole } from "@/lib/domain/status";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { createLogger } from "@/lib/security/logger";

const logger = createLogger("service.admin.staff");

/**
 * Staff accounts.
 *
 * Two systems hold one truth between them: Supabase Auth owns the credential,
 * `staff_profiles` owns the role, the tenant and the history. This service is
 * the only place they are written together, and it is written so that a failure
 * in either one never leaves an account that half exists — an auth user nobody
 * can see, or a profile nobody can sign in as.
 *
 * No password, PIN or reset token passes through here in either direction.
 */

export interface AdminStaffResult {
  readonly id: string;
  readonly name: string;
  readonly email: string | null;
  readonly phone: string | null;
  readonly loginIdentifier: string | null;
  readonly role: UserRole;
  readonly isActive: boolean;
  readonly linkedToAuth: boolean;
  readonly archived: boolean;
  readonly createdAt: string;
  /** From Supabase Auth. `null` means "never signed in", never a made-up date. */
  readonly lastSignInAt: string | null;
}

export interface AdminStaffPage {
  readonly staff: readonly AdminStaffResult[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
  readonly activeAdminCount: number;
}

export interface CreateStaffCommand {
  readonly name: string;
  readonly email: string;
  readonly role: UserRole;
  readonly phone?: string;
  readonly loginIdentifier?: string;
  readonly requestId?: string;
}

export interface UpdateStaffCommand {
  readonly staffId: string;
  readonly name?: string;
  readonly phone?: string | null;
  readonly role?: UserRole;
  readonly isActive?: boolean;
  readonly archived?: boolean;
  readonly email?: string;
  readonly requestId?: string;
}

export interface StaffListFilters {
  readonly role?: UserRole;
  readonly status?: "ACTIVE" | "INACTIVE";
  readonly search?: string;
  readonly page: number;
  readonly pageSize: number;
}

const SELECTION = {
  id: staffProfiles.id,
  name: staffProfiles.name,
  email: staffProfiles.email,
  phone: staffProfiles.phone,
  loginIdentifier: staffProfiles.loginIdentifier,
  role: staffProfiles.role,
  isActive: staffProfiles.isActive,
  authUserId: staffProfiles.authUserId,
  deletedAt: staffProfiles.deletedAt,
  createdAt: staffProfiles.createdAt,
} as const;

type StaffRow = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  loginIdentifier: string | null;
  role: UserRole;
  isActive: boolean;
  authUserId: string | null;
  deletedAt: Date | null;
  createdAt: Date;
};

function toResult(row: StaffRow, lastSignInAt: string | null = null): AdminStaffResult {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    loginIdentifier: row.loginIdentifier,
    role: row.role,
    isActive: row.isActive,
    linkedToAuth: Boolean(row.authUserId),
    archived: Boolean(row.deletedAt),
    createdAt: row.createdAt.toISOString(),
    lastSignInAt,
  };
}

function notFound(): DomainError {
  // A profile in another restaurant and a profile that does not exist answer
  // identically, so the surface cannot be used to discover either.
  return new DomainError("NOT_FOUND", "Personel bulunamadı.", { httpStatus: 404 });
}

function refusal(decision: StaffMutationDecision): DomainError {
  const reason = decision.reason ?? "NOT_A_MANAGER_ROLE";
  const forbidden =
    reason === "NOT_A_MANAGER_ROLE" ||
    reason === "MANAGER_CANNOT_TOUCH_SUPERVISOR" ||
    reason === "MANAGER_CANNOT_ASSIGN_SUPERVISOR";
  return new DomainError(
    forbidden ? "FORBIDDEN" : "CONFLICT",
    STAFF_REFUSAL_MESSAGES[reason],
    { httpStatus: forbidden ? 403 : 409, details: { reason } },
  );
}

/** Supabase's own wording never reaches the operator; only the outcome does. */
function authFailure(
  message: string,
  code: "CONFLICT" | "VALIDATION_ERROR" = "CONFLICT",
  status = 409,
): DomainError {
  return new DomainError(code, message, { httpStatus: status });
}

export class AdminStaffService {
  constructor(
    private readonly db: Database = getDb(),
    private readonly supabase: SupabaseClient = getSupabaseAdminClient(),
  ) {}

  /**
   * Last sign-in lives in Supabase Auth, not in our tables. It is fetched
   * server-side per profile; a lookup that fails leaves `null` rather than a
   * fabricated date, and the browser never sees the auth schema itself.
   */
  private async lastSignIns(
    authUserIds: readonly string[],
  ): Promise<Map<string, string | null>> {
    const result = new Map<string, string | null>();
    await Promise.all(
      authUserIds.map(async (authUserId) => {
        try {
          const { data, error } = await this.supabase.auth.admin.getUserById(authUserId);
          if (error || !data.user) {
            result.set(authUserId, null);
            return;
          }
          result.set(authUserId, data.user.last_sign_in_at ?? null);
        } catch {
          result.set(authUserId, null);
        }
      }),
    );
    return result;
  }

  private requireManagementRole(principal: StaffPrincipal): void {
    if (!canManageStaff(principal.role)) {
      throw refusal({ allowed: false, reason: "NOT_A_MANAGER_ROLE" });
    }
  }

  async list(
    principal: StaffPrincipal,
    filters: StaffListFilters,
  ): Promise<AdminStaffPage> {
    this.requireManagementRole(principal);

    const search = filters.search?.trim();
    const where = and(
      eq(staffProfiles.restaurantId, principal.restaurantId),
      ...(filters.role ? [eq(staffProfiles.role, filters.role)] : []),
      ...(filters.status === "ACTIVE"
        ? [eq(staffProfiles.isActive, true), isNull(staffProfiles.deletedAt)]
        : []),
      ...(filters.status === "INACTIVE"
        ? [or(eq(staffProfiles.isActive, false), sql`${staffProfiles.deletedAt} is not null`)!]
        : []),
      ...(search
        ? [
            or(
              ilike(staffProfiles.name, `%${search}%`),
              ilike(staffProfiles.email, `%${search}%`),
              ilike(staffProfiles.loginIdentifier, `%${search}%`),
            )!,
          ]
        : []),
    );

    // The page, its total and the admin headcount answer three independent
    // questions; sent together they cost one round trip instead of three.
    const [[counted], rows, activeAdminCount] = await Promise.all([
      this.db.select({ total: count() }).from(staffProfiles).where(where),
      this.db
        .select(SELECTION)
        .from(staffProfiles)
        .where(where)
        // Stable tie-break so page two never repeats or skips a colleague.
        .orderBy(asc(staffProfiles.name), asc(staffProfiles.id))
        .limit(filters.pageSize)
        .offset((filters.page - 1) * filters.pageSize),
      this.countActiveAdmins(principal.restaurantId),
    ]);

    const signIns = await this.lastSignIns(
      rows.map((row) => row.authUserId).filter((id): id is string => Boolean(id)),
    );

    return {
      staff: rows.map((row) =>
        toResult(row, row.authUserId ? signIns.get(row.authUserId) ?? null : null),
      ),
      total: Number(counted?.total ?? 0),
      page: filters.page,
      pageSize: filters.pageSize,
      activeAdminCount,
    };
  }

  async detail(principal: StaffPrincipal, staffId: string): Promise<AdminStaffResult> {
    this.requireManagementRole(principal);
    const [row] = await this.db
      .select(SELECTION)
      .from(staffProfiles)
      .where(
        and(
          eq(staffProfiles.restaurantId, principal.restaurantId),
          eq(staffProfiles.id, staffId),
        ),
      )
      .limit(1);
    if (!row) throw notFound();

    const signIns = row.authUserId ? await this.lastSignIns([row.authUserId]) : null;
    return toResult(row, row.authUserId ? signIns?.get(row.authUserId) ?? null : null);
  }

  private async countActiveAdmins(restaurantId: string): Promise<number> {
    const [row] = await this.db
      .select({ total: count() })
      .from(staffProfiles)
      .where(
        and(
          eq(staffProfiles.restaurantId, restaurantId),
          eq(staffProfiles.role, "ADMIN"),
          eq(staffProfiles.isActive, true),
          isNull(staffProfiles.deletedAt),
        ),
      );
    return Number(row?.total ?? 0);
  }

  /**
   * Creates the auth user first and the profile second, because only that order
   * can be undone: an auth user with no profile is deleted here, whereas a
   * profile with no auth user would be a staff member nobody can sign in as and
   * a row that history may already point at.
   *
   * No password is set. The account cannot sign in until its holder sets one
   * through the password-setup link, so a created-but-not-yet-invited account
   * is not a usable credential.
   */
  async create(
    principal: StaffPrincipal,
    command: CreateStaffCommand,
  ): Promise<{ readonly staff: AdminStaffResult; readonly passwordSetupEmailRequested: boolean }> {
    const decision = checkStaffCreation(principal.role, command.role);
    if (!decision.allowed) throw refusal(decision);

    const email = command.email.trim().toLowerCase();

    const created = await this.supabase.auth.admin.createUser({
      email,
      // Confirmed by the administrator who typed it; the password-setup link is
      // what actually proves the mailbox, and it is sent separately.
      email_confirm: true,
    });
    if (created.error || !created.data.user) {
      const duplicate =
        created.error?.status === 422 ||
        /already|registered|exists/i.test(created.error?.message ?? "");
      logger.warn("staff.create.auth_failed", "Supabase could not create the staff login.", {
        duplicate,
      });
      throw authFailure(
        duplicate
          ? "Bu e-posta adresi zaten kullanılıyor."
          : "Personel giriş hesabı oluşturulamadı.",
      );
    }
    const authUserId = created.data.user.id;

    let profile: AdminStaffResult;
    try {
      profile = await this.db.transaction(async (transaction) => {
        const [row] = await transaction
          .insert(staffProfiles)
          .values({
            restaurantId: principal.restaurantId,
            authUserId,
            name: command.name.trim(),
            email,
            phone: command.phone?.trim() || null,
            loginIdentifier: command.loginIdentifier?.trim() || null,
            role: command.role,
            isActive: true,
          })
          .returning(SELECTION);
        if (!row) throw authFailure("Personel kaydı oluşturulamadı.");

        await transaction.insert(auditLogs).values({
          restaurantId: principal.restaurantId,
          actorUserId: principal.userId,
          action: "staff.created",
          entityType: "STAFF_PROFILE",
          entityId: row.id,
          // Identity and role only. No credential of any kind is audited.
          newValue: { name: row.name, role: row.role, email },
          requestId: command.requestId,
        });
        return toResult(row);
      });
    } catch (error) {
      // Compensate: the login must not outlive the profile it was made for.
      const removal = await this.supabase.auth.admin.deleteUser(authUserId);
      if (removal.error) {
        logger.error(
          "staff.create.compensation_failed",
          "Orphaned Supabase auth user could not be removed.",
          { authUserId },
        );
      }
      throw error;
    }

    // Best effort, and never fatal: the account exists either way, and the
    // administrator can re-send the link from the panel.
    const passwordSetupEmailRequested = await this.requestPasswordSetup(email);
    return { staff: profile, passwordSetupEmailRequested };
  }

  /**
   * Asks Supabase to send a password-setup/reset email.
   *
   * The return value means the API call was accepted — **not** that a message
   * was delivered. Delivery depends on SMTP configuration in the Supabase
   * project and can only be confirmed there.
   */
  private async requestPasswordSetup(email: string): Promise<boolean> {
    try {
      const { error } = await this.supabase.auth.resetPasswordForEmail(email);
      if (error) {
        logger.warn("staff.password_setup.not_sent", "Password setup email was not accepted.");
        return false;
      }
      return true;
    } catch {
      logger.warn("staff.password_setup.unavailable", "Password setup email could not be requested.");
      return false;
    }
  }

  async update(
    principal: StaffPrincipal,
    command: UpdateStaffCommand,
  ): Promise<AdminStaffResult> {
    this.requireManagementRole(principal);

    const wantsDeactivation = command.archived === true || command.isActive === false;
    const nextActive = command.archived === true ? false : command.isActive;

    const { updated, previous, emailChange } = await this.db.transaction(async (transaction) => {
      const [current] = await transaction
        .select(SELECTION)
        .from(staffProfiles)
        .where(
          and(
            eq(staffProfiles.restaurantId, principal.restaurantId),
            eq(staffProfiles.id, command.staffId),
          ),
        )
        .for("update")
        .limit(1);
      if (!current) throw notFound();

      // Counted with the admin rows locked, so two administrators deactivating
      // each other at the same moment cannot both pass the last-admin check:
      // the second waits here and then reads the first one's committed result.
      let activeAdminCount = Number.MAX_SAFE_INTEGER;
      if (current.role === "ADMIN" && (wantsDeactivation || command.role)) {
        const admins = await transaction
          .select({ id: staffProfiles.id })
          .from(staffProfiles)
          .where(
            and(
              eq(staffProfiles.restaurantId, principal.restaurantId),
              eq(staffProfiles.role, "ADMIN"),
              eq(staffProfiles.isActive, true),
              isNull(staffProfiles.deletedAt),
            ),
          )
          .for("update");
        activeAdminCount = admins.length;
      }

      const decision = checkStaffUpdate(
        { role: principal.role, staffId: principal.userId },
        { staffId: current.id, role: current.role, isActive: current.isActive && !current.deletedAt },
        { nextRole: command.role, nextActive },
        activeAdminCount,
      );
      if (!decision.allowed) throw refusal(decision);

      const email = command.email?.trim().toLowerCase();
      const changes = Object.fromEntries(
        Object.entries({
          name: command.name?.trim(),
          phone: command.phone,
          role: command.role,
          email,
          isActive: nextActive,
          deletedAt:
            command.archived === undefined ? undefined : command.archived ? new Date() : null,
        }).filter(([, value]) => value !== undefined),
      );

      const [row] = await transaction
        .update(staffProfiles)
        .set({ ...changes, updatedAt: new Date() })
        .where(
          and(
            eq(staffProfiles.restaurantId, principal.restaurantId),
            eq(staffProfiles.id, command.staffId),
          ),
        )
        .returning(SELECTION);
      if (!row) throw notFound();

      const actions: string[] = [];
      if (command.role && command.role !== current.role) actions.push("staff.role_changed");
      if (nextActive === false && current.isActive) actions.push("staff.deactivated");
      if (nextActive === true && !current.isActive) actions.push("staff.activated");
      if (email && email !== current.email) actions.push("staff.email_changed");
      if (actions.length === 0) actions.push("staff.updated");

      for (const action of actions) {
        await transaction.insert(auditLogs).values({
          restaurantId: principal.restaurantId,
          actorUserId: principal.userId,
          action,
          entityType: "STAFF_PROFILE",
          entityId: row.id,
          oldValue: { role: current.role, isActive: current.isActive, email: current.email },
          newValue: { role: row.role, isActive: row.isActive, email: row.email },
          requestId: command.requestId,
        });
      }

      return {
        updated: row,
        previous: current,
        emailChange:
          email && email !== current.email
            ? { authUserId: current.authUserId, email, previousEmail: current.email }
            : null,
      };
    });

    // The address the account signs in with lives in Supabase. It is changed
    // after the profile commits, and the profile is rolled back by hand if the
    // provider refuses, so the two never disagree about who signs in as whom.
    if (emailChange?.authUserId) {
      const { error } = await this.supabase.auth.admin.updateUserById(emailChange.authUserId, {
        email: emailChange.email,
        email_confirm: true,
      });
      if (error) {
        await this.db
          .update(staffProfiles)
          .set({ email: emailChange.previousEmail, updatedAt: new Date() })
          .where(
            and(
              eq(staffProfiles.restaurantId, principal.restaurantId),
              eq(staffProfiles.id, command.staffId),
            ),
          );
        logger.warn("staff.email_change.rejected", "Supabase refused the new sign-in address.");
        throw authFailure("Bu e-posta adresi kullanılamıyor.");
      }
    }

    void previous;
    return toResult(updated);
  }

  /**
   * Sends a password-setup/reset link to the account's own address.
   *
   * The administrator never sees, sets or receives the password, and no link or
   * token is returned to the caller or written to the audit trail.
   */
  async requestPasswordReset(
    principal: StaffPrincipal,
    staffId: string,
    requestId?: string,
  ): Promise<{ readonly emailRequested: boolean; readonly email: string }> {
    this.requireManagementRole(principal);

    const [row] = await this.db
      .select(SELECTION)
      .from(staffProfiles)
      .where(
        and(
          eq(staffProfiles.restaurantId, principal.restaurantId),
          eq(staffProfiles.id, staffId),
        ),
      )
      .limit(1);
    if (!row) throw notFound();

    const decision = checkStaffUpdate(
      { role: principal.role, staffId: principal.userId },
      { staffId: row.id, role: row.role, isActive: row.isActive },
      {},
      Number.MAX_SAFE_INTEGER,
    );
    if (!decision.allowed) throw refusal(decision);
    if (!row.email) {
      throw authFailure("Bu personelin tanımlı e-posta adresi yok.", "VALIDATION_ERROR", 400);
    }

    const emailRequested = await this.requestPasswordSetup(row.email);

    await this.db.insert(auditLogs).values({
      restaurantId: principal.restaurantId,
      actorUserId: principal.userId,
      action: "staff.password_reset_requested",
      entityType: "STAFF_PROFILE",
      entityId: row.id,
      // The address, and whether the provider accepted the request. No token.
      newValue: { email: row.email, emailRequested },
      requestId,
    });

    return { emailRequested, email: row.email };
  }
}
