import type { CurrencyCode, MoneyMinor } from "./money";
import type {
  OrderEventType,
  OrderItemStatus,
  OrderStatus,
  KitchenTicketStatus,
  PaymentMethod,
  PaymentStatus,
  TableStatus,
  UserRole,
  WaiterCallStatus,
  WaiterCallType,
} from "./status";

export type EntityId = string;
export type IsoDateTime = string;

export interface TimestampedEntity {
  readonly createdAt: IsoDateTime;
  readonly updatedAt: IsoDateTime;
}

export interface RestaurantScopedEntity {
  readonly restaurantId: EntityId;
}

export interface Restaurant extends TimestampedEntity {
  readonly id: EntityId;
  readonly name: string;
  readonly slug: string;
  readonly logoUrl: string | null;
  readonly phone: string | null;
  readonly address: string | null;
  readonly currency: CurrencyCode;
  readonly timezone: string;
  readonly defaultLocale: string;
  readonly isActive: boolean;
}

export interface StaffProfile extends RestaurantScopedEntity, TimestampedEntity {
  readonly id: EntityId;
  readonly authUserId: EntityId | null;
  readonly name: string;
  readonly email: string | null;
  readonly phone: string | null;
  readonly role: UserRole;
  readonly isActive: boolean;
  readonly deletedAt: IsoDateTime | null;
}

/** @deprecated Prefer StaffProfile; authentication identity belongs to Supabase Auth. */
export type User = StaffProfile;

export interface Category extends RestaurantScopedEntity, TimestampedEntity {
  readonly id: EntityId;
  readonly name: string;
  readonly slug: string;
  readonly description: string | null;
  readonly imageUrl: string | null;
  readonly sortOrder: number;
  readonly isActive: boolean;
  readonly deletedAt: IsoDateTime | null;
}

export interface Product extends RestaurantScopedEntity, TimestampedEntity {
  readonly id: EntityId;
  readonly categoryId: EntityId;
  readonly name: string;
  readonly slug: string;
  readonly description: string | null;
  /** Exact database/API amount in the restaurant currency's minor unit. */
  readonly priceMinor: MoneyMinor;
  readonly imageUrl: string | null;
  readonly weightLabel: string | null;
  readonly isAvailable: boolean;
  readonly isFeatured: boolean;
  readonly isSpicy: boolean;
  readonly isVegetarian: boolean;
  readonly allergens: readonly string[];
  readonly tags: readonly string[];
  readonly sortOrder: number;
  readonly version: number;
  readonly isActive: boolean;
  readonly deletedAt: IsoDateTime | null;
}

export interface RestaurantTable extends RestaurantScopedEntity, TimestampedEntity {
  readonly id: EntityId;
  readonly name: string;
  readonly tableNumber: number;
  readonly seats: number;
  /** A stored hash is preferred; raw QR tokens must never be logged. */
  readonly qrTokenHash: string;
  readonly qrTokenVersion: number;
  readonly qrTokenRotatedAt: IsoDateTime;
  readonly qrTokenRevokedAt: IsoDateTime | null;
  readonly isActive: boolean;
  readonly currentStatus: TableStatus;
}

export const ORDER_CREATOR_TYPES = ["CUSTOMER", "STAFF", "SYSTEM"] as const;
export type OrderCreatorType = (typeof ORDER_CREATOR_TYPES)[number];

export interface Order extends RestaurantScopedEntity, TimestampedEntity {
  readonly id: EntityId;
  readonly tableId: EntityId;
  readonly orderNumber: string;
  readonly status: OrderStatus;
  readonly subtotalMinor: MoneyMinor;
  readonly totalMinor: MoneyMinor;
  readonly currency: CurrencyCode;
  readonly notes: string | null;
  readonly createdByType: OrderCreatorType;
  readonly createdByUserId: EntityId | null;
  readonly closedAt: IsoDateTime | null;
}

export interface OrderItem extends RestaurantScopedEntity, TimestampedEntity {
  readonly id: EntityId;
  readonly orderId: EntityId;
  readonly productId: EntityId;
  /** Immutable snapshots captured inside the order transaction. */
  readonly productNameSnapshot: string;
  readonly unitPriceMinor: MoneyMinor;
  readonly quantity: number;
  readonly lineTotalMinor: MoneyMinor;
  readonly notes: string | null;
  readonly status: OrderItemStatus;
  readonly sortOrder: number;
  readonly cancelledAt: IsoDateTime | null;
}

export interface KitchenTicket extends RestaurantScopedEntity, TimestampedEntity {
  readonly id: EntityId;
  readonly orderId: EntityId;
  readonly status: KitchenTicketStatus;
  readonly priority: number;
  readonly notes: string | null;
  readonly preparationStartedAt: IsoDateTime | null;
  readonly readyAt: IsoDateTime | null;
  readonly closedAt: IsoDateTime | null;
}

export interface WaiterCall extends RestaurantScopedEntity {
  readonly id: EntityId;
  readonly tableId: EntityId;
  readonly type: WaiterCallType;
  readonly requestLabel: string | null;
  readonly status: WaiterCallStatus;
  readonly notes: string | null;
  readonly tableTokenVersion: number;
  readonly createdAt: IsoDateTime;
  readonly acknowledgedAt: IsoDateTime | null;
  readonly acknowledgedBy: EntityId | null;
  readonly resolvedAt: IsoDateTime | null;
  readonly resolvedBy: EntityId | null;
  readonly updatedAt: IsoDateTime;
}

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };

export interface OrderEvent extends RestaurantScopedEntity {
  readonly id: EntityId;
  readonly orderId: EntityId;
  readonly eventType: OrderEventType;
  readonly userId: EntityId | null;
  readonly payload: JsonValue;
  readonly processedAt: IsoDateTime | null;
  readonly createdAt: IsoDateTime;
}

export interface Payment extends RestaurantScopedEntity, TimestampedEntity {
  readonly id: EntityId;
  readonly orderId: EntityId;
  readonly amountMinor: MoneyMinor;
  readonly refundedAmountMinor: MoneyMinor;
  readonly method: PaymentMethod;
  readonly status: PaymentStatus;
  readonly createdByUserId: EntityId;
  readonly processedAt: IsoDateTime | null;
}

export interface RestaurantSettings extends RestaurantScopedEntity, TimestampedEntity {
  readonly menuEnabled: boolean;
  readonly orderingEnabled: boolean;
  readonly waiterCallEnabled: boolean;
  readonly billRequestEnabled: boolean;
  readonly introEnabled: boolean;
  /** Exact numeric strings mirror PostgreSQL numeric columns. */
  readonly serviceFeeRate: string;
  readonly taxRate: string;
}

export interface AuditLog extends RestaurantScopedEntity {
  readonly id: EntityId;
  readonly actorUserId: EntityId | null;
  readonly action: string;
  readonly entityType: string;
  readonly entityId: EntityId | null;
  readonly oldValue: JsonValue | null;
  readonly newValue: JsonValue | null;
  readonly metadata: JsonValue;
  readonly createdAt: IsoDateTime;
}
