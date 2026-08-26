import type { OrderChannel, OrderItemStatus, OrderStatus } from "../domain/status";
import type { RepositoryJsonObject } from "./order-repository";

export type OrderCheckStatus = "OPEN" | "PAID" | "CANCELLED";

export interface CheckOrderRecord {
  readonly id: string;
  readonly restaurantId: string;
  readonly orderNumber: string;
  readonly status: OrderStatus;
  readonly total: string;
  /** Null for takeaway and courier orders, which have no table. */
  readonly tableId: string | null;
  readonly channel: OrderChannel;
}

export interface CheckItemRecord {
  readonly id: string;
  readonly productNameSnapshot: string;
  readonly unitPrice: string;
  readonly quantity: number;
  readonly status: OrderItemStatus;
  /** Sum already handed to checks, across every open check on the order. */
  readonly allocatedQuantity: number;
}

export interface OrderCheckAllocationRecord {
  readonly id: string;
  readonly orderItemId: string;
  readonly productNameSnapshot: string;
  readonly quantity: number;
  readonly unitPriceSnapshot: string;
  readonly lineTotal: string;
}

export interface OrderCheckRecord {
  readonly id: string;
  readonly orderId: string;
  readonly label: string;
  readonly status: OrderCheckStatus;
  readonly total: string;
  readonly createdAt: Date;
  readonly closedAt: Date | null;
  readonly items: readonly OrderCheckAllocationRecord[];
  /** Completed collections attributed to this check. */
  readonly paidTotal: string;
  readonly refundedTotal: string;
}

export interface InsertCheckInput {
  readonly restaurantId: string;
  readonly orderId: string;
  readonly label: string;
  readonly total: string;
  readonly createdByUserId: string;
  readonly at: Date;
}

export interface InsertCheckAllocationInput {
  readonly restaurantId: string;
  readonly checkId: string;
  readonly orderItemId: string;
  readonly quantity: number;
  readonly unitPriceSnapshot: string;
  readonly lineTotal: string;
  readonly at: Date;
}

export interface OrderCheckTransactionRepository {
  /** Locks the order so two cashiers cannot split the same bill twice. */
  findOrderForUpdate(
    restaurantId: string,
    orderId: string,
  ): Promise<CheckOrderRecord | null>;
  /** Billable lines with how much of each is already on a check. */
  listBillableItems(
    restaurantId: string,
    orderId: string,
  ): Promise<readonly CheckItemRecord[]>;
  listChecks(restaurantId: string, orderId: string): Promise<readonly OrderCheckRecord[]>;
  findCheckForUpdate(
    restaurantId: string,
    checkId: string,
  ): Promise<OrderCheckRecord | null>;
  insertCheck(input: InsertCheckInput): Promise<{ readonly id: string }>;
  insertCheckAllocation(input: InsertCheckAllocationInput): Promise<void>;
  updateCheckDetails(
    restaurantId: string,
    checkId: string,
    details: { readonly label: string; readonly total: string; readonly at: Date },
  ): Promise<void>;
  cancelCheck(restaurantId: string, checkId: string, at: Date): Promise<boolean>;
  deleteCheckAllocations(restaurantId: string, checkId: string): Promise<void>;
  insertOutbox(input: {
    readonly restaurantId: string;
    readonly aggregateType: string;
    readonly aggregateId: string;
    readonly eventType: string;
    readonly payload: RepositoryJsonObject;
  }): Promise<void>;
  insertAudit(input: {
    readonly restaurantId: string;
    readonly actorUserId: string;
    readonly action: string;
    readonly entityType: string;
    readonly entityId: string;
    readonly oldValue: RepositoryJsonObject | null;
    readonly newValue: RepositoryJsonObject | null;
    readonly metadata?: RepositoryJsonObject;
    readonly requestId?: string;
  }): Promise<void>;
}

export interface OrderCheckRepository {
  transaction<TResult>(
    work: (repository: OrderCheckTransactionRepository) => Promise<TResult>,
  ): Promise<TResult>;
}
