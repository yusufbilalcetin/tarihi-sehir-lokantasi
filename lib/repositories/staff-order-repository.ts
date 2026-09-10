import type { PaymentStatus } from "../domain/status";
import type { OrderChannel, OrderItemStatus, OrderStatus } from "../domain/status";
import type {
  InsertAuditLogInput,
  InsertOrderEventInput,
  InsertOutboxEventInput,
} from "./order-repository";

export interface StaffOrderListFilters {
  readonly status?: OrderStatus;
  readonly tableId?: string;
  /** Restaurant-local calendar date in YYYY-MM-DD format. */
  readonly date?: string;
  /** Only orders the restaurant still owes a table: not completed, not cancelled. */
  readonly openOnly?: boolean;
  /** Read each order's collections too, so its balance can be derived server-side. */
  readonly withBalance?: boolean;
  readonly limit: number;
}

/** One collection against an order, exactly as stored. */
export interface StaffOrderPaymentRecord {
  readonly amount: string;
  readonly refundedAmount: string;
  readonly status: PaymentStatus;
}

export interface StaffOrderListItemRecord {
  readonly id: string;
  readonly productName: string;
  readonly unitPrice: string;
  readonly quantity: number;
  readonly lineTotal: string;
  readonly notes: string | null;
  readonly status: OrderItemStatus;
  readonly sortOrder: number;
}

export interface StaffOrderListRecord {
  readonly version: number;
  readonly id: string;
  readonly orderNumber: string;
  readonly status: OrderStatus;
  /** Null on takeaway and courier orders; they belong to no table. */
  readonly tableId: string | null;
  readonly tableName: string | null;
  readonly tableNumber: number | null;
  readonly channel: OrderChannel;
  readonly subtotal: string;
  readonly serviceChargeTotal: string;
  readonly taxTotal: string;
  readonly total: string;
  readonly notes: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly items: readonly StaffOrderListItemRecord[];
  /**
   * Null when the caller did not ask for a balance — which is not the same as
   * an order that has taken no money. The service keeps the two apart so a
   * screen can never read "nothing collected" out of "not requested".
   */
  readonly payments: readonly StaffOrderPaymentRecord[] | null;
}

export interface MutableOrderItemRecord {
  readonly orderVersion: number;
  readonly id: string;
  readonly restaurantId: string;
  readonly orderId: string;
  readonly orderNumber: string;
  readonly orderStatus: OrderStatus;
  readonly productName: string;
  readonly status: OrderItemStatus;
}

export interface UpdateOrderItemStatusRecordInput {
  readonly restaurantId: string;
  readonly orderItemId: string;
  readonly currentStatus: OrderItemStatus;
  readonly nextStatus: OrderItemStatus;
  readonly at: Date;
}

export interface StaffOrderTransactionRepository {
  findOrderItemForUpdate(
    restaurantId: string,
    orderItemId: string,
  ): Promise<MutableOrderItemRecord | null>;
  updateOrderItemStatus(input: UpdateOrderItemStatusRecordInput): Promise<boolean>;
  /** Called under the parent lock, after changing a line, in the same transaction. */
  syncOrderStatusFromItems(restaurantId: string, orderId: string, at: Date): Promise<{ status: OrderStatus; version: number }>;
  insertOrderEvent(input: InsertOrderEventInput): Promise<void>;
  insertOutboxEvent(input: InsertOutboxEventInput): Promise<void>;
  insertAuditLog(input: InsertAuditLogInput): Promise<void>;
}

export interface StaffOrderRepository {
  listOrders(
    restaurantId: string,
    filters: StaffOrderListFilters,
  ): Promise<readonly StaffOrderListRecord[]>;
  transaction<TResult>(
    work: (repository: StaffOrderTransactionRepository) => Promise<TResult>,
  ): Promise<TResult>;
}
