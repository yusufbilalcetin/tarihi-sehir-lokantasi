import { createHash } from "node:crypto";

import { DomainError, internalError } from "../api/domain-error";
import { createIdempotencyFingerprint } from "../domain/idempotency";
import {
  addMoney,
  applyBasisPoints,
  decimalToMinor,
  minorToDecimal,
  multiplyMoney,
  percentageToBasisPoints,
} from "../domain/money";
import {
  authorizeRestaurantAccess,
  type RestaurantPrincipal,
} from "../domain/restaurant-scope";
import {
  FINANCIAL_NOTE_MAX_LENGTH,
  VOID_REASON_CODES,
  canRoleVoidItem,
  isItemBillable,
  isItemVoidable,
} from "../domain/financial-operations";
import {
  CANCELLATION_NOTE_MAX_LENGTH,
  CANCELLATION_REASONS,
  calculateOrderAmounts,
  canAddItemsToOrder,
  canRoleAddOrderItems,
  canRoleCancelOrder,
  canRoleCancelOrderItem,
  isOrderCancellable,
  rolesAllowedToCancelItem,
  type OrderAmounts,
} from "../domain/order-mutations";
import {
  ORDER_CHANNELS,
  ORDER_STATUS_TRANSITIONS,
  canRoleTransitionOrderStatus,
  orderRequiresTable,
  validateStatusTransition,
  type OrderChannel,
  type OrderEventType,
  type OrderItemStatus,
  type OrderStatus,
} from "../domain/status";
import type {
  MutableOrderWithItems,
  OrderContextRecord,
  OrderProductRecord,
  OrderRepository,
  OrderTransactionRepository,
  RepositoryJsonObject,
  RepositoryJsonValue,
} from "../repositories/order-repository";

const CREATE_ORDER_SCOPE_PREFIX = "CUSTOMER_ORDER";
const CREATE_STAFF_ORDER_SCOPE_PREFIX = "STAFF_ORDER";
const ADD_ITEMS_SCOPE_PREFIX = "ORDER_ADD_ITEMS";
const DEFAULT_IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1_000;
const DEFAULT_IDEMPOTENCY_LOCK_MS = 30 * 1_000;

const STATUS_EVENTS: Readonly<Record<Exclude<OrderStatus, "NEW">, OrderEventType>> = {
  CONFIRMED: "ORDER_CONFIRMED",
  PREPARING: "ORDER_PREPARING",
  READY: "ORDER_READY",
  SERVED: "ORDER_SERVED",
  COMPLETED: "ORDER_COMPLETED",
  CANCELLED: "ORDER_CANCELLED",
};

export interface CustomerOrderItemInput {
  readonly productId: string;
  readonly quantity: number;
  readonly note?: string;
}

export interface CreateCustomerOrderCommand {
  readonly restaurantId: string;
  readonly tableId: string;
  /** Signed customer session access version, checked against the locked table row. */
  readonly tableAccessVersion: number;
  /**
   * The nonce of the signed table session, identifying this one sitting.
   * Supplied by the route from the verified cookie; a caller-supplied value
   * would let anyone claim another party's orders.
   */
  readonly sessionNonce: string;
  readonly idempotencyKey: string;
  readonly items: readonly CustomerOrderItemInput[];
  readonly notes?: string;
}

/**
 * A takeaway or courier order from the public page.
 *
 * `restaurantId` is filled in by the route from the signed guest session, not
 * by the caller: the shape has no place for a client-supplied tenant, price or
 * table, which is what keeps those three impossible to spoof.
 */
export interface CreateGuestOrderCommand {
  readonly restaurantId: string;
  readonly channel: Exclude<OrderChannel, "DINE_IN">;
  readonly idempotencyKey: string;
  readonly items: readonly CustomerOrderItemInput[];
  readonly notes?: string;
  readonly requestId?: string;
  readonly fulfillment: GuestFulfillmentDetails;
}

/** A waiter taking an order at the table; the guest has no QR session here. */
export interface CreateStaffOrderCommand {
  readonly tableId: string;
  readonly idempotencyKey: string;
  readonly items: readonly CustomerOrderItemInput[];
  readonly notes?: string;
  readonly requestId?: string;
}

type OrderCreator =
  | {
      readonly kind: "CUSTOMER";
      readonly tableAccessVersion: number;
      readonly sessionNonce: string;
    }
  | { readonly kind: "STAFF"; readonly staffUserId: string }
  /**
   * Someone ordering takeaway or courier from the public page. They are a
   * customer, and the order records them as one; what separates them from a
   * customer at a table is that they hold no table token, so there is no
   * table access version to check. They cannot act as staff and their session
   * cannot open a table.
   */
  | { readonly kind: "GUEST" };

/** What the guest must tell us so the food can reach them. Nothing more. */
interface GuestFulfillmentDetails {
  readonly customerName: string;
  readonly contact: string;
  /** Required for DELIVERY, forbidden for TAKEAWAY. */
  readonly address: string | null;
  readonly deliveryNotes: string | null;
}

interface CreateOrderCommand {
  readonly restaurantId: string;
  readonly channel: OrderChannel;
  /** Null unless the channel is DINE_IN. */
  readonly tableId: string | null;
  readonly idempotencyKey: string;
  readonly items: readonly CustomerOrderItemInput[];
  readonly notes?: string;
  readonly creator: OrderCreator;
  readonly requestId?: string;
  /** Present exactly when the channel is TAKEAWAY or DELIVERY. */
  readonly fulfillment?: GuestFulfillmentDetails;
}

/** Roles allowed to open an order for a table. Kitchen and cashier cannot. */
const ORDER_CREATOR_ROLES = ["ADMIN", "MANAGER", "WAITER"] as const;

export interface CreatedOrderItemResult {
  readonly productId: string;
  readonly productName: string;
  readonly unitPrice: string;
  readonly quantity: number;
  readonly lineTotal: string;
  readonly note: string | null;
}

export interface CreateOrderResult {
  readonly order: {
    readonly id: string;
    readonly restaurantId: string;
    readonly channel: OrderChannel;
    /** Null on takeaway and courier orders. */
    readonly tableId: string | null;
    readonly orderNumber: string;
    readonly status: "NEW";
    readonly createdAt: string;
  };
  readonly amounts: {
    readonly currency: string;
    readonly subtotal: string;
    readonly serviceCharge: string;
    readonly tax: string;
    readonly total: string;
  };
  readonly items: readonly CreatedOrderItemResult[];
  readonly replayed: boolean;
}

export interface UpdateOrderStatusCommand {
  readonly restaurantId: string;
  readonly orderId: string;
  readonly nextStatus: Exclude<OrderStatus, "NEW">;
  readonly requestId?: string;
}

export interface AddOrderItemsCommand {
  readonly orderId: string;
  readonly items: readonly CustomerOrderItemInput[];
  readonly idempotencyKey: string;
  readonly requestId?: string;
}

export interface AddedOrderItemResult {
  readonly productId: string;
  readonly productName: string;
  readonly unitPrice: string;
  readonly quantity: number;
  readonly lineTotal: string;
  readonly note: string | null;
}

export interface OrderAmountsResult extends OrderAmounts {
  readonly currency: string;
}

export interface AddOrderItemsResult {
  readonly orderId: string;
  readonly orderNumber: string;
  readonly status: OrderStatus;
  readonly addedItems: readonly AddedOrderItemResult[];
  readonly amounts: OrderAmountsResult;
  readonly replayed: boolean;
}

export interface CancelOrderItemCommand {
  readonly orderId: string;
  readonly orderItemId: string;
  readonly reason: string;
  readonly reasonNote?: string;
  readonly requestId?: string;
}

export interface CancelOrderItemResult {
  readonly orderId: string;
  readonly orderItemId: string;
  readonly previousStatus: OrderItemStatus;
  readonly status: "CANCELLED" | "VOIDED";
  readonly amounts: OrderAmountsResult;
  readonly updatedAt: string;
}

export interface VoidOrderItemCommand {
  readonly orderId: string;
  readonly orderItemId: string;
  readonly reasonCode: string;
  readonly note?: string;
  readonly requestId?: string;
}

export interface CancelOrderCommand {
  readonly orderId: string;
  readonly reason: string;
  readonly reasonNote?: string;
  readonly requestId?: string;
}

export interface UpdateOrderStatusResult {
  readonly orderId: string;
  readonly orderNumber: string;
  readonly previousStatus: OrderStatus;
  readonly status: Exclude<OrderStatus, "NEW">;
  readonly version: number;
  readonly updatedAt: string;
}

export interface OrderServiceOptions {
  readonly clock?: () => Date;
  readonly idempotencyTtlMs?: number;
  readonly idempotencyLockMs?: number;
}

interface NormalizedOrderItem {
  readonly productId: string;
  readonly quantity: number;
  readonly note: string | null;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function normalizedNote(value: string | undefined, maximum: number): string | null {
  if (value === undefined) return null;
  const note = value.trim();
  if (!note) return null;
  if (note.length > maximum) {
    throw new DomainError("VALIDATION_ERROR", `Not en fazla ${maximum} karakter olabilir.`, {
      httpStatus: 400,
    });
  }
  return note;
}

function validateBasicCommand(command: CreateOrderCommand): readonly NormalizedOrderItem[] {
  if (!command.restaurantId) {
    throw new DomainError("VALIDATION_ERROR", "Restoran bilgisi eksik.", { httpStatus: 400 });
  }
  // The channel/table pairing is the same invariant the database enforces,
  // checked here so a mismatch is a sentence rather than a constraint error.
  if (orderRequiresTable(command.channel)) {
    if (!command.tableId) {
      throw new DomainError("VALIDATION_ERROR", "Masa bilgisi eksik.", { httpStatus: 400 });
    }
    if (command.fulfillment) {
      throw new DomainError("VALIDATION_ERROR", "Masa siparişinde teslimat bilgisi bulunmaz.", {
        httpStatus: 400,
      });
    }
  } else {
    // A caller cannot smuggle a table onto a takeaway order to make it occupy
    // the floor or borrow a table's session.
    if (command.tableId) {
      throw new DomainError("VALIDATION_ERROR", "Paket ve kurye siparişi masaya bağlanamaz.", {
        httpStatus: 400,
      });
    }
    if (command.creator.kind === "CUSTOMER") {
      throw new DomainError("INVALID_TABLE_TOKEN", "Masa oturumu paket sipariş açamaz.", {
        httpStatus: 401,
      });
    }
    validateFulfillmentDetails(command);
  }
  if (
    command.creator.kind === "CUSTOMER" &&
    (!Number.isSafeInteger(command.creator.tableAccessVersion) ||
      command.creator.tableAccessVersion < 1 ||
      // An order stamped with a blank sitting would be invisible to the guest
      // who placed it and visible to nobody, so it is refused rather than
      // written. The route only ever passes a verified cookie nonce.
      !command.creator.sessionNonce)
  ) {
    throw new DomainError("INVALID_TABLE_TOKEN", "Masa oturumu geçersiz.", {
      httpStatus: 401,
    });
  }
  if (
    !/^[A-Za-z0-9._:-]{8,128}$/.test(command.idempotencyKey)
  ) {
    throw new DomainError("VALIDATION_ERROR", "Idempotency anahtarı geçersiz.", {
      httpStatus: 400,
    });
  }
  return validateItems(command.items);
}

/** Contact minimisation: takeaway asks for a name and a number, nothing else. */
function validateFulfillmentDetails(command: CreateOrderCommand): GuestFulfillmentDetails {
  const details = command.fulfillment;
  if (!details) {
    throw new DomainError("VALIDATION_ERROR", "İletişim bilgisi eksik.", { httpStatus: 400 });
  }
  const name = details.customerName.trim();
  const contact = details.contact.trim();
  if (name.length < 2 || name.length > 160) {
    throw new DomainError("VALIDATION_ERROR", "Ad Soyad 2-160 karakter olmalıdır.", { httpStatus: 400 });
  }
  if (contact.length < 7 || contact.length > 80) {
    throw new DomainError("VALIDATION_ERROR", "Telefon numarası geçersiz.", { httpStatus: 400 });
  }
  const address = details.address?.trim() || null;
  if (command.channel === "DELIVERY" && !address) {
    throw new DomainError("VALIDATION_ERROR", "Kurye siparişi için adres zorunludur.", { httpStatus: 400 });
  }
  if (command.channel === "TAKEAWAY" && address) {
    throw new DomainError("VALIDATION_ERROR", "Gel-al siparişinde adres bulunmaz.", { httpStatus: 400 });
  }
  const deliveryNotes = details.deliveryNotes?.trim() || null;
  if (deliveryNotes && deliveryNotes.length > 500) {
    throw new DomainError("VALIDATION_ERROR", "Teslimat notu en fazla 500 karakter olabilir.", { httpStatus: 400 });
  }
  return { customerName: name, contact, address, deliveryNotes };
}

/** Shared by order creation and later additions so both reject the same input. */
function validateItems(
  items: readonly CustomerOrderItemInput[],
): readonly NormalizedOrderItem[] {
  if (!Array.isArray(items) || items.length < 1 || items.length > 50) {
    throw new DomainError("VALIDATION_ERROR", "Siparis 1 ile 50 kalem icermelidir.", {
      httpStatus: 400,
    });
  }

  const seenLines = new Set<string>();
  return items.map((item) => {
    if (!item.productId || item.productId.length > 128) {
      throw new DomainError("VALIDATION_ERROR", "Ürün kimliği geçersiz.", {
        httpStatus: 400,
      });
    }
    if (!Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 99) {
      throw new DomainError("VALIDATION_ERROR", "Ürün adedi geçersiz.", {
        httpStatus: 400,
      });
    }
    const note = normalizedNote(item.note, 500);
    const lineIdentity = JSON.stringify([item.productId, note]);
    if (seenLines.has(lineIdentity)) {
      throw new DomainError("VALIDATION_ERROR", "Aynı sipariş kalemi tekrar edemez.", {
        httpStatus: 400,
      });
    }
    seenLines.add(lineIdentity);
    return { productId: item.productId, quantity: item.quantity, note };
  });
}

function normalizedCancellationReason(
  reason: string,
  note: string | undefined,
): { readonly reason: string; readonly note: string | null } {
  if (!(CANCELLATION_REASONS as readonly string[]).includes(reason)) {
    throw new DomainError("VALIDATION_ERROR", "İptal nedeni geçersiz.", { httpStatus: 400 });
  }
  const trimmed = note?.trim() ?? "";
  if (trimmed.length > CANCELLATION_NOTE_MAX_LENGTH) {
    throw new DomainError(
      "VALIDATION_ERROR",
      `İptal açıklaması en fazla ${CANCELLATION_NOTE_MAX_LENGTH} karakter olabilir.`,
      { httpStatus: 400 },
    );
  }
  // "Diğer" carries no meaning on its own, so it must be explained.
  if (reason === "Diğer" && !trimmed) {
    throw new DomainError("VALIDATION_ERROR", "Diğer seçildiğinde açıklama zorunludur.", {
      httpStatus: 400,
    });
  }
  return { reason, note: trimmed || null };
}

/** Shared reason validation for the financial corrections. */
function normalizedFinancialReason(
  code: string,
  note: string | undefined,
  allowed: readonly string[],
  label: string,
): { readonly code: string; readonly note: string | null } {
  if (!allowed.includes(code)) {
    throw new DomainError("VALIDATION_ERROR", `${label} geçersiz.`, { httpStatus: 400 });
  }
  const trimmed = note?.trim() ?? "";
  if (trimmed.length > FINANCIAL_NOTE_MAX_LENGTH) {
    throw new DomainError(
      "VALIDATION_ERROR",
      `Açıklama en fazla ${FINANCIAL_NOTE_MAX_LENGTH} karakter olabilir.`,
      { httpStatus: 400 },
    );
  }
  if (code === "OTHER" && !trimmed) {
    throw new DomainError("VALIDATION_ERROR", "Diğer seçildiğinde açıklama zorunludur.", {
      httpStatus: 400,
    });
  }
  return { code, note: trimmed || null };
}

async function requireMutableOrder(
  transaction: OrderTransactionRepository,
  restaurantId: string,
  orderId: string,
): Promise<MutableOrderWithItems> {
  const order = await transaction.findOrderWithItemsForUpdate(restaurantId, orderId);
  if (!order) {
    throw new DomainError("ORDER_NOT_FOUND", "Sipariş bulunamadı.", { httpStatus: 404 });
  }
  return order;
}

/**
 * Rebuilds the order money from every surviving line plus any line this
 * request is adding, always at the rates the order was opened with.
 */
function recalculate(
  order: MutableOrderWithItems,
  addedLines: readonly { readonly lineTotalMinor: number; readonly cancelled: boolean }[],
  cancelledItemId?: string,
): OrderAmounts {
  const existing = order.items.map((line) => ({
    lineTotalMinor: decimalToMinor(line.lineTotal),
    // Cancelled and voided lines are both off the bill.
    cancelled: !isItemBillable(line.status) || line.id === cancelledItemId,
  }));
  return calculateOrderAmounts(
    [...existing, ...addedLines],
    order.serviceFeeRate ?? "0.00",
    order.taxRate ?? "0.00",
  );
}

async function applyAmounts(
  transaction: OrderTransactionRepository,
  restaurantId: string,
  order: MutableOrderWithItems,
  amounts: OrderAmounts,
  at: Date,
): Promise<void> {
  const applied = await transaction.updateOrderAmounts({
    restaurantId,
    orderId: order.id,
    currentVersion: order.version,
    subtotal: amounts.subtotal,
    serviceChargeTotal: amounts.serviceCharge,
    taxTotal: amounts.tax,
    total: amounts.total,
    at,
  });
  if (!applied) {
    throw new DomainError("CONFLICT", "Sipariş başka bir işlem tarafından güncellendi.", {
      httpStatus: 409,
    });
  }
}

function storedAddItemsResult(value: RepositoryJsonValue | null): AddOrderItemsResult | null {
  if (!isObject(value) || !isObject(value.amounts) || !Array.isArray(value.addedItems)) {
    return null;
  }
  if (
    typeof value.orderId !== "string" ||
    typeof value.orderNumber !== "string" ||
    typeof value.status !== "string"
  ) return null;

  const addedItems: AddedOrderItemResult[] = [];
  for (const item of value.addedItems) {
    if (
      !isObject(item) ||
      typeof item.productId !== "string" ||
      typeof item.productName !== "string" ||
      typeof item.unitPrice !== "string" ||
      typeof item.quantity !== "number" ||
      typeof item.lineTotal !== "string" ||
      !(typeof item.note === "string" || item.note === null)
    ) return null;
    addedItems.push({
      productId: item.productId,
      productName: item.productName,
      unitPrice: item.unitPrice,
      quantity: item.quantity,
      lineTotal: item.lineTotal,
      note: item.note,
    });
  }

  const amounts = value.amounts;
  if (
    typeof amounts.subtotal !== "string" ||
    typeof amounts.serviceCharge !== "string" ||
    typeof amounts.tax !== "string" ||
    typeof amounts.total !== "string" ||
    typeof amounts.currency !== "string"
  ) return null;

  return {
    orderId: value.orderId,
    orderNumber: value.orderNumber,
    status: value.status as OrderStatus,
    addedItems,
    amounts: {
      subtotal: amounts.subtotal,
      serviceCharge: amounts.serviceCharge,
      tax: amounts.tax,
      total: amounts.total,
      currency: amounts.currency,
    },
    replayed: true,
  };
}

function jsonAddItemsResult(result: AddOrderItemsResult): RepositoryJsonObject {
  return {
    orderId: result.orderId,
    orderNumber: result.orderNumber,
    status: result.status,
    addedItems: result.addedItems.map((item) => ({ ...item })),
    amounts: { ...result.amounts },
  };
}

function requireUsableContext(
  context: OrderContextRecord | null,
  creator: OrderCreator,
  channel: OrderChannel,
): OrderContextRecord {
  if (!context || !context.restaurantIsActive) {
    throw new DomainError("TABLE_INACTIVE", "Restoran şu anda sipariş alamıyor.", {
      httpStatus: 403,
    });
  }
  if (creator.kind === "GUEST") {
    // A guest has no table and therefore no table token. What still governs
    // them is the same self-service switch a QR customer answers to: if the
    // restaurant has turned online ordering off, it is off at every door.
    if (!context.orderingEnabled) {
      throw new DomainError("CONFLICT", "Online sipariş şu anda kapalı.", { httpStatus: 409 });
    }
    return context;
  }
  if (!orderRequiresTable(channel)) {
    // Only a guest may open a takeaway or courier order; a table session
    // reaching this point would be a table borrowing a channel that is not
    // its own.
    throw new DomainError("VALIDATION_ERROR", "Bu sipariş kanalı bu oturumla açılamaz.", {
      httpStatus: 400,
    });
  }
  if (!context.tableIsActive) {
    throw new DomainError("TABLE_INACTIVE", "Masa şu anda sipariş alamıyor.", {
      httpStatus: 403,
    });
  }
  // A waiter at the table has no QR session, and the guest-facing ordering
  // switch only governs self-service; staff must still be able to take orders.
  if (creator.kind === "STAFF") return context;
  if (context.tableTokenRevokedAt || context.tableTokenVersion !== creator.tableAccessVersion) {
    throw new DomainError("INVALID_TABLE_TOKEN", "Masa oturumunun süresi dolmuş.", {
      httpStatus: 401,
    });
  }
  if (!context.orderingEnabled) {
    throw new DomainError("CONFLICT", "Online sipariş şu anda kapalı.", {
      httpStatus: 409,
    });
  }
  return context;
}

function mapProducts(
  requestedIds: readonly string[],
  products: readonly OrderProductRecord[],
  restaurantId: string,
): ReadonlyMap<string, OrderProductRecord> {
  const byId = new Map(products.map((product) => [product.id, product]));
  for (const productId of requestedIds) {
    const product = byId.get(productId);
    if (!product || product.restaurantId !== restaurantId) {
      throw new DomainError("PRODUCT_NOT_FOUND", "Sipariş ürünlerinden biri bulunamadı.", {
        httpStatus: 400,
      });
    }
    if (
      !product.isActive ||
      !product.isAvailable ||
      product.deletedAt ||
      !product.categoryIsActive ||
      product.categoryDeletedAt
    ) {
      // The id lets a localized client name the item without echoing Turkish copy.
      throw new DomainError("PRODUCT_UNAVAILABLE", `${product.name} şu anda mevcut değil.`, {
        httpStatus: 409,
        details: { productId: product.id },
      });
    }
  }
  return byId;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function storedOrderResult(value: RepositoryJsonValue | null): CreateOrderResult | null {
  if (!isObject(value) || !isObject(value.order) || !isObject(value.amounts)) return null;
  if (!Array.isArray(value.items)) return null;
  const order = value.order;
  const amounts = value.amounts;
  if (
    typeof order.id !== "string" ||
    typeof order.restaurantId !== "string" ||
    !(typeof order.tableId === "string" || order.tableId === null) ||
    typeof order.orderNumber !== "string" ||
    order.status !== "NEW" ||
    typeof order.createdAt !== "string" ||
    typeof amounts.currency !== "string" ||
    typeof amounts.subtotal !== "string" ||
    typeof amounts.serviceCharge !== "string" ||
    typeof amounts.tax !== "string" ||
    typeof amounts.total !== "string"
  ) return null;

  const items: CreatedOrderItemResult[] = [];
  for (const item of value.items) {
    if (
      !isObject(item) ||
      typeof item.productId !== "string" ||
      typeof item.productName !== "string" ||
      typeof item.unitPrice !== "string" ||
      typeof item.quantity !== "number" ||
      typeof item.lineTotal !== "string" ||
      !(typeof item.note === "string" || item.note === null)
    ) return null;
    items.push({
      productId: item.productId,
      productName: item.productName,
      unitPrice: item.unitPrice,
      quantity: item.quantity,
      lineTotal: item.lineTotal,
      note: item.note,
    });
  }

  // Replays stored before orders carried a channel are all dine-in, which is
  // what the database backfilled them to.
  const channel = ORDER_CHANNELS.includes(order.channel as OrderChannel)
    ? (order.channel as OrderChannel)
    : "DINE_IN";

  return {
    order: {
      id: order.id,
      restaurantId: order.restaurantId,
      channel,
      tableId: order.tableId,
      orderNumber: order.orderNumber,
      status: "NEW",
      createdAt: order.createdAt,
    },
    amounts: {
      currency: amounts.currency,
      subtotal: amounts.subtotal,
      serviceCharge: amounts.serviceCharge,
      tax: amounts.tax,
      total: amounts.total,
    },
    items,
    replayed: true,
  };
}

function jsonOrderResult(result: CreateOrderResult): RepositoryJsonObject {
  return {
    order: {
      id: result.order.id,
      restaurantId: result.order.restaurantId,
      tableId: result.order.tableId,
      orderNumber: result.order.orderNumber,
      status: result.order.status,
      createdAt: result.order.createdAt,
    },
    amounts: {
      currency: result.amounts.currency,
      subtotal: result.amounts.subtotal,
      serviceCharge: result.amounts.serviceCharge,
      tax: result.amounts.tax,
      total: result.amounts.total,
    },
    items: result.items.map((item) => ({ ...item })),
  };
}

function requireStatusPrincipal(
  principal: RestaurantPrincipal | null | undefined,
  restaurantId: string,
): RestaurantPrincipal {
  const decision = authorizeRestaurantAccess(principal, restaurantId);
  if (decision.allowed) return decision.principal;
  if (decision.reason === "AUTHENTICATION_REQUIRED") {
    throw new DomainError("AUTHENTICATION_REQUIRED", "Oturum açmanız gerekiyor.", {
      httpStatus: 401,
    });
  }
  if (decision.reason === "ACCOUNT_INACTIVE") {
    throw new DomainError("ACCOUNT_INACTIVE", "Hesap aktif degil.", { httpStatus: 403 });
  }
  if (decision.reason === "RESTAURANT_SCOPE_MISMATCH") {
    throw new DomainError("RESTAURANT_SCOPE_VIOLATION", "Restoran erisimi reddedildi.", {
      httpStatus: 403,
    });
  }
  throw new DomainError("FORBIDDEN", "Bu işlem için yetkiniz yok.", { httpStatus: 403 });
}

export { canRoleTransitionOrderStatus } from "../domain/status";

export class OrderService {
  private readonly clock: () => Date;
  private readonly idempotencyTtlMs: number;
  private readonly idempotencyLockMs: number;

  constructor(
    private readonly repository: OrderRepository,
    options: OrderServiceOptions = {},
  ) {
    this.clock = options.clock ?? (() => new Date());
    this.idempotencyTtlMs = options.idempotencyTtlMs ?? DEFAULT_IDEMPOTENCY_TTL_MS;
    this.idempotencyLockMs = options.idempotencyLockMs ?? DEFAULT_IDEMPOTENCY_LOCK_MS;
  }

  createOrder(command: CreateCustomerOrderCommand): Promise<CreateOrderResult> {
    return this.create({
      ...command,
      channel: "DINE_IN",
      creator: { kind: "CUSTOMER", tableAccessVersion: command.tableAccessVersion, sessionNonce: command.sessionNonce },
    });
  }

  /**
   * A takeaway or courier order placed from the public page.
   *
   * The same method underneath as every other order: the same pricing read
   * from the catalogue, the same totals, the same idempotency, the same
   * events. What differs is the door it came in through, and the delivery
   * details that travel with it.
   */
  // `async` so a rejected channel arrives as a rejected promise like every
  // other failure here, rather than as a synchronous throw the caller misses.
  async createGuestOrder(command: CreateGuestOrderCommand): Promise<CreateOrderResult> {
    if (orderRequiresTable(command.channel)) {
      throw new DomainError("VALIDATION_ERROR", "Bu uç yalnızca paket ve kurye siparişi açar.", {
        httpStatus: 400,
      });
    }
    return this.create({
      restaurantId: command.restaurantId,
      channel: command.channel,
      tableId: null,
      idempotencyKey: command.idempotencyKey,
      items: command.items,
      notes: command.notes,
      creator: { kind: "GUEST" },
      requestId: command.requestId,
      fulfillment: command.fulfillment,
    });
  }

  /**
   * Same transaction, pricing and idempotency path as the guest order; only the
   * creator and the session preconditions differ.
   */
  async createStaffOrder(
    principal: RestaurantPrincipal | null | undefined,
    command: CreateStaffOrderCommand,
  ): Promise<CreateOrderResult> {
    const actor = requireStatusPrincipal(principal, principal?.restaurantId ?? "");
    if (!ORDER_CREATOR_ROLES.includes(actor.role as (typeof ORDER_CREATOR_ROLES)[number])) {
      throw new DomainError("FORBIDDEN", "Sipariş açma yetkiniz yok.", { httpStatus: 403 });
    }
    return this.create({
      restaurantId: actor.restaurantId,
      channel: "DINE_IN",
      tableId: command.tableId,
      idempotencyKey: command.idempotencyKey,
      items: command.items,
      notes: command.notes,
      creator: { kind: "STAFF", staffUserId: actor.userId },
      requestId: command.requestId,
    });
  }

  private async create(command: CreateOrderCommand): Promise<CreateOrderResult> {
    const normalizedItems = validateBasicCommand(command);
    const normalizedOrderNotes = normalizedNote(command.notes, 1_000);
    const staffCreator = command.creator.kind === "STAFF" ? command.creator : null;
    const requestMaterial = createIdempotencyFingerprint({
      restaurantId: command.restaurantId,
      // The channel and the delivery details are part of what makes a request
      // the same request: reusing a key for a different address must be a
      // conflict, not a silent replay of the first one.
      channel: command.channel,
      tableId: command.tableId,
      tableAccessVersion:
        command.creator.kind === "CUSTOMER" ? command.creator.tableAccessVersion : 0,
      // The sitting is part of what makes a request the same request. Two
      // parties at one table share a `CUSTOMER_ORDER:<tableId>` scope, so
      // without this the second one reusing the first one's key would be
      // handed the first one's order back as a replay — someone else's order
      // number and total. With it that is an IDEMPOTENCY_CONFLICT instead.
      // Hashed before storage, so the nonce itself is never persisted.
      sessionNonce:
        command.creator.kind === "CUSTOMER" ? command.creator.sessionNonce : null,
      staffUserId: staffCreator?.staffUserId ?? null,
      fulfillment: command.fulfillment
        ? {
            customerName: command.fulfillment.customerName.trim(),
            contact: command.fulfillment.contact.trim(),
            address: command.fulfillment.address?.trim() || null,
          }
        : null,
      items: normalizedItems,
      notes: normalizedOrderNotes,
    });
    const requestHash = sha256(requestMaterial);
    const keyHash = sha256(command.idempotencyKey);
    const scope = `${
      staffCreator ? CREATE_STAFF_ORDER_SCOPE_PREFIX : CREATE_ORDER_SCOPE_PREFIX
    }:${command.tableId}`;

    return this.repository.transaction(async (transaction) => {
      const now = this.clock();
      if (Number.isNaN(now.getTime())) throw internalError();
      const lockedUntil = new Date(now.getTime() + this.idempotencyLockMs);
      const expiresAt = new Date(now.getTime() + this.idempotencyTtlMs);
      const claimInput = {
        restaurantId: command.restaurantId,
        scope,
        keyHash,
        requestHash,
        now,
        lockedUntil,
        expiresAt,
      };
      const claim = await transaction.claimIdempotency(claimInput);
      let idempotencyId: string;
      if (claim.acquired) {
        idempotencyId = claim.id;
      } else {
        const existing = claim.record;
        if (existing.expiresAt <= now) {
          await transaction.restartIdempotency({ ...claimInput, id: existing.id });
          idempotencyId = existing.id;
        } else if (existing.requestHash !== requestHash) {
          throw new DomainError(
            "IDEMPOTENCY_CONFLICT",
            "Bu istek anahtarı farklı bir sipariş için kullanıldı.",
            { httpStatus: 409 },
          );
        } else if (existing.status === "COMPLETED") {
          const replay = storedOrderResult(existing.responseBody);
          if (!replay) throw internalError();
          return replay;
        } else if (
          existing.status === "PROCESSING" &&
          existing.lockedUntil &&
          existing.lockedUntil > now
        ) {
          throw new DomainError("IDEMPOTENCY_IN_FLIGHT", "Siparis istegi isleniyor.", {
            httpStatus: 409,
            details: {
              retryAfterMs: Math.max(0, existing.lockedUntil.getTime() - now.getTime()),
            },
          });
        } else {
          await transaction.restartIdempotency({ ...claimInput, id: existing.id });
          idempotencyId = existing.id;
        }
      }

      // The table/settings lookup and the product lookup do not depend on each
      // other, so they travel as one pipelined round trip rather than two.
      const productIds = [...new Set(normalizedItems.map((item) => item.productId))];
      const [contextRecord, productRecords] = await Promise.all([
        transaction.findOrderContext(command.restaurantId, command.tableId),
        transaction.findOrderProducts(command.restaurantId, productIds),
      ]);
      const context = requireUsableContext(contextRecord, command.creator, command.channel);
      if (!staffCreator && normalizedOrderNotes && !context.customerNotesEnabled) {
        throw new DomainError("VALIDATION_ERROR", "Siparis notlari kapali.", {
          httpStatus: 400,
        });
      }
      if (normalizedOrderNotes && normalizedOrderNotes.length > context.orderNotesMaxLength) {
        throw new DomainError(
          "VALIDATION_ERROR",
          `Siparis notu en fazla ${context.orderNotesMaxLength} karakter olabilir.`,
          { httpStatus: 400 },
        );
      }
      for (const item of normalizedItems) {
        if (staffCreator) continue;
        if (item.quantity > context.maxItemQuantity) {
          throw new DomainError(
            "VALIDATION_ERROR",
            `Bir üründen en fazla ${context.maxItemQuantity} adet sipariş edilebilir.`,
            { httpStatus: 400 },
          );
        }
        if (item.note && !context.customerNotesEnabled) {
          throw new DomainError("VALIDATION_ERROR", "Urun notlari kapali.", {
            httpStatus: 400,
          });
        }
      }

      const products = mapProducts(productIds, productRecords, command.restaurantId);

      const calculatedItems = normalizedItems.map((item) => {
        const product = products.get(item.productId);
        if (!product) throw internalError();
        const unitPriceMinor = decimalToMinor(product.price);
        const lineTotalMinor = multiplyMoney(unitPriceMinor, item.quantity);
        return { item, product, unitPriceMinor, lineTotalMinor };
      });
      const subtotalMinor = addMoney(...calculatedItems.map((item) => item.lineTotalMinor));
      const serviceChargeMinor = applyBasisPoints(
        subtotalMinor,
        percentageToBasisPoints(context.serviceFeeRate),
      );
      const taxBaseMinor = addMoney(subtotalMinor, serviceChargeMinor);
      const taxMinor = applyBasisPoints(
        taxBaseMinor,
        percentageToBasisPoints(context.taxRate),
      );
      const totalMinor = addMoney(taxBaseMinor, taxMinor);

      const sequence = await transaction.allocateOrderSequence(command.restaurantId);
      const orderNumber = `ORD-${sequence.toString().padStart(6, "0")}`;
      const inserted = await transaction.insertOrder({
        restaurantId: command.restaurantId,
        channel: command.channel,
        tableId: command.tableId,
        orderSequence: sequence,
        orderNumber,
        status: "NEW",
        subtotal: minorToDecimal(subtotalMinor),
        serviceChargeTotal: minorToDecimal(serviceChargeMinor),
        taxTotal: minorToDecimal(taxMinor),
        total: minorToDecimal(totalMinor),
        serviceFeeRate: context.serviceFeeRate,
        taxRate: context.taxRate,
        notes: normalizedOrderNotes,
        createdByType: staffCreator ? "STAFF" : "CUSTOMER",
        createdByUserId: staffCreator?.staffUserId ?? null,
        // Only a table sitting owns an order this way. Staff orders and the
        // takeaway/courier channels stay null, which is what keeps the
        // customer read failing closed for them.
        customerSessionNonce:
          command.creator.kind === "CUSTOMER" ? command.creator.sessionNonce : null,
      });
      const eventPayload: RepositoryJsonObject = {
        orderId: inserted.id,
        orderNumber,
        tableId: command.tableId,
        tableNumber: context.tableNumber,
        status: "NEW",
        total: minorToDecimal(totalMinor),
        currency: context.currency,
        createdBy: staffCreator ? "STAFF" : "CUSTOMER",
      };

      const result: CreateOrderResult = {
        order: {
          id: inserted.id,
          restaurantId: command.restaurantId,
          channel: command.channel,
          tableId: command.tableId,
          orderNumber,
          status: "NEW",
          createdAt: now.toISOString(),
        },
        amounts: {
          currency: context.currency,
          subtotal: minorToDecimal(subtotalMinor),
          serviceCharge: minorToDecimal(serviceChargeMinor),
          tax: minorToDecimal(taxMinor),
          total: minorToDecimal(totalMinor),
        },
        items: calculatedItems.map(({ item, product, unitPriceMinor, lineTotalMinor }) => ({
          productId: product.id,
          productName: product.name,
          unitPrice: minorToDecimal(unitPriceMinor),
          quantity: item.quantity,
          lineTotal: minorToDecimal(lineTotalMinor),
          note: item.note,
        })),
        replayed: false,
      };

      // Everything below hangs off the inserted order and nothing below reads
      // anything else below, so the writes go out as one pipelined round trip
      // instead of six. They are still inside the same transaction and still
      // commit or roll back together — only the wire cost changes. The
      // sequence/order insert above stays sequential: the order row cannot
      // exist before its number is allocated, and its id is what these rows
      // reference.
      await Promise.all([
        transaction.insertOrderItems(
          calculatedItems.map(({ item, product, unitPriceMinor, lineTotalMinor }, index) => ({
            restaurantId: command.restaurantId,
            orderId: inserted.id,
            productId: product.id,
            productNameSnapshot: product.name,
            unitPrice: minorToDecimal(unitPriceMinor),
            quantity: item.quantity,
            lineTotal: minorToDecimal(lineTotalMinor),
            notes: item.note,
            sortOrder: index,
          })),
        ),
        command.tableId !== null
          ? transaction.markTableWaiting(command.restaurantId, command.tableId)
          : Promise.resolve(),
        // Same transaction as the order it belongs to, so the pair either both
        // exist or neither does. This is what removes the manual link step
        // from the ordinary customer flow.
        command.channel !== "DINE_IN"
          ? transaction.insertFulfillmentRequest({
              restaurantId: command.restaurantId,
              orderId: inserted.id,
              channel: command.channel,
              ...validateFulfillmentDetails(command),
              idempotencyKey: command.idempotencyKey,
            })
          : Promise.resolve(),
        transaction.insertOrderEvent({
          restaurantId: command.restaurantId,
          orderId: inserted.id,
          eventType: "ORDER_CREATED",
          userId: staffCreator?.staffUserId ?? null,
          payload: eventPayload,
        }),
        transaction.insertOutboxEvent({
          restaurantId: command.restaurantId,
          aggregateType: "ORDER",
          aggregateId: inserted.id,
          eventType: "ORDER_CREATED",
          payload: eventPayload,
        }),
        staffCreator
          ? transaction.insertAuditLog({
              restaurantId: command.restaurantId,
              actorUserId: staffCreator.staffUserId,
              action: "ORDER_CREATED",
              entityType: "ORDER",
              entityId: inserted.id,
              oldValue: {},
              newValue: { status: "NEW", total: minorToDecimal(totalMinor) },
              metadata: { orderNumber, tableId: command.tableId },
              requestId: command.requestId,
            })
          : Promise.resolve(),
        transaction.completeIdempotency({
          id: idempotencyId,
          restaurantId: command.restaurantId,
          scope,
          responseStatus: 201,
          responseBody: jsonOrderResult(result),
          resourceType: "ORDER",
          resourceId: inserted.id,
          completedAt: now,
        }),
      ]);
      return result;
    });
  }

  /**
   * Appends a later round to a running order. The kitchen keeps its item-level
   * lifecycle: existing lines are untouched and the new ones enter as PENDING,
   * so nothing already prepared is silently reset.
   */
  async addItems(
    principal: RestaurantPrincipal | null | undefined,
    command: AddOrderItemsCommand,
  ): Promise<AddOrderItemsResult> {
    const actor = requireStatusPrincipal(principal, principal?.restaurantId ?? "");
    if (!canRoleAddOrderItems(actor.role)) {
      throw new DomainError("FORBIDDEN", "Siparişe ürün ekleme yetkiniz yok.", {
        httpStatus: 403,
      });
    }
    const normalizedItems = validateItems(command.items);
    if (!/^[A-Za-z0-9._:-]{8,128}$/.test(command.idempotencyKey)) {
      throw new DomainError("VALIDATION_ERROR", "Idempotency anahtarı geçersiz.", {
        httpStatus: 400,
      });
    }

    const requestHash = sha256(
      createIdempotencyFingerprint({
        restaurantId: actor.restaurantId,
        orderId: command.orderId,
        items: normalizedItems,
      }),
    );
    const keyHash = sha256(command.idempotencyKey);
    const scope = `${ADD_ITEMS_SCOPE_PREFIX}:${command.orderId}`;

    return this.repository.transaction(async (transaction) => {
      const now = this.clock();
      if (Number.isNaN(now.getTime())) throw internalError();
      const claimInput = {
        restaurantId: actor.restaurantId,
        scope,
        keyHash,
        requestHash,
        now,
        lockedUntil: new Date(now.getTime() + this.idempotencyLockMs),
        expiresAt: new Date(now.getTime() + this.idempotencyTtlMs),
      };
      const claim = await transaction.claimIdempotency(claimInput);
      let idempotencyId: string;
      if (claim.acquired) {
        idempotencyId = claim.id;
      } else {
        const existing = claim.record;
        if (existing.expiresAt <= now) {
          await transaction.restartIdempotency({ ...claimInput, id: existing.id });
          idempotencyId = existing.id;
        } else if (existing.requestHash !== requestHash) {
          throw new DomainError(
            "IDEMPOTENCY_CONFLICT",
            "Bu istek anahtarı farklı bir ekleme için kullanıldı.",
            { httpStatus: 409 },
          );
        } else if (existing.status === "COMPLETED") {
          const replay = storedAddItemsResult(existing.responseBody);
          if (!replay) throw internalError();
          return replay;
        } else if (
          existing.status === "PROCESSING" &&
          existing.lockedUntil &&
          existing.lockedUntil > now
        ) {
          throw new DomainError("IDEMPOTENCY_IN_FLIGHT", "Ekleme isteği işleniyor.", {
            httpStatus: 409,
            details: {
              retryAfterMs: Math.max(0, existing.lockedUntil.getTime() - now.getTime()),
            },
          });
        } else {
          await transaction.restartIdempotency({ ...claimInput, id: existing.id });
          idempotencyId = existing.id;
        }
      }

      const order = await requireMutableOrder(transaction, actor.restaurantId, command.orderId);
      if (!canAddItemsToOrder(order.status)) {
        throw new DomainError(
          "ORDER_NOT_MUTABLE",
          "Bu siparişe artık ürün eklenemez. Masa için yeni bir sipariş açın.",
          { httpStatus: 409, details: { status: order.status } },
        );
      }

      const productIds = [...new Set(normalizedItems.map((item) => item.productId))];
      const products = mapProducts(
        productIds,
        await transaction.findOrderProducts(actor.restaurantId, productIds),
        actor.restaurantId,
      );

      // Prices are read now, so this round is snapshotted at today's price and
      // the lines already on the order keep the price they were sold at.
      const calculated = normalizedItems.map((item) => {
        const product = products.get(item.productId);
        if (!product) throw internalError();
        const unitPriceMinor = decimalToMinor(product.price);
        return {
          item,
          product,
          unitPriceMinor,
          lineTotalMinor: multiplyMoney(unitPriceMinor, item.quantity),
        };
      });

      const nextSortOrder =
        order.items.reduce((highest, line) => Math.max(highest, line.sortOrder), -1) + 1;
      await transaction.insertOrderItems(
        calculated.map(({ item, product, unitPriceMinor, lineTotalMinor }, index) => ({
          restaurantId: actor.restaurantId,
          orderId: order.id,
          productId: product.id,
          productNameSnapshot: product.name,
          unitPrice: minorToDecimal(unitPriceMinor),
          quantity: item.quantity,
          lineTotal: minorToDecimal(lineTotalMinor),
          notes: item.note,
          sortOrder: nextSortOrder + index,
        })),
      );

      const amounts = recalculate(order, [
        ...calculated.map(({ lineTotalMinor }) => ({ lineTotalMinor, cancelled: false })),
      ]);
      await applyAmounts(transaction, actor.restaurantId, order, amounts, now);

      const payload: RepositoryJsonObject = {
        orderId: order.id,
        orderNumber: order.orderNumber,
        tableId: order.tableId,
        status: order.status,
        addedItemCount: calculated.length,
        total: amounts.total,
        currency: order.currency,
        version: order.version + 1,
        updatedAt: now.toISOString(),
      };
      await transaction.insertOrderEvent({
        restaurantId: actor.restaurantId,
        orderId: order.id,
        eventType: "ORDER_ITEMS_ADDED",
        userId: actor.userId,
        payload,
      });
      await transaction.insertOutboxEvent({
        restaurantId: actor.restaurantId,
        aggregateType: "ORDER",
        aggregateId: order.id,
        eventType: "ORDER_ITEMS_ADDED",
        payload,
      });
      // The pass gets a ticket for the *new* lines only; the earlier round has
      // already been cooked. Queued in this transaction, so it cannot be lost,
      // and never a reason for the addition to fail.
      await transaction.enqueueKitchenPrint({
        restaurantId: actor.restaurantId,
        orderId: order.id,
        kind: "ADDITION",
        occurrence: `add:${keyHash}`,
        lines: calculated.map(({ item, product }) => ({
          productId: product.id,
          productName: product.name,
          quantity: item.quantity,
          note: item.note ?? null,
        })),
      });
      await transaction.insertAuditLog({
        restaurantId: actor.restaurantId,
        actorUserId: actor.userId,
        action: "staff.order.items_added",
        entityType: "ORDER",
        entityId: order.id,
        oldValue: { subtotal: order.subtotal, total: order.total },
        newValue: { subtotal: amounts.subtotal, total: amounts.total },
        metadata: {
          orderNumber: order.orderNumber,
          tableId: order.tableId,
          addedItems: calculated.map(({ item, product, unitPriceMinor }) => ({
            productId: product.id,
            productName: product.name,
            quantity: item.quantity,
            unitPrice: minorToDecimal(unitPriceMinor),
          })),
        },
        requestId: command.requestId,
      });

      const result: AddOrderItemsResult = {
        orderId: order.id,
        orderNumber: order.orderNumber,
        status: order.status,
        addedItems: calculated.map(({ item, product, unitPriceMinor, lineTotalMinor }) => ({
          productId: product.id,
          productName: product.name,
          unitPrice: minorToDecimal(unitPriceMinor),
          quantity: item.quantity,
          lineTotal: minorToDecimal(lineTotalMinor),
          note: item.note,
        })),
        amounts: { ...amounts, currency: order.currency },
        replayed: false,
      };
      await transaction.completeIdempotency({
        id: idempotencyId,
        restaurantId: actor.restaurantId,
        scope,
        responseStatus: 201,
        responseBody: jsonAddItemsResult(result),
        resourceType: "ORDER",
        resourceId: order.id,
        completedAt: now,
      });
      return result;
    });
  }

  /**
   * Soft-cancels one line. The row is kept so the cancellation stays auditable;
   * only the order money is recalculated.
   */
  async cancelItem(
    principal: RestaurantPrincipal | null | undefined,
    command: CancelOrderItemCommand,
  ): Promise<CancelOrderItemResult> {
    const actor = requireStatusPrincipal(principal, principal?.restaurantId ?? "");
    const reason = normalizedCancellationReason(command.reason, command.reasonNote);

    return this.repository.transaction(async (transaction) => {
      const order = await requireMutableOrder(transaction, actor.restaurantId, command.orderId);
      const item = order.items.find((line) => line.id === command.orderItemId);
      if (!item) {
        throw new DomainError("ORDER_ITEM_NOT_FOUND", "Sipariş kalemi bulunamadı.", {
          httpStatus: 404,
        });
      }
      if (item.status === "CANCELLED") {
        throw new DomainError("ORDER_ITEM_ALREADY_CANCELLED", "Bu kalem zaten iptal edilmiş.", {
          httpStatus: 409,
        });
      }
      if (order.status === "COMPLETED" || order.hasSettledPayment) {
        throw new DomainError(
          "ORDER_ALREADY_COMPLETED",
          "Ödemesi alınmış sipariş bu yolla değiştirilemez.",
          { httpStatus: 409 },
        );
      }
      if (order.status === "CANCELLED") {
        throw new DomainError("ORDER_NOT_MUTABLE", "İptal edilmiş sipariş değiştirilemez.", {
          httpStatus: 409,
        });
      }
      if (rolesAllowedToCancelItem(item.status).length === 0) {
        throw new DomainError(
          "ITEM_CANNOT_BE_CANCELLED",
          "Servis edilmiş kalem iptal edilemez; iade süreci gerekir.",
          { httpStatus: 409, details: { status: item.status } },
        );
      }
      if (!canRoleCancelOrderItem(actor.role, item.status)) {
        throw new DomainError("FORBIDDEN", "Bu aşamadaki kalemi iptal etme yetkiniz yok.", {
          httpStatus: 403,
          details: { status: item.status },
        });
      }

      const now = this.clock();
      const cancelled = await transaction.cancelOrderItem({
        restaurantId: actor.restaurantId,
        orderItemId: item.id,
        currentStatus: item.status,
        at: now,
      });
      if (!cancelled) {
        throw new DomainError("CONFLICT", "Sipariş kalemi başka bir işlem tarafından güncellendi.", {
          httpStatus: 409,
        });
      }

      const amounts = recalculate(order, [], item.id);
      await applyAmounts(transaction, actor.restaurantId, order, amounts, now);

      const payload: RepositoryJsonObject = {
        scope: "ORDER_ITEM",
        orderId: order.id,
        orderNumber: order.orderNumber,
        tableId: order.tableId,
        orderItemId: item.id,
        productName: item.productNameSnapshot,
        previousStatus: item.status,
        status: "CANCELLED",
        total: amounts.total,
        currency: order.currency,
        version: order.version + 1,
        updatedAt: now.toISOString(),
      };
      await transaction.insertOrderEvent({
        restaurantId: actor.restaurantId,
        orderId: order.id,
        eventType: "ORDER_ITEM_CANCELLED",
        userId: actor.userId,
        payload,
      });
      await transaction.insertOutboxEvent({
        restaurantId: actor.restaurantId,
        aggregateType: "ORDER_ITEM",
        aggregateId: item.id,
        eventType: "ORDER_ITEM_CANCELLED",
        payload,
      });
      // The kitchen may already be cooking it, so the pass is told on paper.
      // One ticket per cancelled line, whatever happens downstream.
      await transaction.enqueueKitchenPrint({
        restaurantId: actor.restaurantId,
        orderId: order.id,
        kind: "CANCEL",
        occurrence: `cancel:${item.id}`,
        lines: [
          {
            productId: item.productId,
            productName: item.productNameSnapshot,
            quantity: item.quantity,
            note: null,
          },
        ],
        reason: command.reason ?? null,
      });
      await transaction.insertAuditLog({
        restaurantId: actor.restaurantId,
        actorUserId: actor.userId,
        action: "order.item.cancelled",
        entityType: "ORDER_ITEM",
        entityId: item.id,
        oldValue: { status: item.status, lineTotal: item.lineTotal },
        newValue: { status: "CANCELLED" },
        metadata: {
          orderId: order.id,
          orderNumber: order.orderNumber,
          productName: item.productNameSnapshot,
          reason: reason.reason,
          reasonNote: reason.note,
          totalBefore: order.total,
          totalAfter: amounts.total,
        },
        requestId: command.requestId,
      });

      return {
        orderId: order.id,
        orderItemId: item.id,
        previousStatus: item.status,
        status: "CANCELLED",
        amounts: { ...amounts, currency: order.currency },
        updatedAt: now.toISOString(),
      };
    });
  }

  /**
   * Writes a served line off an unsettled bill. This is not a cancellation: the
   * food reached the guest and the line stays on the order as VOIDED with who
   * did it and why, which is what the void report is built from. Once money has
   * been collected the correction is a refund, not a void.
   */
  async voidItem(
    principal: RestaurantPrincipal | null | undefined,
    command: VoidOrderItemCommand,
  ): Promise<CancelOrderItemResult> {
    const actor = requireStatusPrincipal(principal, principal?.restaurantId ?? "");
    if (!canRoleVoidItem(actor.role)) {
      throw new DomainError("FORBIDDEN", "Hesaptan çıkarma yetkiniz yok.", { httpStatus: 403 });
    }
    const reason = normalizedFinancialReason(
      command.reasonCode,
      command.note,
      VOID_REASON_CODES,
      "Hesaptan çıkarma nedeni",
    );

    return this.repository.transaction(async (transaction) => {
      const order = await requireMutableOrder(transaction, actor.restaurantId, command.orderId);
      const item = order.items.find((line) => line.id === command.orderItemId);
      if (!item) {
        throw new DomainError("ORDER_ITEM_NOT_FOUND", "Sipariş kalemi bulunamadı.", {
          httpStatus: 404,
        });
      }
      if (item.status === "VOIDED") {
        throw new DomainError(
          "ORDER_ITEM_ALREADY_VOIDED",
          "Bu kalem zaten hesaptan çıkarılmış.",
          { httpStatus: 409 },
        );
      }
      // Money already taken cannot be corrected by editing the bill.
      if (order.hasSettledPayment || order.status === "COMPLETED") {
        throw new DomainError(
          "PAYMENT_ALREADY_COMPLETED",
          "Bu siparişin ödemesi alınmış. İade işlemini kullanın.",
          { httpStatus: 409 },
        );
      }
      if (!isItemVoidable(item.status)) {
        throw new DomainError(
          "ITEM_CANNOT_BE_VOIDED",
          "Yalnız servis edilmiş kalem hesaptan çıkarılabilir; diğerleri iptal edilir.",
          { httpStatus: 409, details: { status: item.status } },
        );
      }

      const now = this.clock();
      const voided = await transaction.voidOrderItem({
        restaurantId: actor.restaurantId,
        orderItemId: item.id,
        currentStatus: item.status,
        voidedBy: actor.userId,
        reasonCode: reason.code,
        at: now,
      });
      if (!voided) {
        throw new DomainError("CONFLICT", "Sipariş kalemi başka bir işlem tarafından güncellendi.", {
          httpStatus: 409,
        });
      }

      const amounts = recalculate(order, [], item.id);
      await applyAmounts(transaction, actor.restaurantId, order, amounts, now);

      const payload: RepositoryJsonObject = {
        scope: "ORDER_ITEM",
        orderId: order.id,
        orderNumber: order.orderNumber,
        tableId: order.tableId,
        orderItemId: item.id,
        productName: item.productNameSnapshot,
        previousStatus: item.status,
        status: "VOIDED",
        total: amounts.total,
        currency: order.currency,
        version: order.version + 1,
        updatedAt: now.toISOString(),
      };
      await transaction.insertOrderEvent({
        restaurantId: actor.restaurantId,
        orderId: order.id,
        eventType: "ORDER_ITEM_VOIDED",
        userId: actor.userId,
        payload,
      });
      await transaction.insertOutboxEvent({
        restaurantId: actor.restaurantId,
        aggregateType: "ORDER_ITEM",
        aggregateId: item.id,
        eventType: "ORDER_ITEM_VOIDED",
        payload,
      });
      await transaction.insertAuditLog({
        restaurantId: actor.restaurantId,
        actorUserId: actor.userId,
        action: "order.item.voided",
        entityType: "ORDER_ITEM",
        entityId: item.id,
        oldValue: { status: item.status, lineTotal: item.lineTotal },
        newValue: { status: "VOIDED" },
        metadata: {
          orderId: order.id,
          orderNumber: order.orderNumber,
          productName: item.productNameSnapshot,
          quantity: item.quantity,
          amount: item.lineTotal,
          reasonCode: reason.code,
          note: reason.note,
          totalBefore: order.total,
          totalAfter: amounts.total,
        },
        requestId: command.requestId,
      });

      return {
        orderId: order.id,
        orderItemId: item.id,
        previousStatus: item.status,
        status: "VOIDED",
        amounts: { ...amounts, currency: order.currency },
        updatedAt: now.toISOString(),
      };
    });
  }

  /** Cancels a whole order that has not been served or paid. */
  async cancelOrder(
    principal: RestaurantPrincipal | null | undefined,
    command: CancelOrderCommand,
  ): Promise<UpdateOrderStatusResult> {
    const actor = requireStatusPrincipal(principal, principal?.restaurantId ?? "");
    if (!canRoleCancelOrder(actor.role)) {
      throw new DomainError("FORBIDDEN", "Sipariş iptal etme yetkiniz yok.", { httpStatus: 403 });
    }
    const reason = normalizedCancellationReason(command.reason, command.reasonNote);

    return this.repository.transaction(async (transaction) => {
      const order = await requireMutableOrder(transaction, actor.restaurantId, command.orderId);
      if (order.status === "COMPLETED" || order.hasSettledPayment) {
        throw new DomainError(
          "ORDER_ALREADY_COMPLETED",
          "Ödemesi alınmış sipariş iptal edilemez; iade süreci gerekir.",
          { httpStatus: 409 },
        );
      }
      if (order.hasPendingPayment) {
        throw new DomainError(
          "CONFLICT",
          "Bu siparişte bekleyen bir ödeme var; önce ödemeyi sonuçlandırın.",
          { httpStatus: 409 },
        );
      }
      if (!isOrderCancellable(order.status)) {
        throw new DomainError(
          "INVALID_STATUS_TRANSITION",
          "Bu sipariş bu aşamada iptal edilemez.",
          { httpStatus: 409, details: { status: order.status } },
        );
      }

      const now = this.clock();
      const updated = await transaction.updateOrderStatus({
        restaurantId: actor.restaurantId,
        orderId: order.id,
        currentStatus: order.status,
        nextStatus: "CANCELLED",
        currentVersion: order.version,
        at: now,
      });
      if (!updated) {
        throw new DomainError("CONFLICT", "Sipariş başka bir işlem tarafından güncellendi.", {
          httpStatus: 409,
        });
      }

      const payload: RepositoryJsonObject = {
        orderId: order.id,
        orderNumber: order.orderNumber,
        tableId: order.tableId,
        previousStatus: order.status,
        status: "CANCELLED",
        total: order.total,
        currency: order.currency,
        version: order.version + 1,
        updatedAt: now.toISOString(),
      };
      await transaction.insertOrderEvent({
        restaurantId: actor.restaurantId,
        orderId: order.id,
        eventType: "ORDER_CANCELLED",
        userId: actor.userId,
        payload,
      });
      await transaction.insertOutboxEvent({
        restaurantId: actor.restaurantId,
        aggregateType: "ORDER",
        aggregateId: order.id,
        eventType: "ORDER_CANCELLED",
        payload,
      });
      await transaction.insertAuditLog({
        restaurantId: actor.restaurantId,
        actorUserId: actor.userId,
        action: "order.cancelled",
        entityType: "ORDER",
        entityId: order.id,
        oldValue: { status: order.status, version: order.version },
        newValue: { status: "CANCELLED", version: order.version + 1 },
        metadata: {
          orderNumber: order.orderNumber,
          tableId: order.tableId,
          reason: reason.reason,
          reasonNote: reason.note,
        },
        requestId: command.requestId,
      });

      return {
        orderId: order.id,
        orderNumber: order.orderNumber,
        previousStatus: order.status,
        status: "CANCELLED",
        version: order.version + 1,
        updatedAt: now.toISOString(),
      };
    });
  }

  async updateStatus(
    principal: RestaurantPrincipal | null | undefined,
    command: UpdateOrderStatusCommand,
  ): Promise<UpdateOrderStatusResult> {
    const actor = requireStatusPrincipal(principal, command.restaurantId);
    return this.repository.transaction(async (transaction) => {
      const order = await transaction.findOrderForUpdate(command.restaurantId, command.orderId);
      if (!order) {
        throw new DomainError("ORDER_NOT_FOUND", "Sipariş bulunamadı.", {
          httpStatus: 404,
        });
      }
      const transition = validateStatusTransition(
        ORDER_STATUS_TRANSITIONS,
        order.status,
        command.nextStatus,
      );
      if (!transition.valid) {
        throw new DomainError("INVALID_STATUS_TRANSITION", "Siparis durumu degistirilemez.", {
          httpStatus: 409,
          details: {
            current: transition.current,
            requested: transition.next,
            allowed: [...transition.allowed],
            reason: transition.reason,
          },
        });
      }
      if (!canRoleTransitionOrderStatus(actor.role, order.status, command.nextStatus)) {
        throw new DomainError("FORBIDDEN", "Bu durum değişikliği için yetkiniz yok.", {
          httpStatus: 403,
        });
      }

      const at = this.clock();
      const updated = await transaction.updateOrderStatus({
        restaurantId: command.restaurantId,
        orderId: order.id,
        currentStatus: order.status,
        nextStatus: command.nextStatus,
        currentVersion: order.version,
        at,
      });
      if (!updated) {
        throw new DomainError("CONFLICT", "Sipariş başka bir işlem tarafından güncellendi.", {
          httpStatus: 409,
        });
      }

      const eventType = STATUS_EVENTS[command.nextStatus];
      const payload: RepositoryJsonObject = {
        orderId: order.id,
        orderNumber: order.orderNumber,
        tableId: order.tableId,
        previousStatus: order.status,
        status: command.nextStatus,
        version: order.version + 1,
        updatedAt: at.toISOString(),
      };
      await transaction.insertOrderEvent({
        restaurantId: command.restaurantId,
        orderId: order.id,
        eventType,
        userId: actor.userId,
        payload,
      });
      await transaction.insertOutboxEvent({
        restaurantId: command.restaurantId,
        aggregateType: "ORDER",
        aggregateId: order.id,
        eventType,
        payload,
      });
      if (command.nextStatus === "CONFIRMED") {
        // Confirmation is the moment the kitchen is told. The occurrence is
        // fixed, so a repeated confirmation cannot produce a second original
        // ticket at the pass.
        await transaction.enqueueKitchenPrint({
          restaurantId: command.restaurantId,
          orderId: order.id,
          kind: "NEW",
          occurrence: "confirm",
        });
      }
      await transaction.insertAuditLog({
        restaurantId: command.restaurantId,
        actorUserId: actor.userId,
        action: "ORDER_STATUS_CHANGED",
        entityType: "ORDER",
        entityId: order.id,
        oldValue: { status: order.status, version: order.version },
        newValue: { status: command.nextStatus, version: order.version + 1 },
        metadata: { orderNumber: order.orderNumber, tableId: order.tableId },
        requestId: command.requestId,
      });

      return {
        orderId: order.id,
        orderNumber: order.orderNumber,
        previousStatus: order.status,
        status: command.nextStatus,
        version: order.version + 1,
        updatedAt: at.toISOString(),
      };
    });
  }
}
