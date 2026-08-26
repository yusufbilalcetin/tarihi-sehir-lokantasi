import type { RestaurantPrincipal } from "../../lib/domain/restaurant-scope";
import type {
  InsertAuditLogInput,
  InsertOrderEventInput,
  InsertOutboxEventInput,
} from "../../lib/repositories/order-repository";
import type {
  CompleteOrderInput,
  InsertPaymentInput,
  InsertRefundInput,
  PayableOrderRecord,
  PaymentRecord,
  PaymentRepository,
  PaymentTransactionRepository,
  RefundRecord,
} from "../../lib/repositories/payment-repository";
import { PaymentService } from "../../lib/services/payment-service";

export const PAYMENT_AT = new Date("2026-08-14T20:00:00.000Z");

export function servedOrder(
  overrides: Partial<PayableOrderRecord> = {},
): PayableOrderRecord {
  return {
    id: "order-a",
    restaurantId: "restaurant-a",
    orderNumber: "1042",
    status: "SERVED",
    total: "905.00",
    version: 3,
    channel: "DINE_IN" as const,
    tableId: "table-a",
    tableName: "Masa 8",
    tableNumber: 8,
    ...overrides,
  };
}

export function principal(role: RestaurantPrincipal["role"]): RestaurantPrincipal {
  return {
    userId: `user-${role.toLowerCase()}`,
    restaurantId: "restaurant-a",
    role,
    isActive: true,
  };
}

/**
 * Models the ledger the Drizzle repository exposes: payments and refunds are
 * real rows, the denormalized `refundedAmount` moves with the refund rows, and
 * the unique idempotency indexes are enforced by lookup before insert.
 */
export class FakePaymentTransaction implements PaymentTransactionRepository {
  order: PayableOrderRecord | null = servedOrder();
  payments: PaymentRecord[] = [];
  refunds: RefundRecord[] = [];
  insertedPayments: InsertPaymentInput[] = [];
  insertedRefunds: InsertRefundInput[] = [];
  completed: CompleteOrderInput[] = [];
  orderEvents: InsertOrderEventInput[] = [];
  outbox: InsertOutboxEventInput[] = [];
  audits: InsertAuditLogInput[] = [];
  freedTables: string[] = [];
  occupiedTables: string[] = [];
  /** Split checks on the order, when the bill has been divided. */
  checks: {
    id: string;
    orderId: string;
    label: string;
    status: "OPEN" | "PAID" | "CANCELLED";
    total: string;
  }[] = [];
  paidChecks: string[] = [];
  /** Simulates the idempotency unique index rejecting a racing insert. */
  insertConflicts = false;
  /**
   * Phase 8A: every collection and refund is attributed to the actor's own
   * open cash drawer period. Set to null to model a cashier with no open
   * shift, which the service must refuse.
   */
  activeShift: { id: string; cashRegisterId: string } | null = {
    id: "shift-1",
    cashRegisterId: "register-1",
  };
  /** The tenant this fake belongs to, independent of whether an order exists. */
  restaurantId = "restaurant-a";
  private sequence = 0;

  async findActiveShiftForUpdate(restaurantId: string, staffId: string) {
    if (restaurantId !== this.restaurantId || !this.activeShift) return null;
    // The real predicate is (restaurant, staff, status = OPEN), so the row that
    // comes back always belongs to the asking actor.
    return { ...this.activeShift, openedByStaffId: staffId };
  }

  async findPayableOrderForUpdate(restaurantId: string, orderId: string) {
    if (!this.order) return null;
    return this.order.restaurantId === restaurantId && this.order.id === orderId
      ? this.order
      : null;
  }

  /** Every lookup is tenant scoped, exactly as the repository predicates are. */
  private inTenant(restaurantId: string): boolean {
    return this.order?.restaurantId === restaurantId;
  }

  async listPaymentsForOrder(restaurantId: string, orderId: string) {
    if (!this.inTenant(restaurantId)) return [];
    return this.payments.filter((payment) => payment.orderId === orderId);
  }

  async findPaymentByIdempotencyKey(restaurantId: string, keyHash: string) {
    if (!this.inTenant(restaurantId)) return null;
    return this.payments.find((payment) => payment.idempotencyKeyHash === keyHash) ?? null;
  }

  async findPaymentForUpdate(restaurantId: string, paymentId: string) {
    if (!this.inTenant(restaurantId)) return null;
    return this.payments.find((payment) => payment.id === paymentId) ?? null;
  }

  async findRefundByIdempotencyKey(restaurantId: string, keyHash: string) {
    if (!this.inTenant(restaurantId)) return null;
    const match = this.insertedRefunds.findIndex(
      (refund) => refund.idempotencyKeyHash === keyHash,
    );
    return match >= 0 ? this.refunds[match] ?? null : null;
  }

  async insertPayment(input: InsertPaymentInput) {
    this.insertedPayments.push(input);
    if (this.insertConflicts) return null;
    this.sequence += 1;
    const payment: PaymentRecord = {
      id: `payment-${this.sequence}`,
      orderId: input.orderId,
      checkId: input.checkId,
      amount: input.amount,
      refundedAmount: "0.00",
      method: input.method,
      status: "COMPLETED",
      idempotencyKeyHash: input.idempotencyKeyHash,
      processedAt: input.at,
      createdAt: input.at,
    };
    this.payments.push(payment);
    return payment;
  }

  async insertRefund(input: InsertRefundInput) {
    this.insertedRefunds.push(input);
    if (this.insertConflicts) return null;
    const refund: RefundRecord = {
      id: `refund-${this.insertedRefunds.length}`,
      paymentId: input.paymentId,
      orderId: input.orderId,
      amount: input.amount,
      reasonCode: input.reasonCode,
      note: input.note,
      createdAt: input.at,
    };
    this.refunds.push(refund);
    return refund;
  }

  async addPaymentRefundedAmount(input: {
    restaurantId: string;
    paymentId: string;
    amount: string;
  }) {
    const index = this.payments.findIndex((payment) => payment.id === input.paymentId);
    if (index < 0) return false;
    const current = this.payments[index]!;
    this.payments[index] = {
      ...current,
      refundedAmount: (Number(current.refundedAmount) + Number(input.amount)).toFixed(2),
    };
    return true;
  }

  async findCheckForUpdate(restaurantId: string, checkId: string) {
    if (!this.inTenant(restaurantId)) return null;
    const check = this.checks.find((candidate) => candidate.id === checkId);
    if (!check) return null;
    // Derived from the ledger, exactly as the repository aggregates it.
    const settled = this.payments.filter((payment) => payment.checkId === checkId);
    return {
      ...check,
      paidTotal: settled.reduce((sum, payment) => sum + Number(payment.amount), 0).toFixed(2),
      refundedTotal: settled
        .reduce((sum, payment) => sum + Number(payment.refundedAmount), 0)
        .toFixed(2),
    };
  }

  async markCheckPaid(_restaurantId: string, checkId: string) {
    const index = this.checks.findIndex((check) => check.id === checkId);
    if (index < 0 || this.checks[index]!.status !== "OPEN") return false;
    this.checks[index] = { ...this.checks[index]!, status: "PAID" };
    this.paidChecks.push(checkId);
    return true;
  }

  async completeOrder(input: CompleteOrderInput) {
    this.completed.push(input);
    if (this.order) this.order = { ...this.order, status: "COMPLETED", version: input.currentVersion + 1 };
    return true;
  }

  /** Flip this to model a table whose second bill is still running. */
  otherOpenOrders = false;

  async hasOtherOpenOrders() {
    return this.otherOpenOrders;
  }

  async markTableAvailable(_restaurantId: string, tableId: string) {
    this.freedTables.push(tableId);
  }

  async markTableOccupied(_restaurantId: string, tableId: string) {
    this.occupiedTables.push(tableId);
  }

  async insertOrderEvent(input: InsertOrderEventInput) {
    this.orderEvents.push(input);
  }

  async insertOutboxEvent(input: InsertOutboxEventInput) {
    this.outbox.push(input);
  }

  async insertAuditLog(input: InsertAuditLogInput) {
    this.audits.push(input);
  }
}

export class FakePaymentRepository implements PaymentRepository {
  transactionRepository = new FakePaymentTransaction();

  transaction<TResult>(
    work: (repository: PaymentTransactionRepository) => Promise<TResult>,
  ): Promise<TResult> {
    return work(this.transactionRepository);
  }
}

export function paymentService(repository: FakePaymentRepository): PaymentService {
  return new PaymentService(repository, { clock: () => PAYMENT_AT });
}
