import type { RepositoryJsonObject } from "./order-repository";
import type {
  OrderStatus,
  TableStatus,
  WaiterCallStatus,
  WaiterCallType,
} from "../domain/status";

export interface TableOperationTableRecord {
  readonly id: string;
  readonly name: string;
  readonly tableNumber: number;
  readonly isActive: boolean;
  readonly currentStatus: TableStatus;
}

export interface TableOperationOrderRecord {
  readonly id: string;
  readonly orderNumber: string;
  readonly status: OrderStatus;
  readonly total: string;
}

export interface TableOrderBalanceRecord {
  readonly id: string;
  readonly orderNumber: string;
  readonly status: OrderStatus;
  readonly total: string;
  readonly paidTotal: string;
  readonly refundedTotal: string;
}

export interface TableCheckBalanceRecord {
  readonly id: string;
  readonly orderId: string;
  readonly label: string;
  readonly status: "OPEN" | "PAID" | "CANCELLED";
  readonly total: string;
  readonly paidTotal: string;
}

export interface TableOperationCallRecord {
  readonly id: string;
  readonly type: WaiterCallType;
  readonly status: WaiterCallStatus;
}

export interface TableOperationAuditInput {
  readonly restaurantId: string;
  readonly actorUserId: string;
  readonly action: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly oldValue: RepositoryJsonObject | null;
  readonly newValue: RepositoryJsonObject | null;
  readonly metadata?: RepositoryJsonObject;
  readonly requestId?: string;
}

export interface TableOperationOutboxInput {
  readonly restaurantId: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly eventType: string;
  readonly payload: RepositoryJsonObject;
}

export interface TableOperationsTransactionRepository {
  /**
   * Locks every requested table in one statement ordered by id, so two devices
   * moving the same pair in opposite directions cannot deadlock.
   */
  findTablesForUpdate(
    restaurantId: string,
    tableIds: readonly string[],
  ): Promise<readonly TableOperationTableRecord[]>;
  listOpenOrders(
    restaurantId: string,
    tableId: string,
  ): Promise<readonly TableOperationOrderRecord[]>;
  /**
   * Money position of every order on the table that is not historically
   * closed. A COMPLETED order is excluded on purpose: a later refund re-opens
   * its ledger balance and must not strand the table.
   */
  listUnclosedOrderBalances(
    restaurantId: string,
    tableId: string,
  ): Promise<readonly TableOrderBalanceRecord[]>;
  /** Split checks belonging to the table's unclosed orders. */
  listOpenChecks(
    restaurantId: string,
    tableId: string,
  ): Promise<readonly TableCheckBalanceRecord[]>;
  countPendingPayments(restaurantId: string, tableId: string): Promise<number>;
  listActiveCalls(
    restaurantId: string,
    tableId: string,
  ): Promise<readonly TableOperationCallRecord[]>;
  /** Returns how many rows actually moved; a mismatch aborts the operation. */
  moveOrders(
    restaurantId: string,
    orderIds: readonly string[],
    targetTableId: string,
    at: Date,
  ): Promise<number>;
  moveCall(
    restaurantId: string,
    callId: string,
    targetTableId: string,
    at: Date,
  ): Promise<boolean>;
  resolveCall(
    restaurantId: string,
    callId: string,
    actorStaffId: string,
    at: Date,
  ): Promise<boolean>;
  setTableStatus(
    restaurantId: string,
    tableId: string,
    status: TableStatus,
    at: Date,
  ): Promise<void>;
  insertOutbox(input: TableOperationOutboxInput): Promise<void>;
  insertAudit(input: TableOperationAuditInput): Promise<void>;
}

export interface TableOperationsRepository {
  transaction<TResult>(
    work: (repository: TableOperationsTransactionRepository) => Promise<TResult>,
  ): Promise<TResult>;
}
