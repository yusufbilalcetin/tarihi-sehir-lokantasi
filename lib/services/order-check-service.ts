import { DomainError } from "../api/domain-error";
import {
  calculateAllocationTotal,
  checkAllocation,
  splitEvenly,
  type AllocationFailure,
} from "../domain/financial-operations";
import {
  authorizeRestaurantAccess,
  type RestaurantPrincipal,
} from "../domain/restaurant-scope";
import type { UserRole } from "../domain/status";
import type { RepositoryJsonObject } from "../repositories/order-repository";
import type {
  CheckItemRecord,
  OrderCheckRecord,
  OrderCheckRepository,
  OrderCheckTransactionRepository,
} from "../repositories/order-check-repository";

/** Splitting a bill is counter work; waiters and kitchen never touch it. */
export const CHECK_ROLES = [
  "ADMIN",
  "MANAGER",
  "CASHIER",
] as const satisfies readonly UserRole[];

export const MAX_EQUAL_SHARES = 20;
export const MAX_CHECKS_PER_ORDER = 20;

export interface CheckAllocationInput {
  readonly orderItemId: string;
  readonly quantity: number;
}

export interface CheckDraft {
  readonly label?: string;
  readonly items: readonly CheckAllocationInput[];
}

export type CreateChecksCommand =
  | {
      readonly orderId: string;
      readonly mode: "ITEMS";
      readonly checks: readonly CheckDraft[];
      readonly requestId?: string;
    }
  | {
      readonly orderId: string;
      readonly mode: "EQUAL";
      readonly shares: number;
      readonly requestId?: string;
    };

export interface UpdateCheckCommand {
  readonly orderId: string;
  readonly checkId: string;
  readonly label?: string;
  readonly allocations?: readonly CheckAllocationInput[];
  readonly requestId?: string;
}

export interface CheckResult {
  readonly id: string;
  readonly label: string;
  readonly status: string;
  readonly total: string;
  readonly paidTotal: string;
  readonly refundedTotal: string;
  /** total − (paid − refunded); zero closes the check. */
  readonly outstanding: string;
  readonly items: readonly {
    readonly orderItemId: string;
    readonly productName: string;
    readonly quantity: number;
    readonly unitPrice: string;
    readonly lineTotal: string;
  }[];
}

export interface OrderChecksResult {
  readonly orderId: string;
  readonly orderNumber: string;
  readonly orderTotal: string;
  readonly checks: readonly CheckResult[];
  /** Billable lines with how much of each is still unassigned. */
  readonly allocatableItems: readonly {
    readonly orderItemId: string;
    readonly productName: string;
    readonly unitPrice: string;
    readonly quantity: number;
    readonly allocatedQuantity: number;
    readonly remainingQuantity: number;
  }[];
}

export interface OrderCheckServiceOptions {
  readonly clock?: () => Date;
}

const ALLOCATION_MESSAGES: Readonly<Record<AllocationFailure, string>> = {
  ITEM_NOT_BILLABLE: "İptal veya hesaptan çıkarılmış kalem hesaba eklenemez.",
  QUANTITY_NOT_POSITIVE: "Adet sıfırdan büyük olmalıdır.",
  QUANTITY_EXCEEDS_AVAILABLE: "Bir kalemin adedinden fazlası hesaplara dağıtılamaz.",
};

function authorize(
  principal: RestaurantPrincipal | null | undefined,
  action: string,
): RestaurantPrincipal {
  const decision = authorizeRestaurantAccess(principal, principal?.restaurantId ?? "", {
    allowedRoles: CHECK_ROLES,
  });
  if (decision.allowed) return decision.principal;
  const authenticationFailure = decision.reason === "AUTHENTICATION_REQUIRED";
  throw new DomainError(
    authenticationFailure ? "AUTHENTICATION_REQUIRED" : "FORBIDDEN",
    authenticationFailure ? "Oturum açmanız gerekiyor." : `${action} yetkiniz yok.`,
    { httpStatus: authenticationFailure ? 401 : 403 },
  );
}

function outstandingOf(check: OrderCheckRecord): string {
  const net = Number(check.paidTotal) - Number(check.refundedTotal);
  return Math.max(0, Number(check.total) - net).toFixed(2);
}

function toResult(check: OrderCheckRecord): CheckResult {
  return {
    id: check.id,
    label: check.label,
    status: check.status,
    total: check.total,
    paidTotal: check.paidTotal,
    refundedTotal: check.refundedTotal,
    outstanding: outstandingOf(check),
    items: check.items.map((item) => ({
      orderItemId: item.orderItemId,
      productName: item.productNameSnapshot,
      quantity: item.quantity,
      unitPrice: item.unitPriceSnapshot,
      lineTotal: item.lineTotal,
    })),
  };
}

export class OrderCheckService {
  private readonly clock: () => Date;

  constructor(
    private readonly repository: OrderCheckRepository,
    options: OrderCheckServiceOptions = {},
  ) {
    this.clock = options.clock ?? (() => new Date());
  }

  /** Reads the split state; a browser refresh must never lose it. */
  async listChecks(
    principal: RestaurantPrincipal | null | undefined,
    orderId: string,
  ): Promise<OrderChecksResult> {
    const actor = authorize(principal, "Hesapları görüntüleme");
    return this.repository.transaction(async (transaction) => {
      const order = await requireOrder(transaction, actor.restaurantId, orderId);
      const [checks, items] = await Promise.all([
        transaction.listChecks(actor.restaurantId, orderId),
        transaction.listBillableItems(actor.restaurantId, orderId),
      ]);
      return this.present(order, checks, items);
    });
  }

  /**
   * Splits a bill. `ITEMS` hands named quantities to each check; `EQUAL` cuts
   * the payable total into equal shares without touching the lines. Either way
   * the original order and its items are left exactly as they are.
   */
  async createChecks(
    principal: RestaurantPrincipal | null | undefined,
    command: CreateChecksCommand,
  ): Promise<OrderChecksResult> {
    const actor = authorize(principal, "Hesap bölme");

    return this.repository.transaction(async (transaction) => {
      const order = await requireOrder(transaction, actor.restaurantId, command.orderId);
      if (order.status === "CANCELLED") {
        throw new DomainError("ORDER_NOT_MUTABLE", "İptal edilmiş sipariş bölünemez.", {
          httpStatus: 409,
        });
      }

      const existing = await transaction.listChecks(actor.restaurantId, command.orderId);
      const live = existing.filter((check) => check.status !== "CANCELLED");
      const at = this.clock();
      const created: string[] = [];

      if (command.mode === "EQUAL") {
        // An equal split describes the whole bill, so it only makes sense while
        // nothing has been split or settled yet.
        if (live.length > 0) {
          throw new DomainError(
            "CHECK_ALLOCATION_INVALID",
            "Eşit bölme yalnız hiç hesap açılmamışken kullanılabilir.",
            { httpStatus: 409 },
          );
        }
        if (!Number.isSafeInteger(command.shares) || command.shares < 2) {
          throw new DomainError("VALIDATION_ERROR", "Hesap en az 2 kişiye bölünebilir.", {
            httpStatus: 400,
          });
        }
        if (command.shares > MAX_EQUAL_SHARES) {
          throw new DomainError(
            "VALIDATION_ERROR",
            `Hesap en fazla ${MAX_EQUAL_SHARES} kişiye bölünebilir.`,
            { httpStatus: 400 },
          );
        }

        const shares = splitEvenly(order.total, command.shares);
        for (const [index, share] of shares.entries()) {
          const inserted = await transaction.insertCheck({
            restaurantId: actor.restaurantId,
            orderId: order.id,
            label: `Hesap ${index + 1}`,
            total: share,
            createdByUserId: actor.userId,
            at,
          });
          created.push(inserted.id);
        }
      } else {
        if (live.length + command.checks.length > MAX_CHECKS_PER_ORDER) {
          throw new DomainError(
            "VALIDATION_ERROR",
            `Bir sipariş en fazla ${MAX_CHECKS_PER_ORDER} hesaba bölünebilir.`,
            { httpStatus: 400 },
          );
        }
        if (command.checks.length === 0) {
          throw new DomainError("VALIDATION_ERROR", "En az bir hesap gereklidir.", {
            httpStatus: 400,
          });
        }

        // A split must divide the bill, not sample it: one check is not a
        // split, and leaving portions unassigned would leave money unbilled.
        if (live.length + command.checks.length < 2) {
          throw new DomainError(
            "VALIDATION_ERROR",
            "Hesap bölme en az iki hesap gerektirir.",
            { httpStatus: 400 },
          );
        }

        const items = await transaction.listBillableItems(actor.restaurantId, command.orderId);
        const byId = new Map(items.map((item) => [item.id, item]));
        // Running tally so two drafts in one request cannot both claim the
        // same remaining portion.
        const claimed = new Map<string, number>();

        for (const [index, draft] of command.checks.entries()) {
          if (draft.items.length === 0) {
            throw new DomainError("VALIDATION_ERROR", "Boş hesap oluşturulamaz.", {
              httpStatus: 400,
            });
          }
          const lines = draft.items.map((allocation) => {
            const item = byId.get(allocation.orderItemId);
            if (!item) {
              throw new DomainError("CHECK_ALLOCATION_INVALID", "Sipariş kalemi bulunamadı.", {
                httpStatus: 409,
                details: { orderItemId: allocation.orderItemId },
              });
            }
            const alreadyClaimed = claimed.get(item.id) ?? 0;
            const failure = checkAllocation(
              {
                orderItemId: item.id,
                status: item.status,
                quantity: item.quantity,
                allocatedQuantity: item.allocatedQuantity + alreadyClaimed,
              },
              allocation.quantity,
            );
            if (failure) {
              throw new DomainError(
                "CHECK_ALLOCATION_INVALID",
                ALLOCATION_MESSAGES[failure],
                { httpStatus: 409, details: { orderItemId: item.id, reason: failure } },
              );
            }
            claimed.set(item.id, alreadyClaimed + allocation.quantity);
            return { item, quantity: allocation.quantity };
          });

          const total = calculateAllocationTotal(
            lines.map((line) => ({
              orderItemId: line.item.id,
              quantity: line.quantity,
              unitPrice: line.item.unitPrice,
            })),
          );
          const inserted = await transaction.insertCheck({
            restaurantId: actor.restaurantId,
            orderId: order.id,
            label: draft.label?.trim() || `Hesap ${live.length + index + 1}`,
            total,
            createdByUserId: actor.userId,
            at,
          });
          created.push(inserted.id);

          for (const line of lines) {
            await transaction.insertCheckAllocation({
              restaurantId: actor.restaurantId,
              checkId: inserted.id,
              orderItemId: line.item.id,
              quantity: line.quantity,
              // Snapshot, so a later price change cannot move a printed bill.
              unitPriceSnapshot: line.item.unitPrice,
              lineTotal: (Number(line.item.unitPrice) * line.quantity).toFixed(2),
              at,
            });
          }
        }
      }

      // Every billable portion must end up on a check, otherwise part of the
      // bill would simply never be presented to anyone.
      if (command.mode === "ITEMS") {
        const remaining = await transaction.listBillableItems(
          actor.restaurantId,
          command.orderId,
        );
        const unassigned = remaining.filter(
          (item) =>
            item.status !== "CANCELLED" &&
            item.status !== "VOIDED" &&
            item.allocatedQuantity < item.quantity,
        );
        if (unassigned.length > 0) {
          const first = unassigned[0]!;
          throw new DomainError(
            "CHECK_ALLOCATION_INVALID",
            `Hesap bölme tamamlanamadı. ${
              first.quantity - first.allocatedQuantity
            } ${first.productNameSnapshot} henüz bir hesaba atanmadı.`,
            {
              httpStatus: 409,
              details: {
                unassigned: unassigned.map((item) => ({
                  orderItemId: item.id,
                  productName: item.productNameSnapshot,
                  remaining: item.quantity - item.allocatedQuantity,
                })),
              },
            },
          );
        }
      }

      const payload: RepositoryJsonObject = {
        orderId: order.id,
        orderNumber: order.orderNumber,
        tableId: order.tableId,
        checkCount: created.length,
        mode: command.mode,
        updatedAt: at.toISOString(),
      };
      await transaction.insertOutbox({
        restaurantId: actor.restaurantId,
        aggregateType: "ORDER",
        aggregateId: order.id,
        eventType: "CHECK_CREATED",
        payload,
      });
      await transaction.insertAudit({
        restaurantId: actor.restaurantId,
        actorUserId: actor.userId,
        action: "order.check.created",
        entityType: "ORDER",
        entityId: order.id,
        oldValue: { checkCount: live.length },
        newValue: { checkCount: live.length + created.length, mode: command.mode },
        metadata: { orderNumber: order.orderNumber, checkIds: created },
        requestId: command.requestId,
      });

      const [checks, items] = await Promise.all([
        transaction.listChecks(actor.restaurantId, command.orderId),
        transaction.listBillableItems(actor.restaurantId, command.orderId),
      ]);
      return this.present(order, checks, items);
    });
  }

  /**
   * Rewrites an untouched check. Only a check that has taken no money may be
   * edited: once a guest has paid against it the allocations are part of a
   * settled receipt and become immutable.
   */
  async updateCheck(
    principal: RestaurantPrincipal | null | undefined,
    command: UpdateCheckCommand,
  ): Promise<OrderChecksResult> {
    const actor = authorize(principal, "Hesap düzenleme");

    return this.repository.transaction(async (transaction) => {
      const order = await requireOrder(transaction, actor.restaurantId, command.orderId);
      const check = await transaction.findCheckForUpdate(actor.restaurantId, command.checkId);
      if (!check || check.orderId !== order.id) {
        throw new DomainError("CHECK_NOT_FOUND", "Hesap bulunamadı.", { httpStatus: 404 });
      }
      if (check.status !== "OPEN" || Number(check.paidTotal) > 0) {
        throw new DomainError(
          "CHECK_NOT_MUTABLE",
          check.status === "OPEN"
            ? "Ödeme alınmış hesabın içeriği değiştirilemez."
            : "Yalnız açık hesaplar düzenlenebilir.",
          { httpStatus: 409, details: { status: check.status, paidTotal: check.paidTotal } },
        );
      }

      const at = this.clock();
      const label = command.label?.trim();
      if (label !== undefined && label.length === 0) {
        throw new DomainError("VALIDATION_ERROR", "Hesap adı boş olamaz.", { httpStatus: 400 });
      }
      let total = check.total;

      if (command.allocations) {
        if (command.allocations.length === 0) {
          throw new DomainError("VALIDATION_ERROR", "Hesap en az bir kalem içermelidir.", {
            httpStatus: 400,
          });
        }
        const items = await transaction.listBillableItems(actor.restaurantId, command.orderId);
        const byId = new Map(items.map((item) => [item.id, item]));
        // This check's own current allocations are released first, so an edit
        // that keeps a quantity is not counted against itself.
        const released = new Map<string, number>();
        for (const allocation of check.items) {
          released.set(
            allocation.orderItemId,
            (released.get(allocation.orderItemId) ?? 0) + allocation.quantity,
          );
        }
        const claimed = new Map<string, number>();

        const lines = command.allocations.map((allocation) => {
          const item = byId.get(allocation.orderItemId);
          if (!item) {
            throw new DomainError("CHECK_ALLOCATION_INVALID", "Sipariş kalemi bulunamadı.", {
              httpStatus: 409,
              details: { orderItemId: allocation.orderItemId },
            });
          }
          const alreadyClaimed = claimed.get(item.id) ?? 0;
          const failure = checkAllocation(
            {
              orderItemId: item.id,
              status: item.status,
              quantity: item.quantity,
              allocatedQuantity:
                item.allocatedQuantity - (released.get(item.id) ?? 0) + alreadyClaimed,
            },
            allocation.quantity,
          );
          if (failure) {
            throw new DomainError("CHECK_ALLOCATION_INVALID", ALLOCATION_MESSAGES[failure], {
              httpStatus: 409,
              details: { orderItemId: item.id, reason: failure },
            });
          }
          claimed.set(item.id, alreadyClaimed + allocation.quantity);
          return { item, quantity: allocation.quantity };
        });

        total = calculateAllocationTotal(
          lines.map((line) => ({
            orderItemId: line.item.id,
            quantity: line.quantity,
            unitPrice: line.item.unitPrice,
          })),
        );

        // Atomic replacement inside the same transaction: the old rows go and
        // the new ones land together, or neither does.
        await transaction.deleteCheckAllocations(actor.restaurantId, check.id);
        for (const line of lines) {
          await transaction.insertCheckAllocation({
            restaurantId: actor.restaurantId,
            checkId: check.id,
            orderItemId: line.item.id,
            quantity: line.quantity,
            unitPriceSnapshot: line.item.unitPrice,
            lineTotal: (Number(line.item.unitPrice) * line.quantity).toFixed(2),
            at,
          });
        }
      }

      await transaction.updateCheckDetails(actor.restaurantId, check.id, {
        label: label ?? check.label,
        total,
        at,
      });

      await transaction.insertOutbox({
        restaurantId: actor.restaurantId,
        aggregateType: "ORDER",
        aggregateId: order.id,
        eventType: "CHECK_UPDATED",
        payload: {
          orderId: order.id,
          orderNumber: order.orderNumber,
          tableId: order.tableId,
          checkId: check.id,
          status: check.status,
          updatedAt: at.toISOString(),
        },
      });
      await transaction.insertAudit({
        restaurantId: actor.restaurantId,
        actorUserId: actor.userId,
        action: "order.check.updated",
        entityType: "ORDER_CHECK",
        entityId: check.id,
        oldValue: {
          label: check.label,
          total: check.total,
          allocations: check.items.map((allocation) => ({
            orderItemId: allocation.orderItemId,
            quantity: allocation.quantity,
          })),
        },
        newValue: {
          label: label ?? check.label,
          total,
          allocations: (command.allocations ?? check.items.map((allocation) => ({
            orderItemId: allocation.orderItemId,
            quantity: allocation.quantity,
          }))).map((allocation) => ({ ...allocation })),
        },
        metadata: { orderId: order.id, orderNumber: order.orderNumber },
        requestId: command.requestId,
      });

      const [checks, items] = await Promise.all([
        transaction.listChecks(actor.restaurantId, command.orderId),
        transaction.listBillableItems(actor.restaurantId, command.orderId),
      ]);
      return this.present(order, checks, items);
    });
  }

  /** Cancels an unused check and frees its allocations back to the order. */
  async cancelCheck(
    principal: RestaurantPrincipal | null | undefined,
    command: { readonly orderId: string; readonly checkId: string; readonly requestId?: string },
  ): Promise<OrderChecksResult> {
    const actor = authorize(principal, "Hesap iptali");

    return this.repository.transaction(async (transaction) => {
      const order = await requireOrder(transaction, actor.restaurantId, command.orderId);
      const check = await transaction.findCheckForUpdate(actor.restaurantId, command.checkId);
      if (!check || check.orderId !== order.id) {
        throw new DomainError("CHECK_NOT_FOUND", "Hesap bulunamadı.", { httpStatus: 404 });
      }
      if (check.status === "PAID" || Number(check.paidTotal) > 0) {
        throw new DomainError(
          "CHECK_ALREADY_PAID",
          "Ödeme alınmış hesap iptal edilemez.",
          { httpStatus: 409 },
        );
      }

      const at = this.clock();
      const cancelled = await transaction.cancelCheck(actor.restaurantId, check.id, at);
      if (!cancelled) {
        throw new DomainError("CONFLICT", "Hesap başka bir işlem tarafından güncellendi.", {
          httpStatus: 409,
        });
      }
      // The allocation rows stay for history. They stop counting against the
      // order because only OPEN and PAID checks hold quantities, so the
      // portions are immediately available to a new check.

      await transaction.insertOutbox({
        restaurantId: actor.restaurantId,
        aggregateType: "ORDER",
        aggregateId: order.id,
        eventType: "CHECK_UPDATED",
        payload: {
          orderId: order.id,
          orderNumber: order.orderNumber,
          tableId: order.tableId,
          checkId: check.id,
          status: "CANCELLED",
          updatedAt: at.toISOString(),
        },
      });
      await transaction.insertAudit({
        restaurantId: actor.restaurantId,
        actorUserId: actor.userId,
        action: "order.check.cancelled",
        entityType: "ORDER_CHECK",
        entityId: check.id,
        oldValue: { status: check.status, total: check.total },
        newValue: { status: "CANCELLED" },
        metadata: { orderId: order.id, orderNumber: order.orderNumber },
        requestId: command.requestId,
      });

      const [checks, items] = await Promise.all([
        transaction.listChecks(actor.restaurantId, command.orderId),
        transaction.listBillableItems(actor.restaurantId, command.orderId),
      ]);
      return this.present(order, checks, items);
    });
  }

  private present(
    order: { id: string; orderNumber: string; total: string },
    checks: readonly OrderCheckRecord[],
    items: readonly CheckItemRecord[],
  ): OrderChecksResult {
    return {
      orderId: order.id,
      orderNumber: order.orderNumber,
      orderTotal: order.total,
      checks: checks.map(toResult),
      allocatableItems: items
        .filter((item) => item.status !== "CANCELLED" && item.status !== "VOIDED")
        .map((item) => ({
          orderItemId: item.id,
          productName: item.productNameSnapshot,
          unitPrice: item.unitPrice,
          quantity: item.quantity,
          allocatedQuantity: item.allocatedQuantity,
          remainingQuantity: Math.max(0, item.quantity - item.allocatedQuantity),
        })),
    };
  }
}

async function requireOrder(
  transaction: OrderCheckTransactionRepository,
  restaurantId: string,
  orderId: string,
) {
  const order = await transaction.findOrderForUpdate(restaurantId, orderId);
  if (!order) {
    throw new DomainError("ORDER_NOT_FOUND", "Sipariş bulunamadı.", { httpStatus: 404 });
  }
  return order;
}
