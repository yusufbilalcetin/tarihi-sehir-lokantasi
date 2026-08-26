import { DomainError } from "../api/domain-error";
import { calculateOrderBalance } from "../domain/financial-operations";
import { decimalToMinor, minorToDecimal } from "../domain/money";
import {
  authorizeRestaurantAccess,
  type RestaurantPrincipal,
} from "../domain/restaurant-scope";
import type { UserRole, WaiterCallType } from "../domain/status";
import {
  TABLE_MERGE_ROLES,
  TABLE_RESET_BLOCK_MESSAGES,
  TABLE_RESET_ROLES,
  TABLE_TRANSFER_ROLES,
  deriveTableStatus,
  tableResetBlockReason,
} from "../domain/table-operations";
import type { RepositoryJsonObject } from "../repositories/order-repository";
import type {
  TableOperationCallRecord,
  TableOperationTableRecord,
  TableOperationsRepository,
  TableOperationsTransactionRepository,
} from "../repositories/table-operations-repository";

export interface TableMoveCommand {
  readonly sourceTableId: string;
  readonly targetTableId: string;
  readonly requestId?: string;
}

export interface TableResetCommand {
  readonly tableId: string;
  readonly requestId?: string;
}

export interface MovedTableSummary {
  readonly id: string;
  readonly name: string;
  readonly number: number;
  readonly status: string;
}

export interface TableMoveResult {
  readonly source: MovedTableSummary;
  readonly target: MovedTableSummary;
  readonly movedOrderIds: readonly string[];
  readonly movedCallIds: readonly string[];
  /** Source requests dropped because the target already had that type open. */
  readonly resolvedCallIds: readonly string[];
}

export interface TableResetResult {
  readonly table: MovedTableSummary;
}

export interface TableOperationsServiceOptions {
  readonly clock?: () => Date;
}

function authorize(
  principal: RestaurantPrincipal | null | undefined,
  allowedRoles: readonly UserRole[],
  action: string,
): RestaurantPrincipal {
  const decision = authorizeRestaurantAccess(principal, principal?.restaurantId ?? "", {
    allowedRoles,
  });
  if (decision.allowed) return decision.principal;
  const authenticationFailure = decision.reason === "AUTHENTICATION_REQUIRED";
  throw new DomainError(
    authenticationFailure ? "AUTHENTICATION_REQUIRED" : "FORBIDDEN",
    authenticationFailure ? "Oturum açmanız gerekiyor." : `${action} yetkiniz yok.`,
    { httpStatus: authenticationFailure ? 401 : 403 },
  );
}

function summary(
  table: TableOperationTableRecord,
  status: string,
): MovedTableSummary {
  return { id: table.id, name: table.name, number: table.tableNumber, status };
}

export class TableOperationsService {
  private readonly clock: () => Date;

  constructor(
    private readonly repository: TableOperationsRepository,
    options: TableOperationsServiceOptions = {},
  ) {
    this.clock = options.clock ?? (() => new Date());
  }

  /**
   * Moves a party to an empty table. Everything still running on the source —
   * orders and open requests — lands on the target inside one transaction, so a
   * failure never leaves half a party behind.
   */
  async transfer(
    principal: RestaurantPrincipal | null | undefined,
    command: TableMoveCommand,
  ): Promise<TableMoveResult> {
    const actor = authorize(principal, TABLE_TRANSFER_ROLES, "Masa taşıma");
    return this.move(actor, command, "TRANSFER");
  }

  /**
   * Folds a running table into another one. Orders keep their ids and numbers,
   * so the merged table shows two rounds rather than one rewritten order.
   */
  async merge(
    principal: RestaurantPrincipal | null | undefined,
    command: TableMoveCommand,
  ): Promise<TableMoveResult> {
    const actor = authorize(principal, TABLE_MERGE_ROLES, "Masa birleştirme");
    return this.move(actor, command, "MERGE");
  }

  private async move(
    actor: RestaurantPrincipal,
    command: TableMoveCommand,
    operation: "TRANSFER" | "MERGE",
  ): Promise<TableMoveResult> {
    if (!command.sourceTableId || !command.targetTableId) {
      throw new DomainError("VALIDATION_ERROR", "Kaynak ve hedef masa gereklidir.", {
        httpStatus: 400,
      });
    }
    if (command.sourceTableId === command.targetTableId) {
      throw new DomainError("VALIDATION_ERROR", "Kaynak ve hedef masa aynı olamaz.", {
        httpStatus: 400,
      });
    }

    return this.repository.transaction(async (transaction) => {
      const tables = await transaction.findTablesForUpdate(actor.restaurantId, [
        command.sourceTableId,
        command.targetTableId,
      ]);
      const source = tables.find((table) => table.id === command.sourceTableId);
      const target = tables.find((table) => table.id === command.targetTableId);
      // A table from another restaurant simply is not in this tenant's result.
      if (!source || !target) {
        throw new DomainError("TABLE_NOT_FOUND", "Masa bulunamadı.", { httpStatus: 404 });
      }
      if (!target.isActive) {
        throw new DomainError("TABLE_INACTIVE", "Hedef masa servis dışı.", { httpStatus: 409 });
      }

      const sourceOrders = await transaction.listOpenOrders(actor.restaurantId, source.id);
      const sourceCalls = await transaction.listActiveCalls(actor.restaurantId, source.id);
      const targetOrders = await transaction.listOpenOrders(actor.restaurantId, target.id);
      const targetCalls = await transaction.listActiveCalls(actor.restaurantId, target.id);

      if (operation === "TRANSFER" && (targetOrders.length > 0 || targetCalls.length > 0)) {
        throw new DomainError(
          "TABLE_TARGET_OCCUPIED",
          "Hedef masada aktif işlem bulunuyor. Masa birleştirme işlemini kullanın.",
          { httpStatus: 409 },
        );
      }
      if (sourceOrders.length === 0 && sourceCalls.length === 0) {
        throw new DomainError(
          operation === "MERGE" ? "TABLE_MERGE_CONFLICT" : "TABLE_TRANSFER_CONFLICT",
          "Kaynak masada taşınacak aktif işlem yok.",
          { httpStatus: 409 },
        );
      }

      const at = this.clock();
      const orderIds = sourceOrders.map((order) => order.id);
      const moved = await transaction.moveOrders(
        actor.restaurantId,
        orderIds,
        target.id,
        at,
      );
      if (moved !== orderIds.length) {
        // Something changed under the lock; refuse rather than move a subset.
        throw new DomainError(
          operation === "MERGE" ? "TABLE_MERGE_CONFLICT" : "TABLE_TRANSFER_CONFLICT",
          "Masa işlemi sırasında siparişler değişti. Lütfen tekrar deneyin.",
          { httpStatus: 409 },
        );
      }

      const { movedCallIds, resolvedCallIds } = await this.relocateCalls(
        transaction,
        actor,
        sourceCalls,
        targetCalls,
        target.id,
        at,
      );

      const targetCallTypes: WaiterCallType[] = [
        ...targetCalls.map((call) => call.type),
        ...sourceCalls
          .filter((call) => movedCallIds.includes(call.id))
          .map((call) => call.type),
      ];
      const targetStatus = deriveTableStatus({
        isActive: target.isActive,
        openOrderCount: targetOrders.length + sourceOrders.length,
        activeCallTypes: targetCallTypes,
      });
      const sourceStatus = deriveTableStatus({
        isActive: source.isActive,
        openOrderCount: 0,
        activeCallTypes: [],
      });
      await transaction.setTableStatus(actor.restaurantId, target.id, targetStatus, at);
      await transaction.setTableStatus(actor.restaurantId, source.id, sourceStatus, at);

      const eventType = operation === "MERGE" ? "TABLES_MERGED" : "TABLE_TRANSFERRED";
      const payload: RepositoryJsonObject = {
        sourceTableId: source.id,
        sourceTableNumber: source.tableNumber,
        targetTableId: target.id,
        targetTableNumber: target.tableNumber,
        movedOrderCount: orderIds.length,
        status: targetStatus,
        updatedAt: at.toISOString(),
      };
      await transaction.insertOutbox({
        restaurantId: actor.restaurantId,
        aggregateType: "TABLE",
        aggregateId: target.id,
        eventType,
        payload,
      });
      await transaction.insertAudit({
        restaurantId: actor.restaurantId,
        actorUserId: actor.userId,
        action: operation === "MERGE" ? "table.merged" : "table.transferred",
        entityType: "TABLE",
        entityId: target.id,
        oldValue: {
          sourceTableId: source.id,
          sourceStatus: source.currentStatus,
          targetStatus: target.currentStatus,
        },
        newValue: { targetTableId: target.id, targetStatus, sourceStatus },
        metadata: {
          movedOrders: sourceOrders.map((order) => ({
            id: order.id,
            orderNumber: order.orderNumber,
            status: order.status,
          })),
          movedCallIds: [...movedCallIds],
          resolvedCallIds: [...resolvedCallIds],
        },
        requestId: command.requestId,
      });

      return {
        source: summary(source, sourceStatus),
        target: summary(target, targetStatus),
        movedOrderIds: orderIds,
        movedCallIds,
        resolvedCallIds,
      };
    });
  }

  /**
   * A source request moves across unless the target already has one of that
   * type open — the database allows only one active request per (table, type),
   * so the duplicate is resolved instead of colliding with the unique index.
   */
  private async relocateCalls(
    transaction: TableOperationsTransactionRepository,
    actor: RestaurantPrincipal,
    sourceCalls: readonly TableOperationCallRecord[],
    targetCalls: readonly TableOperationCallRecord[],
    targetTableId: string,
    at: Date,
  ): Promise<{ movedCallIds: string[]; resolvedCallIds: string[] }> {
    const occupiedTypes = new Set(targetCalls.map((call) => call.type));
    const movedCallIds: string[] = [];
    const resolvedCallIds: string[] = [];

    for (const call of sourceCalls) {
      if (occupiedTypes.has(call.type)) {
        if (await transaction.resolveCall(actor.restaurantId, call.id, actor.userId, at)) {
          resolvedCallIds.push(call.id);
        }
        continue;
      }
      if (await transaction.moveCall(actor.restaurantId, call.id, targetTableId, at)) {
        occupiedTypes.add(call.type);
        movedCallIds.push(call.id);
      }
    }

    return { movedCallIds, resolvedCallIds };
  }

  /**
   * Clears a settled table. Every blocker below is a financial or service
   * record, so reset refuses rather than deleting one; there is deliberately no
   * manager override.
   */
  async reset(
    principal: RestaurantPrincipal | null | undefined,
    command: TableResetCommand,
  ): Promise<TableResetResult> {
    const actor = authorize(principal, TABLE_RESET_ROLES, "Masa sıfırlama");

    return this.repository.transaction(async (transaction) => {
      const [table] = await transaction.findTablesForUpdate(actor.restaurantId, [
        command.tableId,
      ]);
      if (!table) {
        throw new DomainError("TABLE_NOT_FOUND", "Masa bulunamadı.", { httpStatus: 404 });
      }

      const [balances, openChecks, pendingPayments, activeCalls] = await Promise.all([
        transaction.listUnclosedOrderBalances(actor.restaurantId, table.id),
        transaction.listOpenChecks(actor.restaurantId, table.id),
        transaction.countPendingPayments(actor.restaurantId, table.id),
        transaction.listActiveCalls(actor.restaurantId, table.id),
      ]);

      // One shared formula decides what each unclosed order still owes, so the
      // reset guard and the cashier screen can never disagree.
      const outstandingMinor = balances.reduce((total, order) => {
        const balance = calculateOrderBalance(order.total, [
          {
            amount: order.paidTotal,
            refundedAmount: order.refundedTotal,
            counted: true,
          },
        ]);
        return total + Math.max(0, decimalToMinor(balance.outstanding));
      }, 0);

      const blockers = {
        openOrderCount: balances.filter((order) => order.status !== "SERVED").length,
        outstandingBalanceMinor: outstandingMinor,
        openCheckCount: openChecks.length,
        partiallyPaidCheckCount: openChecks.filter(
          (check) => Number(check.paidTotal) > 0,
        ).length,
        pendingPaymentCount: pendingPayments,
        openCallCount: activeCalls.length,
      };
      const blocked = tableResetBlockReason(blockers);
      if (blocked) {
        throw new DomainError("TABLE_RESET_BLOCKED", TABLE_RESET_BLOCK_MESSAGES[blocked], {
          httpStatus: 409,
          details: {
            reason: blocked,
            outstanding: minorToDecimal(outstandingMinor),
            openCheckCount: blockers.openCheckCount,
          },
        });
      }

      const at = this.clock();
      const status = deriveTableStatus({
        isActive: table.isActive,
        openOrderCount: 0,
        activeCallTypes: [],
      });
      await transaction.setTableStatus(actor.restaurantId, table.id, status, at);

      const payload: RepositoryJsonObject = {
        tableId: table.id,
        tableNumber: table.tableNumber,
        status,
        updatedAt: at.toISOString(),
      };
      await transaction.insertOutbox({
        restaurantId: actor.restaurantId,
        aggregateType: "TABLE",
        aggregateId: table.id,
        eventType: "TABLE_RESET",
        payload,
      });
      await transaction.insertAudit({
        restaurantId: actor.restaurantId,
        actorUserId: actor.userId,
        action: "table.reset",
        entityType: "TABLE",
        entityId: table.id,
        oldValue: { status: table.currentStatus },
        newValue: { status },
        metadata: { tableNumber: table.tableNumber },
        requestId: command.requestId,
      });

      return { table: summary(table, status) };
    });
  }
}
