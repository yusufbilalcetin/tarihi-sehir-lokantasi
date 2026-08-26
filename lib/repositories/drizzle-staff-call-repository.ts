import "server-only";

import { and, count, desc, eq, inArray, type SQL } from "drizzle-orm";

import type { Database } from "@/db";
import { auditLogs, outboxEvents, restaurantTables, waiterCalls } from "@/db/schema";
import type { WaiterCallType } from "@/lib/domain/status";
import type {
  StaffCallAuditInput,
  StaffCallInsertInput,
  StaffCallListFilters,
  StaffCallListRecord,
  StaffCallOutboxInput,
  StaffCallRepository,
  StaffCallTableRecord,
  StaffCallTransactionRepository,
  StaffCallUpdateInput,
} from "@/lib/repositories/staff-call-repository";

type TransactionDatabase = Parameters<Parameters<Database["transaction"]>[0]>[0];

const CALL_SELECTION = {
  id: waiterCalls.id,
  type: waiterCalls.type,
  status: waiterCalls.status,
  requestLabel: waiterCalls.requestLabel,
  notes: waiterCalls.notes,
  tableId: restaurantTables.id,
  tableName: restaurantTables.name,
  tableNumber: restaurantTables.tableNumber,
  acknowledgedAt: waiterCalls.acknowledgedAt,
  resolvedAt: waiterCalls.resolvedAt,
  createdAt: waiterCalls.createdAt,
  updatedAt: waiterCalls.updatedAt,
} as const;

class DrizzleStaffCallTransactionRepository implements StaffCallTransactionRepository {
  constructor(private readonly db: TransactionDatabase) {}

  async findCallForUpdate(
    restaurantId: string,
    callId: string,
  ): Promise<StaffCallListRecord | null> {
    const rows = await this.db
      .select(CALL_SELECTION)
      .from(waiterCalls)
      .innerJoin(
        restaurantTables,
        and(
          eq(restaurantTables.restaurantId, waiterCalls.restaurantId),
          eq(restaurantTables.id, waiterCalls.tableId),
        ),
      )
      .where(and(eq(waiterCalls.restaurantId, restaurantId), eq(waiterCalls.id, callId)))
      .for("update", { of: waiterCalls })
      .limit(1);
    return rows[0] ?? null;
  }

  async findTableForUpdate(
    restaurantId: string,
    tableId: string,
  ): Promise<StaffCallTableRecord | null> {
    const rows = await this.db
      .select({
        id: restaurantTables.id,
        name: restaurantTables.name,
        tableNumber: restaurantTables.tableNumber,
        isActive: restaurantTables.isActive,
        qrTokenVersion: restaurantTables.qrTokenVersion,
      })
      .from(restaurantTables)
      .where(
        and(
          eq(restaurantTables.restaurantId, restaurantId),
          eq(restaurantTables.id, tableId),
        ),
      )
      .for("update")
      .limit(1);
    return rows[0] ?? null;
  }

  async findActiveCallForTable(
    restaurantId: string,
    tableId: string,
    type: WaiterCallType,
  ): Promise<StaffCallListRecord | null> {
    const rows = await this.db
      .select(CALL_SELECTION)
      .from(waiterCalls)
      .innerJoin(
        restaurantTables,
        and(
          eq(restaurantTables.restaurantId, waiterCalls.restaurantId),
          eq(restaurantTables.id, waiterCalls.tableId),
        ),
      )
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

  async insertCall(input: StaffCallInsertInput): Promise<StaffCallListRecord | null> {
    const rows = await this.db
      .insert(waiterCalls)
      .values({
        restaurantId: input.restaurantId,
        tableId: input.tableId,
        type: input.type,
        requestLabel: input.requestLabel,
        notes: input.notes,
        status: "OPEN",
        tableTokenVersion: input.tableTokenVersion,
        createdAt: input.createdAt,
        updatedAt: input.createdAt,
      })
      // The partial unique index is the final duplicate guard even if the table
      // row lock above is ever bypassed by a future caller.
      .onConflictDoNothing()
      .returning({ id: waiterCalls.id });
    const insertedId = rows[0]?.id;
    if (!insertedId) return null;

    const created = await this.db
      .select(CALL_SELECTION)
      .from(waiterCalls)
      .innerJoin(
        restaurantTables,
        and(
          eq(restaurantTables.restaurantId, waiterCalls.restaurantId),
          eq(restaurantTables.id, waiterCalls.tableId),
        ),
      )
      .where(
        and(eq(waiterCalls.restaurantId, input.restaurantId), eq(waiterCalls.id, insertedId)),
      )
      .limit(1);
    return created[0] ?? null;
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

  async updateCallStatus(
    restaurantId: string,
    input: StaffCallUpdateInput,
  ): Promise<StaffCallListRecord | null> {
    const acknowledging = input.nextStatus === "ACKNOWLEDGED";
    await this.db
      .update(waiterCalls)
      .set({
        status: input.nextStatus,
        updatedAt: input.at,
        ...(acknowledging
          ? { acknowledgedAt: input.at, acknowledgedBy: input.actorStaffId }
          : { resolvedAt: input.at, resolvedBy: input.actorStaffId }),
      })
      .where(and(eq(waiterCalls.restaurantId, restaurantId), eq(waiterCalls.id, input.callId)));

    const rows = await this.db
      .select(CALL_SELECTION)
      .from(waiterCalls)
      .innerJoin(
        restaurantTables,
        and(
          eq(restaurantTables.restaurantId, waiterCalls.restaurantId),
          eq(restaurantTables.id, waiterCalls.tableId),
        ),
      )
      .where(and(eq(waiterCalls.restaurantId, restaurantId), eq(waiterCalls.id, input.callId)))
      .limit(1);
    return rows[0] ?? null;
  }

  async countActiveCallsForTable(restaurantId: string, tableId: string): Promise<number> {
    const rows = await this.db
      .select({ total: count() })
      .from(waiterCalls)
      .where(
        and(
          eq(waiterCalls.restaurantId, restaurantId),
          eq(waiterCalls.tableId, tableId),
          inArray(waiterCalls.status, ["OPEN", "ACKNOWLEDGED"]),
        ),
      );
    return rows[0]?.total ?? 0;
  }

  async clearTableCallStatus(restaurantId: string, tableId: string, at: Date): Promise<void> {
    await this.db
      .update(restaurantTables)
      .set({ currentStatus: "OCCUPIED", updatedAt: at })
      .where(
        and(
          eq(restaurantTables.restaurantId, restaurantId),
          eq(restaurantTables.id, tableId),
          inArray(restaurantTables.currentStatus, ["WAITER_CALL", "BILL_REQUESTED"]),
        ),
      );
  }

  async insertOutbox(input: StaffCallOutboxInput): Promise<void> {
    await this.db.insert(outboxEvents).values({
      restaurantId: input.restaurantId,
      aggregateType: "WAITER_CALL",
      aggregateId: input.callId,
      eventType: input.eventType,
      payload: input.payload,
    });
  }

  async insertAudit(input: StaffCallAuditInput): Promise<void> {
    await this.db.insert(auditLogs).values({
      restaurantId: input.restaurantId,
      actorUserId: input.actorStaffId,
      action: input.action,
      entityType: "WAITER_CALL",
      entityId: input.callId,
      oldValue: input.oldValue,
      newValue: input.newValue,
      requestId: input.requestId,
    });
  }
}

export class DrizzleStaffCallRepository implements StaffCallRepository {
  constructor(private readonly db: Database) {}

  listCalls(restaurantId: string, filters: StaffCallListFilters) {
    const predicates: SQL[] = [
      eq(waiterCalls.restaurantId, restaurantId),
      eq(restaurantTables.restaurantId, restaurantId),
    ];
    if (filters.type) predicates.push(eq(waiterCalls.type, filters.type));
    if (filters.status) predicates.push(eq(waiterCalls.status, filters.status));

    return this.db
      .select(CALL_SELECTION)
      .from(waiterCalls)
      .innerJoin(
        restaurantTables,
        and(
          eq(restaurantTables.restaurantId, waiterCalls.restaurantId),
          eq(restaurantTables.id, waiterCalls.tableId),
        ),
      )
      .where(and(...predicates))
      .orderBy(desc(waiterCalls.createdAt))
      .limit(filters.limit);
  }

  transaction<TResult>(
    work: (repository: StaffCallTransactionRepository) => Promise<TResult>,
  ): Promise<TResult> {
    return this.db.transaction((transaction) =>
      work(new DrizzleStaffCallTransactionRepository(transaction)),
    );
  }
}
