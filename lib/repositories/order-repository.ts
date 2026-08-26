import type { OrderChannel, OrderEventType, OrderItemStatus, OrderStatus } from "../domain/status";

/** Mutable JSON shapes match PostgreSQL jsonb while keeping repository ports DB-agnostic. */
export type RepositoryJsonPrimitive = boolean | number | string | null;
export type RepositoryJsonValue =
  | RepositoryJsonPrimitive
  | RepositoryJsonValue[]
  | { [key: string]: RepositoryJsonValue };
export type RepositoryJsonObject = { [key: string]: RepositoryJsonValue };

export interface OrderContextRecord {
  readonly restaurantId: string;
  readonly restaurantName: string;
  readonly restaurantIsActive: boolean;
  readonly currency: string;
  readonly timezone: string;
  /** All null for takeaway and courier orders, which have no table. */
  readonly tableId: string | null;
  readonly tableName: string | null;
  readonly tableNumber: number | null;
  readonly tableIsActive: boolean | null;
  readonly tableTokenVersion: number | null;
  readonly tableTokenRevokedAt: Date | null;
  readonly orderingEnabled: boolean;
  readonly waiterApprovalRequired: boolean;
  readonly customerNotesEnabled: boolean;
  readonly serviceFeeRate: string;
  readonly taxRate: string;
  readonly maxItemQuantity: number;
  readonly orderNotesMaxLength: number;
}

export interface OrderProductRecord {
  readonly id: string;
  readonly restaurantId: string;
  readonly name: string;
  readonly price: string;
  readonly isActive: boolean;
  readonly isAvailable: boolean;
  readonly deletedAt: Date | null;
  readonly categoryIsActive: boolean;
  readonly categoryDeletedAt: Date | null;
}

export interface StoredIdempotencyRecord {
  readonly id: string;
  readonly requestHash: string;
  readonly status: "PROCESSING" | "COMPLETED" | "FAILED";
  readonly responseStatus: number | null;
  readonly responseBody: RepositoryJsonValue | null;
  readonly lockedUntil: Date | null;
  readonly expiresAt: Date;
}

export type IdempotencyClaim =
  | { readonly acquired: true; readonly id: string }
  | { readonly acquired: false; readonly record: StoredIdempotencyRecord };

export interface ClaimIdempotencyInput {
  readonly restaurantId: string;
  readonly scope: string;
  readonly keyHash: string;
  readonly requestHash: string;
  readonly now: Date;
  readonly lockedUntil: Date;
  readonly expiresAt: Date;
}

export interface RestartIdempotencyInput extends ClaimIdempotencyInput {
  readonly id: string;
}

export interface InsertFulfillmentRequestInput {
  readonly restaurantId: string;
  readonly orderId: string;
  readonly channel: "TAKEAWAY" | "DELIVERY";
  readonly customerName: string;
  readonly contact: string;
  readonly address: string | null;
  readonly deliveryNotes: string | null;
  /** The order's own key, so one submit produces one of each. */
  readonly idempotencyKey: string;
}

export interface InsertOrderRecordInput {
  readonly restaurantId: string;
  readonly channel: OrderChannel;
  /** Null unless the channel is DINE_IN; `orders_channel_table_check` enforces it. */
  readonly tableId: string | null;
  readonly orderSequence: bigint;
  readonly orderNumber: string;
  readonly status: OrderStatus;
  readonly subtotal: string;
  readonly serviceChargeTotal: string;
  readonly taxTotal: string;
  readonly total: string;
  /** Frozen with the order so later recalculation cannot re-price it. */
  readonly serviceFeeRate: string;
  readonly taxRate: string;
  readonly notes: string | null;
  readonly createdByType: "CUSTOMER" | "STAFF" | "SYSTEM";
  readonly createdByUserId: string | null;
}

export interface InsertOrderItemRecordInput {
  readonly restaurantId: string;
  readonly orderId: string;
  readonly productId: string;
  readonly productNameSnapshot: string;
  readonly unitPrice: string;
  readonly quantity: number;
  readonly lineTotal: string;
  readonly notes: string | null;
  readonly sortOrder: number;
}

export interface InsertOrderEventInput {
  readonly restaurantId: string;
  readonly orderId: string;
  readonly eventType: OrderEventType;
  readonly userId: string | null;
  readonly payload: RepositoryJsonObject;
}

export interface InsertOutboxEventInput {
  readonly restaurantId: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly eventType: string;
  readonly payload: RepositoryJsonObject;
}

export interface InsertAuditLogInput {
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

/**
 * A kitchen event that should reach the pass on paper.
 *
 * The service says *what happened*; the repository decides how it is stored,
 * exactly as with an outbox event. Enqueuing happens in the same transaction,
 * so a confirmation can never commit while its ticket goes missing — and it is
 * a row insert only, so a switched-off printer never delays an order.
 */
export interface KitchenPrintEvent {
  readonly restaurantId: string;
  readonly orderId: string;
  readonly kind: "NEW" | "ADDITION" | "CANCEL";
  /** Distinguishes one occurrence; a repeat of the same one adds no ticket. */
  readonly occurrence: string;
  /** Omitted means "every line currently on the order". */
  readonly lines?: readonly {
    readonly productId: string;
    readonly productName: string;
    readonly quantity: number;
    readonly note: string | null;
  }[];
  readonly reason?: string | null;
}

export interface MutableOrderRecord {
  readonly id: string;
  readonly restaurantId: string;
  /** Null for takeaway and courier orders, which have no table. */
  readonly tableId: string | null;
  readonly channel: OrderChannel;
  readonly orderNumber: string;
  readonly status: OrderStatus;
  readonly version: number;
}

export interface UpdateOrderStatusInput {
  readonly restaurantId: string;
  readonly orderId: string;
  readonly currentStatus: OrderStatus;
  readonly nextStatus: OrderStatus;
  readonly currentVersion: number;
  readonly at: Date;
}

export interface LockedOrderItemRecord {
  readonly id: string;
  readonly orderId: string;
  readonly productId: string;
  readonly productNameSnapshot: string;
  readonly unitPrice: string;
  readonly quantity: number;
  readonly lineTotal: string;
  readonly status: OrderItemStatus;
  readonly sortOrder: number;
}

/** An order plus every line, locked together so totals cannot drift. */
export interface MutableOrderWithItems extends MutableOrderRecord {
  readonly subtotal: string;
  readonly serviceChargeTotal: string;
  readonly taxTotal: string;
  readonly total: string;
  /** Null on pre-Phase-6 rows; the caller falls back to restaurant settings. */
  readonly serviceFeeRate: string | null;
  readonly taxRate: string | null;
  readonly currency: string;
  readonly hasSettledPayment: boolean;
  readonly hasPendingPayment: boolean;
  readonly items: readonly LockedOrderItemRecord[];
}

export interface UpdateOrderAmountsInput {
  readonly restaurantId: string;
  readonly orderId: string;
  readonly currentVersion: number;
  readonly subtotal: string;
  readonly serviceChargeTotal: string;
  readonly taxTotal: string;
  readonly total: string;
  readonly at: Date;
}

export interface CancelOrderItemInput {
  readonly restaurantId: string;
  readonly orderItemId: string;
  readonly currentStatus: OrderItemStatus;
  readonly at: Date;
}

export interface VoidOrderItemInput {
  readonly restaurantId: string;
  readonly orderItemId: string;
  readonly currentStatus: OrderItemStatus;
  readonly voidedBy: string;
  readonly reasonCode: string;
  readonly at: Date;
}

export interface OrderTransactionRepository {
  claimIdempotency(input: ClaimIdempotencyInput): Promise<IdempotencyClaim>;
  restartIdempotency(input: RestartIdempotencyInput): Promise<void>;
  completeIdempotency(input: {
    readonly id: string;
    readonly restaurantId: string;
    readonly scope: string;
    readonly responseStatus: number;
    readonly responseBody: RepositoryJsonValue;
    readonly resourceType?: string;
    readonly resourceId?: string;
    readonly completedAt: Date;
  }): Promise<void>;
  /** `tableId` is null for the guest channels; the restaurant alone is the context then. */
  findOrderContext(restaurantId: string, tableId: string | null): Promise<OrderContextRecord | null>;
  findOrderProducts(restaurantId: string, productIds: readonly string[]): Promise<readonly OrderProductRecord[]>;
  allocateOrderSequence(restaurantId: string): Promise<bigint>;
  insertOrder(input: InsertOrderRecordInput): Promise<{ readonly id: string }>;
  insertOrderItems(inputs: readonly InsertOrderItemRecordInput[]): Promise<void>;
  markTableWaiting(restaurantId: string, tableId: string): Promise<void>;
  findOrderForUpdate(restaurantId: string, orderId: string): Promise<MutableOrderRecord | null>;
  /** Locks the order row and reads its lines; the basis for every recalculation. */
  findOrderWithItemsForUpdate(
    restaurantId: string,
    orderId: string,
  ): Promise<MutableOrderWithItems | null>;
  /** Version-guarded, so a concurrent writer loses instead of overwriting. */
  updateOrderAmounts(input: UpdateOrderAmountsInput): Promise<boolean>;
  /** Soft cancellation: the line is kept for history, never deleted. */
  cancelOrderItem(input: CancelOrderItemInput): Promise<boolean>;
  /** Writes a served line off the bill, recording who did it and why. */
  voidOrderItem(input: VoidOrderItemInput): Promise<boolean>;
  updateOrderStatus(input: UpdateOrderStatusInput): Promise<boolean>;
  insertOrderEvent(input: InsertOrderEventInput): Promise<void>;
  insertOutboxEvent(input: InsertOutboxEventInput): Promise<void>;
  /**
   * The delivery half of a takeaway or courier order, written inside the same
   * transaction as the order itself. An order that exists without its
   * fulfillment row would be food nobody can deliver; a fulfillment without
   * its order would be a debt nobody can collect. Neither is allowed to
   * happen, so neither is written on its own.
   */
  insertFulfillmentRequest(input: InsertFulfillmentRequestInput): Promise<{ readonly id: string }>;
  /**
   * Queues the kitchen paperwork for this change. Returns how many tickets
   * were created and how many lines had no printer behind them, so the caller
   * can report the gap without ever failing the order over it.
   */
  enqueueKitchenPrint(event: KitchenPrintEvent): Promise<{
    readonly created: number;
    readonly unrouted: number;
  }>;
  insertAuditLog(input: InsertAuditLogInput): Promise<void>;
}

export interface OrderRepository {
  transaction<TResult>(
    work: (repository: OrderTransactionRepository) => Promise<TResult>,
  ): Promise<TResult>;
}
