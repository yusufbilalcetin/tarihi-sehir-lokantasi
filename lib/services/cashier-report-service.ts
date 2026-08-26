import { DomainError } from "@/lib/api/domain-error";
import {
  NON_FISCAL_DISCLAIMER,
  buildXReport,
  countBreakdown,
  sumBreakdown,
  summaryFromMethodTotals,
  toMethodBreakdown,
  UnsupportedSnapshotVersionError,
  type MethodBreakdownRow,
  type MethodTotals,
  type XReport,
  type ZReportSnapshot,
} from "@/lib/domain/cashier-report";
import {
  SHIFT_OPERATOR_ROLES,
  SHIFT_SUPERVISOR_ROLES,
  canRoleSuperviseShift,
} from "@/lib/domain/cashier-shift";
import { addMoney, decimalToMinor, minorToDecimal, subtractMoney } from "@/lib/domain/money";
import {
  addDays,
  parseDay,
  startOfLocalDay,
  RESTAURANT_UTC_OFFSET_MINUTES,
} from "@/lib/domain/report-range";
import {
  authorizeRestaurantAccess,
  type RestaurantPrincipal,
} from "@/lib/domain/restaurant-scope";
import type { UserRole } from "@/lib/domain/status";
import type {
  CashierShiftRepository,
  DailyExceptionRow,
  DailyGroupTotals,
  DailyMoneyTotals,
  DailyShiftRow,
  DailyWindow,
} from "@/lib/repositories/cashier-shift-repository";
import { CorruptSnapshotError, parseZSnapshot } from "@/lib/validation/cashier-report";

/**
 * Operational cash reporting: the live X view of an open drawer, the stored Z
 * report of a closed one, and the restaurant's end-of-day cash picture.
 *
 * None of these are fiscal documents — see `lib/domain/cashier-report.ts`.
 *
 * All money arithmetic is reused from Phase 8A's helpers. This service decides
 * *what* to report and *who* may see it; it never re-derives expected cash by
 * a second route.
 */

export interface DailyGroupReport {
  readonly id: string;
  readonly name: string;
  readonly paymentMethodBreakdown: readonly MethodBreakdownRow[];
  readonly grossCollected: string;
  readonly refundMethodBreakdown: readonly MethodBreakdownRow[];
  readonly totalRefunds: string;
  readonly netCollected: string;
  readonly cashIn: string;
  readonly cashOut: string;
  /** Cash that physically moved through this group's drawers on the day. */
  readonly cashMovementNet: string;
}

export interface DailyShiftReport {
  readonly id: string;
  readonly registerId: string;
  readonly registerName: string;
  readonly cashierId: string;
  readonly cashierName: string | null;
  readonly openedAt: string;
  readonly closedAt: string | null;
  readonly status: "OPEN" | "CLOSED";
  readonly expectedCash: string | null;
  readonly countedCash: string | null;
  readonly cashVariance: string | null;
  readonly hasZReport: boolean;
}

export interface DailyCashReport {
  readonly reportType: "DAILY";
  readonly restaurantId: string;
  readonly restaurantName: string;
  readonly businessDate: string;
  readonly timezoneOffsetMinutes: number;
  readonly generatedAt: string;
  readonly paymentMethodBreakdown: readonly MethodBreakdownRow[];
  readonly grossCollected: string;
  readonly paymentCount: number;
  readonly refundMethodBreakdown: readonly MethodBreakdownRow[];
  readonly totalRefunds: string;
  readonly refundCount: number;
  readonly netCollected: string;
  readonly cashPaymentTotal: string;
  readonly cashRefundTotal: string;
  readonly cashIn: string;
  readonly cashOut: string;
  readonly movementCount: number;
  readonly openedShiftCount: number;
  readonly closedShiftCount: number;
  readonly openShiftCount: number;
  readonly zReportCount: number;
  /**
   * The sum of the variances of shifts *closed* on this day. Deliberately
   * separate from the day's transaction totals: it answers a different
   * question, about drawers rather than about takings.
   */
  readonly closedShiftVarianceTotal: string;
  readonly registerBreakdown: readonly DailyGroupReport[];
  readonly cashierBreakdown: readonly DailyGroupReport[];
  readonly shifts: readonly DailyShiftReport[];
  readonly exceptions: readonly DailyExceptionRow[];
  /** Neutral operational notices, never accusations. */
  readonly warnings: readonly string[];
  readonly nonFiscalNotice: string;
}

function forbidden(action: string): DomainError {
  return new DomainError("FORBIDDEN", `${action} yetkiniz yok.`, { httpStatus: 403 });
}

function notFound(): DomainError {
  return new DomainError("NOT_FOUND", "Vardiya bulunamadı.", { httpStatus: 404 });
}

function money(value: string | null | undefined): string {
  return value ?? "0.00";
}

export class CashierReportService {
  constructor(private readonly repository: CashierShiftRepository) {}

  /**
   * Live snapshot of an open drawer. Reading it changes nothing: no row is
   * written, the shift stays OPEN, and collections keep being accepted.
   */
  async xReport(
    principal: RestaurantPrincipal | null | undefined,
    shiftId: string,
  ): Promise<XReport> {
    const actor = this.authorize(principal, SHIFT_OPERATOR_ROLES, "X raporu");
    const shift = await this.repository.findShift(actor.restaurantId, shiftId);
    if (!shift) throw notFound();
    if (shift.openedByStaffId !== actor.userId && !canRoleSuperviseShift(actor.role)) {
      throw notFound();
    }
    if (shift.status !== "OPEN") {
      throw new DomainError(
        "CASHIER_SHIFT_CLOSED",
        "Bu vardiya kapatılmış; Z raporunu görüntüleyin.",
        { httpStatus: 409, details: { shiftId: shift.id } },
      );
    }

    const [totals, restaurantName] = await Promise.all([
      this.repository.ledgerTotals(actor.restaurantId, shift.id),
      this.repository.findRestaurantName(actor.restaurantId),
    ]);
    const summary = summaryFromMethodTotals({
      openingCash: shift.openingCash,
      paymentsByMethod: totals.paymentsByMethod,
      refundsByMethod: totals.refundsByMethod,
      cashIn: totals.cashIn,
      cashOut: totals.cashOut,
    });

    return buildXReport(
      {
        identity: {
          restaurantId: actor.restaurantId,
          restaurantNameSnapshot: restaurantName ?? "",
          registerId: shift.cashRegisterId,
          registerNameSnapshot: shift.registerNameSnapshot,
          shiftId: shift.id,
          openedByStaffId: shift.openedByStaffId,
          openedByNameSnapshot: shift.openedByName,
          openedAt: shift.openedAt.toISOString(),
        },
        summary,
        paymentsByMethod: totals.paymentsByMethod,
        refundsByMethod: totals.refundsByMethod,
        movementCount: totals.movementCount,
      },
      new Date(),
    );
  }

  /**
   * The stored Z report of a closed shift. It is read back and validated, never
   * recomputed — asking twice returns the identical document, and a refund
   * issued by a later shift cannot change it.
   */
  async zReport(
    principal: RestaurantPrincipal | null | undefined,
    shiftId: string,
  ): Promise<ZReportSnapshot> {
    const actor = this.authorize(principal, SHIFT_OPERATOR_ROLES, "Z raporu");
    const shift = await this.repository.findShift(actor.restaurantId, shiftId);
    if (!shift) throw notFound();
    if (shift.openedByStaffId !== actor.userId && !canRoleSuperviseShift(actor.role)) {
      throw notFound();
    }
    if (shift.status !== "CLOSED") {
      throw new DomainError(
        "CASHIER_SHIFT_NOT_CLOSED",
        "Z raporu yalnız kapatılmış vardiya için oluşturulur.",
        { httpStatus: 409, details: { shiftId: shift.id } },
      );
    }
    if (!shift.zReportSnapshot) {
      // Closed before Phase 8B. No report is reconstructed for it: an invented
      // document would be indistinguishable from a real one.
      throw new DomainError(
        "LEGACY_SHIFT_WITHOUT_Z_SNAPSHOT",
        "Bu vardiya Z raporu özelliğinden önce kapatılmış; kayıtlı Z raporu yok.",
        { httpStatus: 409, details: { shiftId: shift.id, closedAt: shift.closedAt?.toISOString() ?? null } },
      );
    }

    try {
      return parseZSnapshot(shift.zReportSnapshot);
    } catch (error) {
      if (error instanceof UnsupportedSnapshotVersionError) {
        throw new DomainError(
          "CONFLICT",
          "Bu Z raporu daha yeni bir sürümle oluşturulmuş ve görüntülenemiyor.",
          { httpStatus: 409 },
        );
      }
      if (error instanceof CorruptSnapshotError) {
        // Never render a half-parsed financial document.
        throw new DomainError("INTERNAL_ERROR", "Z raporu okunamadı.", {
          httpStatus: 500,
          expose: false,
        });
      }
      throw error;
    }
  }

  /**
   * The restaurant's cash picture for one *local calendar day*.
   *
   * Every figure is scoped by the transaction's own timestamp, so a shift that
   * runs past midnight contributes each collection to the day it happened on.
   * No business-day cutoff (04:00 and the like) is invented here — that is a
   * product decision nobody has made.
   */
  async dailyReport(
    principal: RestaurantPrincipal | null | undefined,
    query: {
      readonly date: string;
      readonly registerId?: string;
      readonly cashierId?: string;
    },
  ): Promise<DailyCashReport> {
    const actor = this.authorize(principal, SHIFT_SUPERVISOR_ROLES, "Gün sonu raporu");
    const day = parseDay(query.date);
    const window: DailyWindow = {
      restaurantId: actor.restaurantId,
      start: startOfLocalDay(day),
      endExclusive: startOfLocalDay(addDays(day, 1)),
      cashRegisterId: query.registerId,
      cashierId: query.cashierId,
    };

    const [totals, byRegister, byCashier, shifts, exceptions, restaurantName] =
      await Promise.all([
        this.repository.dailyTotals(window),
        this.repository.dailyByRegister(window),
        this.repository.dailyByCashier(window),
        this.repository.dailyShifts(window),
        this.repository.dailyExceptions(window),
        this.repository.findRestaurantName(actor.restaurantId),
      ]);

    const payments = toMethodBreakdown(totals.paymentsByMethod);
    const refunds = toMethodBreakdown(totals.refundsByMethod);
    const gross = sumBreakdown(payments);
    const refunded = sumBreakdown(refunds);

    const openedToday = shifts.filter(
      (shift) => shift.openedAt >= window.start && shift.openedAt < window.endExclusive,
    );
    const closedToday = shifts.filter(
      (shift) =>
        shift.closedAt !== null &&
        shift.closedAt >= window.start &&
        shift.closedAt < window.endExclusive,
    );
    const stillOpen = shifts.filter((shift) => shift.status === "OPEN");

    const warnings: string[] = [];
    if (stillOpen.length > 0) {
      warnings.push(
        `Gün sonu tamamlanmamış: ${stillOpen.length} açık kasa vardiyası mevcut.`,
      );
    }
    const legacy = closedToday.filter((shift) => !shift.hasZReport);
    if (legacy.length > 0) {
      warnings.push(
        `${legacy.length} kapalı vardiyanın kayıtlı Z raporu yok (Z raporu özelliğinden önce kapatılmış).`,
      );
    }

    return {
      reportType: "DAILY",
      restaurantId: actor.restaurantId,
      restaurantName: restaurantName ?? "",
      businessDate: query.date,
      timezoneOffsetMinutes: RESTAURANT_UTC_OFFSET_MINUTES,
      generatedAt: new Date().toISOString(),
      paymentMethodBreakdown: payments,
      grossCollected: gross,
      paymentCount: countBreakdown(payments),
      refundMethodBreakdown: refunds,
      totalRefunds: refunded,
      refundCount: countBreakdown(refunds),
      netCollected: minorToDecimal(
        subtractMoney(decimalToMinor(gross), decimalToMinor(refunded)),
      ),
      cashPaymentTotal: totals.paymentsByMethod.CASH.amount,
      cashRefundTotal: totals.refundsByMethod.CASH.amount,
      cashIn: totals.cashIn,
      cashOut: totals.cashOut,
      movementCount: totals.movementCount,
      openedShiftCount: openedToday.length,
      closedShiftCount: closedToday.length,
      openShiftCount: stillOpen.length,
      zReportCount: closedToday.filter((shift) => shift.hasZReport).length,
      closedShiftVarianceTotal: minorToDecimal(
        addMoney(
          ...closedToday.map((shift) =>
            decimalToMinor(money(shift.cashVariance), { allowNegative: true }),
          ),
        ),
      ),
      registerBreakdown: byRegister.map(toGroupReport),
      cashierBreakdown: byCashier.map(toGroupReport),
      shifts: shifts.map(toShiftReport),
      exceptions,
      warnings,
      nonFiscalNotice: NON_FISCAL_DISCLAIMER,
    };
  }

  private authorize(
    principal: RestaurantPrincipal | null | undefined,
    allowedRoles: readonly UserRole[],
    action: string,
  ): RestaurantPrincipal {
    const decision = authorizeRestaurantAccess(principal, principal?.restaurantId ?? "", {
      allowedRoles,
    });
    if (decision.allowed) return decision.principal;
    if (decision.reason === "AUTHENTICATION_REQUIRED") {
      throw new DomainError("AUTHENTICATION_REQUIRED", "Oturum açmanız gerekiyor.", {
        httpStatus: 401,
      });
    }
    throw forbidden(action);
  }
}

function toGroupReport(group: DailyGroupTotals): DailyGroupReport {
  const payments = toMethodBreakdown(group.paymentsByMethod);
  const refunds = toMethodBreakdown(group.refundsByMethod);
  const gross = sumBreakdown(payments);
  const refunded = sumBreakdown(refunds);
  return {
    id: group.groupId,
    name: group.groupName,
    paymentMethodBreakdown: payments,
    grossCollected: gross,
    refundMethodBreakdown: refunds,
    totalRefunds: refunded,
    netCollected: minorToDecimal(
      subtractMoney(decimalToMinor(gross), decimalToMinor(refunded)),
    ),
    cashIn: group.cashIn,
    cashOut: group.cashOut,
    cashMovementNet: minorToDecimal(
      subtractMoney(decimalToMinor(group.cashIn), decimalToMinor(group.cashOut)),
    ),
  };
}

function toShiftReport(shift: DailyShiftRow): DailyShiftReport {
  return {
    id: shift.id,
    registerId: shift.cashRegisterId,
    registerName: shift.registerNameSnapshot,
    cashierId: shift.openedByStaffId,
    cashierName: shift.openedByName,
    openedAt: shift.openedAt.toISOString(),
    closedAt: shift.closedAt?.toISOString() ?? null,
    status: shift.status,
    expectedCash: shift.expectedCashAtClose,
    countedCash: shift.countedCashAtClose,
    cashVariance: shift.cashVariance,
    hasZReport: shift.hasZReport,
  };
}

export type { MethodTotals, DailyMoneyTotals };
