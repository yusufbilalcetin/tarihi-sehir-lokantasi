import { createHash } from "node:crypto";

import { DomainError, internalError } from "@/lib/api/domain-error";
import {
  REFUND_ROLES,
  calculateOrderBalance,
  checkPaymentAmount,
  checkRefundAmount,
  refundableAmount,
  type OrderBalance,
} from "@/lib/domain/financial-operations";
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

const PAYMENT_ROLES = ["ADMIN", "MANAGER", "CASHIER"] as const satisfies readonly UserRole[];

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
): Promise<string> {
  const shift = await transaction.findActiveShiftForUpdate(
    actor.restaurantId,
    actor.userId,
  );
  if (!shift) {
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

    return this.repository.transaction(async (transaction) => {
      const order = await transaction.findPayableOrderForUpdate(actor.restaurantId, command.orderId);
      if (!order) {
        throw new DomainError("ORDER_NOT_FOUND", "Sipariş bulunamadı.", { httpStatus: 404 });
      }

      // A retried request replays its own receipt rather than collecting twice.
      const replay = await transaction.findPaymentByIdempotencyKey(actor.restaurantId, keyHash);
      if (replay) {
        if (replay.orderId !== order.id) {
          throw new DomainError(
            "IDEMPOTENCY_CONFLICT",
            "Bu istek anahtarı başka bir sipariş için kullanıldı.",
            { httpStatus: 409 },
          );
        }
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

      // A collection against a split check is capped by that check's own
      // remainder, not by the whole order's.
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
      const ceiling = checkCeiling ?? before.outstanding;
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

      // Resolved last, so a cross-tenant or missing order still answers
      // "not found" exactly as it did before shifts existed. Taking the shift
      // lock here is what serialises this collection against a shift close: if
      // the close committed first the shift is no longer OPEN and this is
      // refused, and if it did not, the close waits and counts this payment.
      const cashierShiftId = await requireActiveShift(transaction, actor);

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
        at,
      });
      if (!payment) {
        // The idempotency index rejected it; the winner's row is the truth.
        const raced = await transaction.findPaymentByIdempotencyKey(actor.restaurantId, keyHash);
        if (raced) {
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

    return this.repository.transaction(async (transaction) => {
      const existing = await transaction.findRefundByIdempotencyKey(actor.restaurantId, keyHash);
      if (existing) {
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

      // The refund belongs to the shift giving the money back, which is very
      // often not the (already closed) shift that collected it.
      const cashierShiftId = await requireActiveShift(transaction, actor);

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
