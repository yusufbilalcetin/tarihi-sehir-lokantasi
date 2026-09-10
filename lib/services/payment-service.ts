import { createHash } from "node:crypto";

import { DomainError, internalError } from "@/lib/api/domain-error";
import {
  PAYMENT_ROLES,
  REFUND_ROLES,
  calculateOrderBalance,
  checkPaymentAmount,
  checkRefundAmount,
  refundableAmount,
  type OrderBalance,
} from "@/lib/domain/financial-operations";
import { createIdempotencyFingerprint } from "@/lib/domain/idempotency";
import { addMoney, decimalToMinor, minorToDecimal } from "@/lib/domain/money";
import {
  authorizeRestaurantAccess,
  type RestaurantPrincipal,
} from "@/lib/domain/restaurant-scope";
import { canRoleTransitionOrderStatus, type PaymentMethod, type UserRole } from "@/lib/domain/status";
import type {
  PaymentRepository,
  PaymentTransactionRepository,
} from "@/lib/repositories/payment-repository";



export interface CreatePaymentCommand {
  readonly orderId: string;
  readonly method: PaymentMethod;
  /** Omitted means "settle the remaining balance", never a client-named total. */
  readonly amount?: string;
  readonly checkId?: string;
  readonly idempotencyKey: string;
  readonly requestId?: string;
}

export interface CreatePaymentResult {
  readonly paymentId: string;
  readonly orderId: string;
  readonly orderNumber: string;
  readonly amount: string;
  readonly method: PaymentMethod;
  readonly status: "COMPLETED";
  readonly processedAt: string;
  /** The order's money position after this collection. */
  readonly balance: OrderBalance;
  readonly replayed: boolean;
}

export interface RefundCommand {
  readonly paymentId: string;
  readonly amount: string;
  readonly reasonCode: string;
  readonly note?: string;
  readonly idempotencyKey: string;
  readonly requestId?: string;
}

export interface RefundResult {
  readonly refundId: string;
  readonly paymentId: string;
  readonly orderId: string;
  readonly amount: string;
  readonly reasonCode: string;
  /** Everything returned on this payment so far, including this refund. */
  readonly refundedTotal: string;
  readonly refundableRemaining: string;
  readonly createdAt: string;
  readonly replayed: boolean;
}

export interface OrderLedgerResult {
  readonly orderId: string;
  readonly orderNumber: string;
  readonly orderStatus: string;
  readonly balance: OrderBalance;
  readonly payments: readonly {
    readonly id: string;
    readonly checkId: string | null;
    readonly amount: string;
    readonly refundedAmount: string;
    readonly method: PaymentMethod;
    readonly status: string;
    readonly processedAt: string;
  }[];
}

export interface PaymentServiceOptions {
  readonly clock?: () => Date;
}

function hashKey(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function hashIntent(value: unknown): string {
  return hashKey(createIdempotencyFingerprint(value));
}

function paymentIntent(command: CreatePaymentCommand): string {
  return hashIntent({
    orderId: command.orderId,
    method: command.method,
    amount: command.amount ?? null,
    checkId: command.checkId ?? null,
  });
}

function refundIntent(command: RefundCommand): string {
  return hashIntent({
    paymentId: command.paymentId,
    amount: command.amount,
    reasonCode: command.reasonCode,
    note: command.note ?? null,
  });
}

function assertSameIdempotencyIntent(
  storedRequestHash: string | null,
  requestHash: string,
): void {
  // Legacy rows did not record enough information to prove that two payloads
  // are equal. Fail closed instead of replaying a possibly different money
  // instruction as a successful receipt.
  if (!storedRequestHash || storedRequestHash !== requestHash) {
    throw new DomainError(
      "IDEMPOTENCY_CONFLICT",
      "Bu istek anahtarı farklı işlem bilgileriyle kullanıldı.",
      { httpStatus: 409 },
    );
  }
}

/** A refund whose payment or order vanished mid-transaction is a bug, not input. */
function internalRefundError(): DomainError {
  return internalError();
}

/**
 * Every collection and refund is attributed to the acting staff member's own
 * OPEN cash drawer period, resolved here from the authenticated principal. The
 * client never names a shift, so a request cannot attribute money to somebody
 * else's drawer, to another tenant's shift, or to a shift that is closed.
 *
 * Taking this lock first is also the deadlock-free lock order for the money
 * paths, and it is what serialises a collection against a shift close.
 */
async function requireActiveShift(
  transaction: PaymentTransactionRepository,
  actor: RestaurantPrincipal,
  onMissing?: () => Promise<void>,
): Promise<string> {
  const shift = await transaction.findActiveShiftForUpdate(
    actor.restaurantId,
    actor.userId,
  );
  if (!shift) {
    await onMissing?.();
    throw new DomainError(
      "CASHIER_SHIFT_REQUIRED",
      "Bu işlem için açık bir kasa vardiyanız olmalıdır.",
      { httpStatus: 409 },
    );
  }
  return shift.id;
}

function minorSum(left: string, right: string): string {
  return minorToDecimal(addMoney(decimalToMinor(left), decimalToMinor(right)));
}

export class PaymentService {
  private readonly clock: () => Date;

  constructor(
    private readonly repository: PaymentRepository,
    options: PaymentServiceOptions = {},
  ) {
    this.clock = options.clock ?? (() => new Date());
  }

  /**
   * Collection is one atomic step: lock the order, verify it is servable and
   * unpaid, take the total from the database, write the payment, close the
   * order, and emit the event/audit trail. Any failure rolls all of it back.
   */
  async collect(
    principal: RestaurantPrincipal | null | undefined,
    command: CreatePaymentCommand,
  ): Promise<CreatePaymentResult> {
    const decision = authorizeRestaurantAccess(principal, principal?.restaurantId ?? "", {
      allowedRoles: PAYMENT_ROLES,
    });
    if (!decision.allowed) {
      const authenticationFailure = decision.reason === "AUTHENTICATION_REQUIRED";
      throw new DomainError(
        authenticationFailure ? "AUTHENTICATION_REQUIRED" : "FORBIDDEN",
        authenticationFailure ? "Oturum açmanız gerekiyor." : "Tahsilat yetkiniz yok.",
        { httpStatus: authenticationFailure ? 401 : 403 },
      );
    }
    const actor = decision.principal;
    const keyHash = hashKey(command.idempotencyKey);
    const requestHash = paymentIntent(command);

    return this.repository.transaction(async (transaction) => {
      // A completed retry must remain replayable after its original shift has
      // closed. This lookup takes no business-row lock; a fresh write still
      // acquires the shift lock first below.
      const completedReplay = await transaction.findPaymentByIdempotencyKey(
        actor.restaurantId,
        keyHash,
      );
      if (completedReplay) {
        assertSameIdempotencyIntent(completedReplay.idempotencyRequestHash, requestHash);
        const replayOrder = await transaction.findPayableOrderForUpdate(
          actor.restaurantId,
          command.orderId,
        );
        if (!replayOrder) {
          throw new DomainError("ORDER_NOT_FOUND", "Sipariş bulunamadı.", { httpStatus: 404 });
        }
        const ledger = await this.balanceOf(transaction, actor.restaurantId, replayOrder);
        return this.paymentResult(replayOrder, completedReplay, ledger, true);
      }

      // Shift close takes this same row first. Keeping one global lock order
      // means a close either includes this payment or commits before it and
      // makes the write fail cleanly; the two transactions cannot deadlock.
      const cashierShiftId = await requireActiveShift(transaction, actor, async () => {
        // No shift was locked and this path cannot write. Preserve scoped 404s.
        if (!await transaction.findPayableOrderForUpdate(actor.restaurantId, command.orderId)) {
          throw new DomainError("ORDER_NOT_FOUND", "Sipariş bulunamadı.", { httpStatus: 404 });
        }
      });
      const order = await transaction.findPayableOrderForUpdate(actor.restaurantId, command.orderId);
      if (!order) {
        throw new DomainError("ORDER_NOT_FOUND", "Sipariş bulunamadı.", { httpStatus: 404 });
      }

      // A retried request replays its own receipt rather than collecting twice.
      const replay = await transaction.findPaymentByIdempotencyKey(actor.restaurantId, keyHash);
      if (replay) {
        assertSameIdempotencyIntent(replay.idempotencyRequestHash, requestHash);
        const ledger = await this.balanceOf(transaction, actor.restaurantId, order);
        return this.paymentResult(order, replay, ledger, true);
      }

      if (order.status === "COMPLETED") {
        throw new DomainError("ORDER_ALREADY_SETTLED", "Bu siparişin hesabı kapanmış.", {
          httpStatus: 409,
        });
      }
      if (!canRoleTransitionOrderStatus(actor.role, order.status, "COMPLETED")) {
        throw new DomainError(
          "INVALID_STATUS_TRANSITION",
          "Sipariş bu aşamada tahsil edilemez.",
          { httpStatus: 409, details: { status: order.status } },
        );
      }

      const before = await this.balanceOf(transaction, actor.restaurantId, order);

      // A split collection must respect both the check and order remainders:
      // unallocated payments can reduce the order without reducing this check.
      let checkCeiling: string | null = null;
      if (command.checkId) {
        const check = await transaction.findCheckForUpdate(
          actor.restaurantId,
          command.checkId,
        );
        if (!check || check.orderId !== order.id) {
          throw new DomainError("CHECK_NOT_FOUND", "Hesap bulunamadı.", { httpStatus: 404 });
        }
        if (check.status === "CANCELLED") {
          throw new DomainError("CHECK_NOT_FOUND", "İptal edilmiş hesaba tahsilat yapılamaz.", {
            httpStatus: 409,
          });
        }
        if (check.status === "PAID") {
          throw new DomainError("CHECK_ALREADY_PAID", "Bu hesap zaten ödenmiş.", {
            httpStatus: 409,
          });
        }
        checkCeiling = minorToDecimal(
          Math.max(
            0,
            decimalToMinor(check.total) -
              (decimalToMinor(check.paidTotal) - decimalToMinor(check.refundedTotal)),
          ),
        );
      }

      // No amount means "settle the rest", which keeps the single-payment flow
      // identical to Phase 4 without the client ever naming a figure.
      const ceiling = checkCeiling === null ? before.outstanding : minorToDecimal(
        Math.min(decimalToMinor(checkCeiling), decimalToMinor(before.outstanding)),
      );
      const requested = command.amount ?? ceiling;
      const failure = checkPaymentAmount(requested, ceiling);
      if (failure === "NOT_POSITIVE") {
        throw new DomainError("VALIDATION_ERROR", "Tahsilat tutarı sıfırdan büyük olmalıdır.", {
          httpStatus: 400,
        });
      }
      if (failure === "EXCEEDS_BALANCE") {
        throw new DomainError(
          "PAYMENT_EXCEEDS_BALANCE",
          checkCeiling
            ? "Tahsilat tutarı bu hesabın kalanından büyük olamaz."
            : "Tahsilat tutarı kalan bakiyeden büyük olamaz.",
          { httpStatus: 409, details: { outstanding: ceiling } },
        );
      }

      const at = this.clock();
      const payment = await transaction.insertPayment({
        restaurantId: actor.restaurantId,
        orderId: order.id,
        checkId: command.checkId ?? null,
        // Server-derived: either the remaining balance or a validated share.
        amount: requested,
        method: command.method,
        createdByUserId: actor.userId,
        cashierShiftId,
        idempotencyKeyHash: keyHash,
        idempotencyRequestHash: requestHash,
        at,
      });
      if (!payment) {
        // The idempotency index rejected it; the winner's row is the truth.
        const raced = await transaction.findPaymentByIdempotencyKey(actor.restaurantId, keyHash);
        if (raced) {
          assertSameIdempotencyIntent(raced.idempotencyRequestHash, requestHash);
          const ledger = await this.balanceOf(transaction, actor.restaurantId, order);
          return this.paymentResult(order, raced, ledger, true);
        }
        throw new DomainError("CONFLICT", "Tahsilat kaydedilemedi.", { httpStatus: 409 });
      }

      // A check closes on its own remainder; the order closes on the whole
      // balance, so one paid check never completes an order with others open.
      let checkClosed = false;
      if (command.checkId && checkCeiling !== null) {
        const remaining = decimalToMinor(checkCeiling) - decimalToMinor(requested);
        if (remaining <= 0) {
          checkClosed = await transaction.markCheckPaid(
            actor.restaurantId,
            command.checkId,
            at,
          );
        }
      }

      const after = await this.balanceOf(transaction, actor.restaurantId, order);
      let orderStatus: string = order.status;
      if (after.settled) {
        const closed = await transaction.completeOrder({
          restaurantId: actor.restaurantId,
          orderId: order.id,
          currentVersion: order.version,
          at,
        });
        if (!closed) {
          throw new DomainError("CONFLICT", "Sipariş başka bir işlem tarafından güncellendi.", {
            httpStatus: 409,
          });
        }
        orderStatus = "COMPLETED";
        // Paying for a takeaway or courier order must not touch the floor
        // plan: there is no table to free, and nudging one would either move a
        // real table that is still seated or fail silently on a null id.
        if (order.tableId !== null) {
          // Settling one bill does not empty the table: the same guests may still
          // have a second order running, and a table shown as free while it owes
          // money invites the floor to seat somebody on top of it.
          const stillOwing = await transaction.hasOtherOpenOrders(
            actor.restaurantId,
            order.tableId,
            order.id,
          );
          if (stillOwing) {
            await transaction.markTableOccupied(actor.restaurantId, order.tableId, at);
          } else {
            await transaction.markTableAvailable(actor.restaurantId, order.tableId, at);
          }
        }
      } else if (order.tableId !== null) {
        // A part-paid table is still occupied; it never returns to the floor.
        await transaction.markTableOccupied(actor.restaurantId, order.tableId, at);
      }

      const payload = {
        orderId: order.id,
        orderNumber: order.orderNumber,
        tableId: order.tableId,
        tableNumber: order.tableNumber,
        status: orderStatus,
        previousStatus: order.status,
        version: after.settled ? order.version + 1 : order.version,
        total: order.total,
        paidTotal: after.paidTotal,
        outstanding: after.outstanding,
        checkId: command.checkId ?? null,
        updatedAt: at.toISOString(),
      };
      const eventType = after.settled
        ? "ORDER_COMPLETED"
        : checkClosed
          ? "CHECK_PAID"
          : "PAYMENT_RECORDED";

      // Three append-only records of a decision already made and already
      // written. Nothing below reads them, and no balance, lock or status
      // transition depends on their order, so they go out together — which
      // also shortens how long this transaction holds the order and table rows
      // while a second cashier is waiting on them.
      await Promise.all([
        transaction.insertOrderEvent({
          restaurantId: actor.restaurantId,
          orderId: order.id,
          eventType,
          userId: actor.userId,
          payload,
        }),
        transaction.insertOutboxEvent({
          restaurantId: actor.restaurantId,
          aggregateType: "ORDER",
          aggregateId: order.id,
          eventType,
          payload,
        }),
        transaction.insertAuditLog({
          restaurantId: actor.restaurantId,
          actorUserId: actor.userId,
          action: after.settled ? "payment.completed" : "payment.partial_completed",
          entityType: "PAYMENT",
          entityId: payment.id,
          oldValue: { orderStatus: order.status, outstanding: before.outstanding },
          newValue: {
            orderStatus,
            amount: payment.amount,
            method: command.method,
            outstanding: after.outstanding,
          },
          metadata: { orderNumber: order.orderNumber, checkId: command.checkId ?? null },
          requestId: command.requestId,
        }),
      ]);

      return this.paymentResult(order, payment, after, false);
    });
  }

  /**
   * Returns collected money. The original payment row is never edited: the
   * refund is a second, opposite record, so gross and net stay separable.
   */
  async refund(
    principal: RestaurantPrincipal | null | undefined,
    command: RefundCommand,
  ): Promise<RefundResult> {
    const actor = this.authorize(principal, REFUND_ROLES, "İade");
    const keyHash = hashKey(command.idempotencyKey);
    const requestHash = refundIntent(command);

    return this.repository.transaction(async (transaction) => {
      const existing = await transaction.findRefundByIdempotencyKey(actor.restaurantId, keyHash);
      if (existing) {
        assertSameIdempotencyIntent(existing.idempotencyRequestHash, requestHash);
        const payment = await transaction.findPaymentForUpdate(
          actor.restaurantId,
          existing.paymentId,
        );
        if (!payment) throw internalRefundError();
        return {
          refundId: existing.id,
          paymentId: existing.paymentId,
          orderId: existing.orderId,
          amount: existing.amount,
          reasonCode: existing.reasonCode,
          refundedTotal: payment.refundedAmount,
          refundableRemaining: refundableAmount(payment),
          createdAt: existing.createdAt.toISOString(),
          replayed: true,
        };
      }

      const cashierShiftId = await requireActiveShift(transaction, actor, async () => {
        if (!await transaction.findPaymentForUpdate(actor.restaurantId, command.paymentId)) {
          throw new DomainError("PAYMENT_NOT_FOUND", "Ödeme bulunamadı.", { httpStatus: 404 });
        }
      });
      const payment = await transaction.findPaymentForUpdate(
        actor.restaurantId,
        command.paymentId,
      );
      if (!payment) {
        throw new DomainError("PAYMENT_NOT_FOUND", "Ödeme bulunamadı.", { httpStatus: 404 });
      }
      if (payment.status !== "COMPLETED") {
        throw new DomainError("CONFLICT", "Yalnız tamamlanmış ödeme iade edilebilir.", {
          httpStatus: 409,
          details: { status: payment.status },
        });
      }

      const order = await transaction.findPayableOrderForUpdate(
        actor.restaurantId,
        payment.orderId,
      );
      if (!order) throw internalRefundError();

      const refundable = refundableAmount(payment);
      const failure = checkRefundAmount(command.amount, refundable);
      if (failure === "NOT_POSITIVE") {
        throw new DomainError("VALIDATION_ERROR", "İade tutarı sıfırdan büyük olmalıdır.", {
          httpStatus: 400,
        });
      }
      if (failure === "EXCEEDS_REFUNDABLE") {
        throw new DomainError(
          "REFUND_EXCEEDS_REFUNDABLE",
          "İade tutarı iade edilebilir tutardan büyük olamaz.",
          { httpStatus: 409, details: { refundable } },
        );
      }

      const at = this.clock();
      const refund = await transaction.insertRefund({
        restaurantId: actor.restaurantId,
        paymentId: payment.id,
        orderId: payment.orderId,
        cashierShiftId,
        amount: command.amount,
        reasonCode: command.reasonCode,
        note: command.note ?? null,
        createdByUserId: actor.userId,
        idempotencyKeyHash: keyHash,
        idempotencyRequestHash: requestHash,
        at,
      });
      if (!refund) {
        throw new DomainError("CONFLICT", "İade kaydedilemedi.", { httpStatus: 409 });
      }
      const cached = await transaction.addPaymentRefundedAmount({
        restaurantId: actor.restaurantId,
        paymentId: payment.id,
        amount: command.amount,
        at,
      });
      if (!cached) throw internalRefundError();

      const after = await this.balanceOf(transaction, actor.restaurantId, order);
      // A refund is a money event, not an operational one. The order keeps the
      // lifecycle status it earned — a closed table never reappears as live
      // work on the kitchen or waiter board because money went back out. The
      // re-opened balance is reported through the ledger instead.

      const payload = {
        orderId: order.id,
        orderNumber: order.orderNumber,
        tableId: order.tableId,
        tableNumber: order.tableNumber,
        status: order.status,
        total: order.total,
        outstanding: after.outstanding,
        updatedAt: at.toISOString(),
      };
      await transaction.insertOrderEvent({
        restaurantId: actor.restaurantId,
        orderId: order.id,
        eventType: "PAYMENT_REFUNDED",
        userId: actor.userId,
        payload,
      });
      await transaction.insertOutboxEvent({
        restaurantId: actor.restaurantId,
        aggregateType: "PAYMENT",
        aggregateId: payment.id,
        eventType: "PAYMENT_REFUNDED",
        payload,
      });
      await transaction.insertAuditLog({
        restaurantId: actor.restaurantId,
        actorUserId: actor.userId,
        action: "payment.refunded",
        entityType: "PAYMENT",
        entityId: payment.id,
        oldValue: { refundedAmount: payment.refundedAmount },
        newValue: { refundedAmount: refundableAmount({
          amount: payment.amount,
          refundedAmount: refundable,
        }) },
        metadata: {
          orderId: order.id,
          orderNumber: order.orderNumber,
          refundId: refund.id,
          amount: command.amount,
          reasonCode: command.reasonCode,
          note: command.note ?? null,
          originalAmount: payment.amount,
        },
        requestId: command.requestId,
      });

      const refundedTotal = minorSum(payment.refundedAmount, command.amount);
      return {
        refundId: refund.id,
        paymentId: payment.id,
        orderId: order.id,
        amount: refund.amount,
        reasonCode: refund.reasonCode,
        refundedTotal,
        refundableRemaining: refundableAmount({
          amount: payment.amount,
          refundedAmount: refundedTotal,
        }),
        createdAt: at.toISOString(),
        replayed: false,
      };
    });
  }

  /**
   * The counter's money view of one order: what it owes, what came in and what
   * went back out. Read-only, so the cashier never derives totals itself.
   */
  async getLedger(
    principal: RestaurantPrincipal | null | undefined,
    orderId: string,
  ): Promise<OrderLedgerResult> {
    const actor = this.authorize(principal, PAYMENT_ROLES, "Hesap görüntüleme");

    return this.repository.transaction(async (transaction) => {
      const order = await transaction.findPayableOrderForUpdate(actor.restaurantId, orderId);
      if (!order) {
        throw new DomainError("ORDER_NOT_FOUND", "Sipariş bulunamadı.", { httpStatus: 404 });
      }
      const ledger = await transaction.listPaymentsForOrder(actor.restaurantId, orderId);
      const balance = calculateOrderBalance(
        order.total,
        ledger.map((payment) => ({
          amount: payment.amount,
          refundedAmount: payment.refundedAmount,
          counted: payment.status === "COMPLETED",
        })),
      );

      return {
        orderId: order.id,
        orderNumber: order.orderNumber,
        orderStatus: order.status,
        balance,
        payments: ledger.map((payment) => ({
          id: payment.id,
          checkId: payment.checkId,
          amount: payment.amount,
          refundedAmount: payment.refundedAmount,
          method: payment.method,
          status: payment.status,
          processedAt: (payment.processedAt ?? payment.createdAt).toISOString(),
        })),
      };
    });
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
    const authenticationFailure = decision.reason === "AUTHENTICATION_REQUIRED";
    throw new DomainError(
      authenticationFailure ? "AUTHENTICATION_REQUIRED" : "FORBIDDEN",
      authenticationFailure ? "Oturum açmanız gerekiyor." : `${action} yetkiniz yok.`,
      { httpStatus: authenticationFailure ? 401 : 403 },
    );
  }

  private async balanceOf(
    transaction: PaymentTransactionRepository,
    restaurantId: string,
    order: { readonly id: string; readonly total: string },
  ): Promise<OrderBalance> {
    const ledger = await transaction.listPaymentsForOrder(restaurantId, order.id);
    return calculateOrderBalance(
      order.total,
      ledger.map((payment) => ({
        amount: payment.amount,
        refundedAmount: payment.refundedAmount,
        counted: payment.status === "COMPLETED",
      })),
    );
  }

  private paymentResult(
    order: { readonly id: string; readonly orderNumber: string },
    payment: {
      readonly id: string;
      readonly amount: string;
      readonly method: PaymentMethod;
      readonly processedAt: Date | null;
      readonly createdAt: Date;
    },
    balance: OrderBalance,
    replayed: boolean,
  ): CreatePaymentResult {
    return {
      paymentId: payment.id,
      orderId: order.id,
      orderNumber: order.orderNumber,
      amount: payment.amount,
      method: payment.method,
      status: "COMPLETED",
      processedAt: (payment.processedAt ?? payment.createdAt).toISOString(),
      balance,
      replayed,
    };
  }
}
