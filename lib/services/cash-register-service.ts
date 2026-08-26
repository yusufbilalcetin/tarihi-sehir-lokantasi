import "server-only";

import { and, asc, eq, sql } from "drizzle-orm";

import { getDb, type Database } from "@/db";
import { auditLogs, cashRegisters, cashierShifts } from "@/db/schema";
import { DomainError } from "@/lib/api/domain-error";
import { canRoleSuperviseShift } from "@/lib/domain/cashier-shift";
import type { RestaurantPrincipal } from "@/lib/domain/restaurant-scope";

/**
 * Registers are master data. They are deactivated, never deleted: a shift
 * references its register, and a historical shift must keep pointing at a real
 * row. The shift additionally snapshots the register's name at open time, so a
 * later rename cannot rewrite what an old report says.
 */

export interface CashRegisterResult {
  readonly id: string;
  readonly name: string;
  readonly code: string;
  readonly isActive: boolean;
  readonly archived: boolean;
  /** True while a shift is open on it; deactivation is refused until closed. */
  readonly hasOpenShift: boolean;
}

export interface CreateCashRegisterCommand {
  readonly name: string;
  readonly code: string;
  readonly requestId?: string;
}

export interface UpdateCashRegisterCommand {
  readonly registerId: string;
  readonly name?: string;
  readonly isActive?: boolean;
  readonly archived?: boolean;
  readonly requestId?: string;
}

const SELECTION = {
  id: cashRegisters.id,
  name: cashRegisters.name,
  code: cashRegisters.code,
  isActive: cashRegisters.isActive,
  deletedAt: cashRegisters.deletedAt,
} as const;

type RegisterRow = {
  id: string;
  name: string;
  code: string;
  isActive: boolean;
  deletedAt: Date | null;
};

function toResult(row: RegisterRow, hasOpenShift: boolean): CashRegisterResult {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    isActive: row.isActive,
    archived: Boolean(row.deletedAt),
    hasOpenShift,
  };
}

/** Registers are money infrastructure, so they stay supervisory. */
function requireSupervisor(principal: RestaurantPrincipal): void {
  if (!canRoleSuperviseShift(principal.role)) {
    throw new DomainError("FORBIDDEN", "Kasa yönetimi yetkiniz yok.", { httpStatus: 403 });
  }
}

export class CashRegisterService {
  constructor(private readonly db: Database = getDb()) {}

  async list(principal: RestaurantPrincipal): Promise<readonly CashRegisterResult[]> {
    requireSupervisor(principal);
    const rows = await this.db
      .select({
        ...SELECTION,
        openShifts: sql<number>`count(${cashierShifts.id}) filter (where ${cashierShifts.status} = 'OPEN')::int`,
      })
      .from(cashRegisters)
      .leftJoin(
        cashierShifts,
        and(
          eq(cashierShifts.restaurantId, cashRegisters.restaurantId),
          eq(cashierShifts.cashRegisterId, cashRegisters.id),
        ),
      )
      .where(eq(cashRegisters.restaurantId, principal.restaurantId))
      .groupBy(cashRegisters.id)
      .orderBy(asc(cashRegisters.name));
    return rows.map((row) => toResult(row, Number(row.openShifts) > 0));
  }

  async create(
    principal: RestaurantPrincipal,
    command: CreateCashRegisterCommand,
  ): Promise<CashRegisterResult> {
    requireSupervisor(principal);
    const name = command.name.trim();
    const code = command.code.trim().toUpperCase();
    if (!name) {
      throw new DomainError("VALIDATION_ERROR", "Kasa adı gereklidir.", { httpStatus: 400 });
    }

    return this.db.transaction(async (transaction) => {
      const rows = await transaction
        .insert(cashRegisters)
        .values({ restaurantId: principal.restaurantId, name, code })
        .onConflictDoNothing()
        .returning(SELECTION);
      const register = rows[0];
      if (!register) {
        throw new DomainError("CONFLICT", "Bu kasa kodu zaten kullanılıyor.", {
          httpStatus: 409,
        });
      }

      await transaction.insert(auditLogs).values({
        restaurantId: principal.restaurantId,
        actorUserId: principal.userId,
        action: "cash_register.created",
        entityType: "CASH_REGISTER",
        entityId: register.id,
        newValue: { name: register.name, code: register.code },
        requestId: command.requestId,
      });
      return toResult(register, false);
    });
  }

  async update(
    principal: RestaurantPrincipal,
    command: UpdateCashRegisterCommand,
  ): Promise<CashRegisterResult> {
    requireSupervisor(principal);

    return this.db.transaction(async (transaction) => {
      const [current] = await transaction
        .select(SELECTION)
        .from(cashRegisters)
        .where(
          and(
            eq(cashRegisters.restaurantId, principal.restaurantId),
            eq(cashRegisters.id, command.registerId),
          ),
        )
        .for("update")
        .limit(1);
      if (!current) {
        throw new DomainError("NOT_FOUND", "Kasa bulunamadı.", { httpStatus: 404 });
      }

      const [openShift] = await transaction
        .select({ id: cashierShifts.id })
        .from(cashierShifts)
        .where(
          and(
            eq(cashierShifts.restaurantId, principal.restaurantId),
            eq(cashierShifts.cashRegisterId, current.id),
            eq(cashierShifts.status, "OPEN"),
          ),
        )
        .limit(1);

      const deactivating = command.isActive === false || command.archived === true;
      // Taking a till out of service while money is being counted into it would
      // strand the shift, so the shift must be closed first.
      if (deactivating && openShift) {
        throw new DomainError(
          "CONFLICT",
          "Bu kasada açık bir vardiya var; önce vardiyayı kapatın.",
          { httpStatus: 409, details: { shiftId: openShift.id } },
        );
      }

      const changes = Object.fromEntries(
        Object.entries({
          name: command.name?.trim(),
          isActive: command.archived ? false : command.isActive,
          deletedAt:
            command.archived === undefined ? undefined : command.archived ? new Date() : null,
        }).filter(([, value]) => value !== undefined),
      );

      const [updated] = await transaction
        .update(cashRegisters)
        .set({ ...changes, updatedAt: new Date() })
        .where(
          and(
            eq(cashRegisters.restaurantId, principal.restaurantId),
            eq(cashRegisters.id, command.registerId),
          ),
        )
        .returning(SELECTION);
      if (!updated) {
        throw new DomainError("NOT_FOUND", "Kasa bulunamadı.", { httpStatus: 404 });
      }

      await transaction.insert(auditLogs).values({
        restaurantId: principal.restaurantId,
        actorUserId: principal.userId,
        action: "cash_register.updated",
        entityType: "CASH_REGISTER",
        entityId: updated.id,
        oldValue: { name: current.name, isActive: current.isActive },
        newValue: { name: updated.name, isActive: updated.isActive },
        requestId: command.requestId,
      });
      return toResult(updated, Boolean(openShift));
    });
  }
}
