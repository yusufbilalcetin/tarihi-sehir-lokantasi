import "server-only";

import { and, desc, eq, inArray, sql } from "drizzle-orm";

import type { Database } from "../../db";
import {
  auditLogs,
  outboxEvents,
  restaurants,
  restaurantSettings,
  restaurantTables,
  waiterCalls,
} from "../../db/schema";
import type {
  CreateCustomerWaiterCallRecordInput,
  CustomerCallContextRecord,
  CustomerWaiterCallRecord,
  InsertCustomerCallAuditInput,
  InsertCustomerCallOutboxInput,
  WaiterCallRepository,
  WaiterCallTransactionRepository,
} from "./waiter-call-repository";

type TransactionDatabase = Parameters<Parameters<Database["transaction"]>[0]>[0];

const CALL_SELECTION = {
  id: waiterCalls.id,
  restaurantId: waiterCalls.restaurantId,
  tableId: waiterCalls.tableId,
  type: waiterCalls.type,
  status: waiterCalls.status,
  notes: waiterCalls.notes,
  tableTokenVersion: waiterCalls.tableTokenVersion,
  createdAt: waiterCalls.createdAt,
} as const;

class DrizzleWaiterCallTransactionRepository
  implements WaiterCallTransactionRepository
{
  constructor(private readonly db: TransactionDatabase) {}

  async findContextForUpdate(
    restaurantId: string,
    tableId: string,
  ): Promise<CustomerCallContextRecord | null> {
    const rows = await this.db
      .select({
        restaurantId: restaurants.id,
        restaurantIsActive: restaurants.isActive,
        tableId: restaurantTables.id,
        tableName: restaurantTables.name,
        tableNumber: restaurantTables.tableNumber,
        tableIsActive: restaurantTables.isActive,
        tableTokenVersion: restaurantTables.qrTokenVersion,
        tableTokenRevokedAt: restaurantTables.qrTokenRevokedAt,
        waiterCallEnabled: sql<boolean>`coalesce(${restaurantSettings.waiterCallEnabled}, false)`,
        billRequestEnabled: sql<boolean>`coalesce(${restaurantSettings.billRequestEnabled}, false)`,
        waiterCallCooldownSeconds: sql<number>`coalesce(${restaurantSettings.waiterCallCooldownSeconds}, 30)`,
      })
      .from(restaurantTables)
      .innerJoin(restaurants, eq(restaurants.id, restaurantTables.restaurantId))
      .leftJoin(
        restaurantSettings,
        eq(restaurantSettings.restaurantId, restaurants.id),
      )
      .where(
        and(
          eq(restaurantTables.restaurantId, restaurantId),
          eq(restaurantTables.id, tableId),
        ),
      )
      .for("update", { of: restaurantTables })
      .limit(1);
    return rows[0] ?? null;
  }

  async findActiveCall(
    restaurantId: string,
    tableId: string,
    type: "WAITER_CALL" | "BILL_REQUEST",
  ): Promise<CustomerWaiterCallRecord | null> {
    const rows = await this.db
      .select(CALL_SELECTION)
      .from(waiterCalls)
      .where(
        and(
          eq(waiterCalls.restaurantId, restaurantId),
          eq(waiterCalls.tableId, tableId),
          eq(waiterCalls.type, type),
          inArray(waiterCalls.status, ["OPEN", "ACKNOWLEDGED"]),
        ),
      )
      .orderBy(desc(waiterCalls.createdAt))
      .limit(1);
    return rows[0] ?? null;
  }

  async findMostRecentCall(
    restaurantId: string,
    tableId: string,
    type: "WAITER_CALL" | "BILL_REQUEST",
  ): Promise<CustomerWaiterCallRecord | null> {
    const rows = await this.db
      .select(CALL_SELECTION)
      .from(waiterCalls)
      .where(
        and(
          eq(waiterCalls.restaurantId, restaurantId),
          eq(waiterCalls.tableId, tableId),
          eq(waiterCalls.type, type),
        ),
      )
      .orderBy(desc(waiterCalls.createdAt))
      .limit(1);
    return rows[0] ?? null;
  }

  async insertCall(
    input: CreateCustomerWaiterCallRecordInput,
  ): Promise<CustomerWaiterCallRecord | null> {
    const rows = await this.db
      .insert(waiterCalls)
      .values({
        restaurantId: input.restaurantId,
        tableId: input.tableId,
        type: input.type,
        notes: input.notes,
        status: "OPEN",
        tableTokenVersion: input.tableTokenVersion,
        createdAt: input.createdAt,
        updatedAt: input.createdAt,
      })
      // The partial unique index is the final race-condition guard even if a
      // future caller bypasses the table-row lock above.
      .onConflictDoNothing()
      .returning(CALL_SELECTION);
    return rows[0] ?? null;
  }

  async markTableForCall(
    restaurantId: string,
    tableId: string,
    type: "WAITER_CALL" | "BILL_REQUEST",
    at: Date,
  ): Promise<void> {
    await this.db
      .update(restaurantTables)
      .set({
        currentStatus: type === "BILL_REQUEST" ? "BILL_REQUESTED" : "WAITER_CALL",
        updatedAt: at,
      })
      .where(
        and(
          eq(restaurantTables.restaurantId, restaurantId),
          eq(restaurantTables.id, tableId),
        ),
      );
  }

  async insertOutbox(input: InsertCustomerCallOutboxInput): Promise<void> {
    await this.db.insert(outboxEvents).values({
      restaurantId: input.restaurantId,
      aggregateType: "WAITER_CALL",
      aggregateId: input.callId,
      eventType: input.eventType,
      payload: input.payload,
    });
  }

  async insertAudit(input: InsertCustomerCallAuditInput): Promise<void> {
    await this.db.insert(auditLogs).values({
      restaurantId: input.restaurantId,
      actorUserId: null,
      action: input.action,
      entityType: "WAITER_CALL",
      entityId: input.callId,
      newValue: input.newValue,
      metadata: input.metadata,
    });
  }
}

export class DrizzleWaiterCallRepository implements WaiterCallRepository {
  constructor(private readonly db: Database) {}

  transaction<TResult>(
    work: (repository: WaiterCallTransactionRepository) => Promise<TResult>,
  ): Promise<TResult> {
    return this.db.transaction((transaction) =>
      work(new DrizzleWaiterCallTransactionRepository(transaction)),
    );
  }

  /**
   * Same predicate as the transactional read, without the row lock a read
   * never needs. Restaurant and table are both in the WHERE clause: this is
   * the query a guest's own device reaches, so its scope is the boundary.
   */
  async findActiveCall(
    restaurantId: string,
    tableId: string,
    type: "WAITER_CALL" | "BILL_REQUEST",
  ): Promise<CustomerWaiterCallRecord | null> {
    const rows = await this.db
      .select(CALL_SELECTION)
      .from(waiterCalls)
      .where(
        and(
          eq(waiterCalls.restaurantId, restaurantId),
          eq(waiterCalls.tableId, tableId),
          eq(waiterCalls.type, type),
          inArray(waiterCalls.status, ["OPEN", "ACKNOWLEDGED"]),
        ),
      )
      .orderBy(desc(waiterCalls.createdAt))
      .limit(1);
    return rows[0] ?? null;
  }
}
