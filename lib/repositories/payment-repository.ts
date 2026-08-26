import type { OrderChannel, OrderStatus, PaymentMethod, PaymentStatus } from "@/lib/domain/status";
import type {
  InsertAuditLogInput,
  InsertOrderEventInput,
  InsertOutboxEventInput,
} from "./order-repository";

export interface PayableOrderRecord {
  readonly id: string;
  readonly restaurantId: string;
  readonly orderNumber: string;
  readonly status: OrderStatus;
  readonly total: string;
  readonly version: number;
  readonly channel: OrderChannel;
  /** Null on takeaway and courier orders; the till bills the order, not a table. */
  readonly tableId: string | null;
  readonly tableName: string | null;
  readonly tableNumber: number | null;
}

export interface PaymentRecord {
  readonly id: string;
  readonly orderId: string;
  readonly checkId: string | null;
  readonly amount: string;
  readonly refundedAmount: string;
  readonly method: PaymentMethod;
  readonly status: PaymentStatus;
  readonly idempotencyKeyHash: string | null;
  readonly processedAt: Date | null;
  readonly createdAt: Date;
}

export interface InsertPaymentInput {
  readonly restaurantId: string;
  readonly orderId: string;
  readonly checkId: string | null;
  /** Server-derived; never the requested figure when it exceeds the balance. */
  readonly amount: string;
  readonly method: PaymentMethod;
  readonly createdByUserId: string;
  /** Resolved from the actor's own open shift; never accepted from a client. */
  readonly cashierShiftId: string;
  readonly idempotencyKeyHash: string;
  readonly at: Date;
}

/** The actor's open cash drawer period, locked for the length of the write. */
export interface ActiveCashierShiftRecord {
  readonly id: string;
  readonly cashRegisterId: string;
  readonly openedByStaffId: string;
}

export interface InsertRefundInput {
  readonly restaurantId: string;
  readonly paymentId: string;
  readonly orderId: string;
  /** The shift giving the money back, not the one that collected it. */
  readonly cashierShiftId: string;
  readonly amount: string;
  readonly reasonCode: string;
  readonly note: string | null;
  readonly createdByUserId: string;
  readonly idempotencyKeyHash: string;
  readonly at: Date;
}

export interface RefundRecord {
  readonly id: string;
  readonly paymentId: string;
  readonly orderId: string;
  readonly amount: string;
  readonly reasonCode: string;
  readonly note: string | null;
  readonly createdAt: Date;
}

export interface CheckBalanceRecord {
  readonly id: string;
  readonly orderId: string;
  readonly label: string;
  readonly status: "OPEN" | "PAID" | "CANCELLED";
  readonly total: string;
  readonly paidTotal: string;
  readonly refundedTotal: string;
}

export interface CompleteOrderInput {
  readonly restaurantId: string;
  readonly orderId: string;
  readonly currentVersion: number;
  readonly at: Date;
}

export interface PaymentTransactionRepository {
  /**
   * The actor's own OPEN shift, locked. This is taken *before* the order and
   * payment locks in every money path, which is both the deadlock-free lock
   * order and the reason a shift close can never race a collection: whichever
   * takes this row first, the other waits and then sees the committed truth.
   */
  findActiveShiftForUpdate(
    restaurantId: string,
    staffId: string,
  ): Promise<ActiveCashierShiftRecord | null>;
  /** Locks the order row so two cashiers cannot over-collect the same bill. */
  findPayableOrderForUpdate(
    restaurantId: string,
    orderId: string,
  ): Promise<PayableOrderRecord | null>;
  /** Every payment on the order, locked with it, for the balance calculation. */
  listPaymentsForOrder(
    restaurantId: string,
    orderId: string,
  ): Promise<readonly PaymentRecord[]>;
  findPaymentByIdempotencyKey(
    restaurantId: string,
    keyHash: string,
  ): Promise<PaymentRecord | null>;
  /** Locks one payment so two refunds cannot both consume the same remainder. */
  findPaymentForUpdate(
    restaurantId: string,
    paymentId: string,
  ): Promise<PaymentRecord | null>;
  findRefundByIdempotencyKey(
    restaurantId: string,
    keyHash: string,
  ): Promise<RefundRecord | null>;
  insertPayment(input: InsertPaymentInput): Promise<PaymentRecord | null>;
  insertRefund(input: InsertRefundInput): Promise<RefundRecord | null>;
  /** Keeps the denormalized cache on `payments` in step with the refund rows. */
  addPaymentRefundedAmount(input: {
    readonly restaurantId: string;
    readonly paymentId: string;
    readonly amount: string;
    readonly at: Date;
  }): Promise<boolean>;
  /** Locks one split check so two cashiers cannot over-collect against it. */
  findCheckForUpdate(
    restaurantId: string,
    checkId: string,
  ): Promise<CheckBalanceRecord | null>;
  markCheckPaid(restaurantId: string, checkId: string, at: Date): Promise<boolean>;
  completeOrder(input: CompleteOrderInput): Promise<boolean>;
  /**
   * Whether the table still owes something on another bill. A table can carry
   * more than one open order — a round of drinks and then the food — so paying
   * one of them is not the same as the table leaving.
   */
  hasOtherOpenOrders(
    restaurantId: string,
    tableId: string,
    excludeOrderId: string,
  ): Promise<boolean>;
  markTableAvailable(restaurantId: string, tableId: string, at: Date): Promise<void>;
  markTableOccupied(restaurantId: string, tableId: string, at: Date): Promise<void>;
  insertOrderEvent(input: InsertOrderEventInput): Promise<void>;
  insertOutboxEvent(input: InsertOutboxEventInput): Promise<void>;
  insertAuditLog(input: InsertAuditLogInput): Promise<void>;
}

export interface PaymentRepository {
  transaction<TResult>(
    work: (repository: PaymentTransactionRepository) => Promise<TResult>,
  ): Promise<TResult>;
}
