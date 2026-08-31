import { sql } from "drizzle-orm";

import { orderChannelEnum } from "./erp-schema";
import {
  bigint,
  boolean,
  char,
  check,
  foreignKey,
  index,
  inet,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export type JsonPrimitive = boolean | number | string | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export const userRoleEnum = pgEnum("user_role", [
  "ADMIN",
  "MANAGER",
  "WAITER",
  "KITCHEN",
  "CASHIER",
]);

export const tableStatusEnum = pgEnum("table_status", [
  "AVAILABLE",
  "OCCUPIED",
  "ORDERING",
  "WAITING",
  "DINING",
  "WAITER_CALL",
  "BILL_REQUESTED",
  "CLEANING",
  "INACTIVE",
]);

export const orderStatusEnum = pgEnum("order_status", [
  "NEW",
  "CONFIRMED",
  "PREPARING",
  "READY",
  "SERVED",
  "COMPLETED",
  "CANCELLED",
]);

export const orderItemStatusEnum = pgEnum("order_item_status", [
  "PENDING",
  "PREPARING",
  "READY",
  "SERVED",
  "CANCELLED",
  "VOIDED",
]);

export const voidReasonCodeEnum = pgEnum("void_reason_code", [
  "CUSTOMER_COMPLAINT",
  "WRONG_ITEM",
  "QUALITY_ISSUE",
  "STAFF_ERROR",
  "MANAGER_COMP",
  "OTHER",
]);

export const refundReasonCodeEnum = pgEnum("refund_reason_code", [
  "CUSTOMER_COMPLAINT",
  "WRONG_CHARGE",
  "QUALITY_ISSUE",
  "STAFF_ERROR",
  "OVERPAYMENT",
  "OTHER",
]);

export const refundStatusEnum = pgEnum("refund_status", ["COMPLETED", "FAILED"]);

export const orderCheckStatusEnum = pgEnum("order_check_status", [
  "OPEN",
  "PAID",
  "CANCELLED",
]);

export const orderCreatorTypeEnum = pgEnum("order_creator_type", [
  "CUSTOMER",
  "STAFF",
  "SYSTEM",
]);

export const orderEventTypeEnum = pgEnum("order_event_type", [
  "ORDER_CREATED",
  "ORDER_CONFIRMED",
  "ORDER_PREPARING",
  "ORDER_READY",
  "ORDER_SERVED",
  "ORDER_COMPLETED",
  "ORDER_CANCELLED",
  "ORDER_ITEM_STATUS_CHANGED",
  "ORDER_ITEMS_ADDED",
  "ORDER_ITEM_CANCELLED",
  "ORDER_ITEM_VOIDED",
  "PAYMENT_RECORDED",
  "PAYMENT_REFUNDED",
  "CHECK_CREATED",
  "CHECK_PAID",
]);

export const waiterCallTypeEnum = pgEnum("waiter_call_type", [
  "WAITER_CALL",
  "BILL_REQUEST",
  "OTHER",
]);

export const waiterCallStatusEnum = pgEnum("waiter_call_status", [
  "OPEN",
  "ACKNOWLEDGED",
  "RESOLVED",
  "CANCELLED",
]);

export const kitchenTicketStatusEnum = pgEnum("kitchen_ticket_status", [
  "NEW",
  "PREPARING",
  "READY",
  "CLOSED",
  "CANCELLED",
]);

export const paymentMethodEnum = pgEnum("payment_method", [
  "CASH",
  "CARD",
  "OTHER",
]);

export const paymentStatusEnum = pgEnum("payment_status", [
  "PENDING",
  "COMPLETED",
  "FAILED",
  "REFUNDED",
  "CANCELLED",
]);

export const cashierShiftStatusEnum = pgEnum("cashier_shift_status", [
  "OPEN",
  "CLOSED",
]);

/** A drawer is counted when it is opened and again when it is closed. */
export const cashCountPhaseEnum = pgEnum("cash_count_phase", ["OPENING", "CLOSING"]);

export const cashMovementTypeEnum = pgEnum("cash_movement_type", [
  "CASH_IN",
  "CASH_OUT",
]);

export const printerStationTypeEnum = pgEnum("printer_station_type", [
  "KITCHEN",
  "BAR",
  "RECEIPT",
  "GENERAL",
]);

export const printDocumentTypeEnum = pgEnum("print_document_type", [
  "KITCHEN_ORDER",
  "KITCHEN_CANCEL",
  "CUSTOMER_BILL",
  "PAYMENT_RECEIPT",
  "X_REPORT",
  "Z_REPORT",
  "TEST_PRINT",
]);

export const printJobStatusEnum = pgEnum("print_job_status", [
  "PENDING",
  "PROCESSING",
  "PRINTED",
  "FAILED",
  "CANCELLED",
]);

export const outboxStatusEnum = pgEnum("outbox_status", [
  "PENDING",
  "PROCESSING",
  "PUBLISHED",
  "FAILED",
]);

export const idempotencyStatusEnum = pgEnum("idempotency_status", [
  "PROCESSING",
  "COMPLETED",
  "FAILED",
]);

const createdAt = () =>
  timestamp("created_at", { withTimezone: true, mode: "date" })
    .defaultNow()
    .notNull();

const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true, mode: "date" })
    .defaultNow()
    .notNull();

const money = (name: string) =>
  numeric(name, { precision: 12, scale: 2 }).notNull();

const percentage = (name: string) =>
  numeric(name, { precision: 5, scale: 2 }).notNull();

export const restaurants = pgTable(
  "restaurants",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: varchar("name", { length: 160 }).notNull(),
    slug: varchar("slug", { length: 120 }).notNull(),
    logoUrl: text("logo_url"),
    phone: varchar("phone", { length: 40 }),
    address: text("address"),
    currency: char("currency", { length: 3 }).default("TRY").notNull(),
    timezone: varchar("timezone", { length: 64 })
      .default("Europe/Istanbul")
      .notNull(),
    defaultLocale: varchar("default_locale", { length: 16 })
      .default("tr-TR")
      .notNull(),
    isActive: boolean("is_active").default(true).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique("restaurants_slug_key").on(table.slug),
    index("restaurants_is_active_idx").on(table.isActive),
    check(
      "restaurants_slug_format_check",
      sql`${table.slug} ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'`,
    ),
    check(
      "restaurants_currency_format_check",
      sql`${table.currency} ~ '^[A-Z]{3}$'`,
    ),
  ],
);

export const staffProfiles = pgTable(
  "staff_profiles",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    // Nullable during invitations/dev seeding; linked to Supabase auth.users
    // after the identity is provisioned. The cross-schema FK is intentionally
    // applied outside Drizzle only when the auth provider lifecycle permits it.
    authUserId: uuid("auth_user_id"),
    restaurantId: uuid("restaurant_id")
      .notNull()
      .references(() => restaurants.id, { onDelete: "restrict" }),
    /** Optional globally unique staff code used only to resolve a Supabase login email. */
    loginIdentifier: varchar("login_identifier", { length: 80 }),
    name: varchar("name", { length: 160 }).notNull(),
    email: varchar("email", { length: 254 }),
    phone: varchar("phone", { length: 40 }),
    role: userRoleEnum("role").notNull(),
    isActive: boolean("is_active").default(true).notNull(),
    deletedAt: timestamp("deleted_at", {
      withTimezone: true,
      mode: "date",
    }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique("staff_profiles_restaurant_id_id_key").on(
      table.restaurantId,
      table.id,
    ),
    uniqueIndex("staff_profiles_auth_user_id_key")
      .on(table.authUserId)
      .where(sql`${table.authUserId} is not null`),
    uniqueIndex("staff_profiles_login_identifier_key")
      .on(table.loginIdentifier)
      .where(sql`${table.loginIdentifier} is not null`),
    uniqueIndex("staff_profiles_restaurant_id_email_key")
      .on(table.restaurantId, sql`lower(${table.email})`)
      .where(sql`${table.email} is not null`),
    index("staff_profiles_restaurant_id_role_active_idx").on(
      table.restaurantId,
      table.role,
      table.isActive,
    ),
    check(
      "staff_profiles_login_identifier_format_check",
      sql`${table.loginIdentifier} is null or ${table.loginIdentifier} ~ '^[A-Za-z0-9._-]{3,80}$'`,
    ),
  ],
);

export const categories = pgTable(
  "categories",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    restaurantId: uuid("restaurant_id")
      .notNull()
      .references(() => restaurants.id, { onDelete: "restrict" }),
    name: varchar("name", { length: 120 }).notNull(),
    slug: varchar("slug", { length: 120 }).notNull(),
    description: text("description"),
    imageUrl: text("image_url"),
    sortOrder: integer("sort_order").default(0).notNull(),
    isActive: boolean("is_active").default(true).notNull(),
    deletedAt: timestamp("deleted_at", {
      withTimezone: true,
      mode: "date",
    }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique("categories_restaurant_id_id_key").on(table.restaurantId, table.id),
    unique("categories_restaurant_id_slug_key").on(
      table.restaurantId,
      table.slug,
    ),
    index("categories_restaurant_active_sort_idx").on(
      table.restaurantId,
      table.isActive,
      table.sortOrder,
    ),
    check("categories_sort_order_check", sql`${table.sortOrder} >= 0`),
    check(
      "categories_slug_format_check",
      sql`${table.slug} ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'`,
    ),
  ],
);

export const products = pgTable(
  "products",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    restaurantId: uuid("restaurant_id").notNull(),
    categoryId: uuid("category_id").notNull(),
    name: varchar("name", { length: 180 }).notNull(),
    slug: varchar("slug", { length: 180 }).notNull(),
    description: text("description"),
    price: money("price"),
    imageUrl: text("image_url"),
    weightLabel: varchar("weight_label", { length: 60 }),
    isActive: boolean("is_active").default(true).notNull(),
    isAvailable: boolean("is_available").default(true).notNull(),
    isFeatured: boolean("is_featured").default(false).notNull(),
    isSpicy: boolean("is_spicy").default(false).notNull(),
    isVegetarian: boolean("is_vegetarian").default(false).notNull(),
    allergens: text("allergens")
      .array()
      .default(sql`array[]::text[]`)
      .notNull(),
    tags: text("tags")
      .array()
      .default(sql`array[]::text[]`)
      .notNull(),
    sortOrder: integer("sort_order").default(0).notNull(),
    version: integer("version").default(1).notNull(),
    deletedAt: timestamp("deleted_at", {
      withTimezone: true,
      mode: "date",
    }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    foreignKey({
      name: "products_restaurant_category_fk",
      columns: [table.restaurantId, table.categoryId],
      foreignColumns: [categories.restaurantId, categories.id],
    }).onDelete("restrict"),
    unique("products_restaurant_id_id_key").on(table.restaurantId, table.id),
    unique("products_restaurant_id_slug_key").on(
      table.restaurantId,
      table.slug,
    ),
    index("products_restaurant_category_menu_idx").on(
      table.restaurantId,
      table.categoryId,
      table.isActive,
      table.isAvailable,
      table.sortOrder,
    ),
    index("products_restaurant_featured_idx").on(
      table.restaurantId,
      table.isFeatured,
      table.isActive,
    ),
    index("products_allergens_gin_idx").using("gin", table.allergens),
    index("products_tags_gin_idx").using("gin", table.tags),
    check("products_price_check", sql`${table.price} >= 0`),
    check("products_sort_order_check", sql`${table.sortOrder} >= 0`),
    check("products_version_check", sql`${table.version} > 0`),
    check(
      "products_slug_format_check",
      sql`${table.slug} ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'`,
    ),
  ],
);

export const categoryTranslations = pgTable(
  "category_translations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    restaurantId: uuid("restaurant_id").notNull(),
    categoryId: uuid("category_id").notNull(),
    locale: varchar("locale", { length: 16 }).notNull(),
    name: varchar("name", { length: 120 }).notNull(),
    description: text("description"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    foreignKey({
      name: "category_translations_restaurant_category_fk",
      columns: [table.restaurantId, table.categoryId],
      foreignColumns: [categories.restaurantId, categories.id],
    }).onDelete("cascade"),
    unique("category_translations_restaurant_category_locale_key").on(
      table.restaurantId,
      table.categoryId,
      table.locale,
    ),
    index("category_translations_restaurant_locale_idx").on(
      table.restaurantId,
      table.locale,
      table.categoryId,
    ),
    check(
      "category_translations_locale_format_check",
      sql`${table.locale} ~ '^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})?$'`,
    ),
    check(
      "category_translations_name_not_blank_check",
      sql`length(btrim(${table.name})) > 0`,
    ),
  ],
);

export const productTranslations = pgTable(
  "product_translations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    restaurantId: uuid("restaurant_id").notNull(),
    productId: uuid("product_id").notNull(),
    locale: varchar("locale", { length: 16 }).notNull(),
    name: varchar("name", { length: 180 }).notNull(),
    description: text("description"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    foreignKey({
      name: "product_translations_restaurant_product_fk",
      columns: [table.restaurantId, table.productId],
      foreignColumns: [products.restaurantId, products.id],
    }).onDelete("cascade"),
    unique("product_translations_restaurant_product_locale_key").on(
      table.restaurantId,
      table.productId,
      table.locale,
    ),
    index("product_translations_restaurant_locale_idx").on(
      table.restaurantId,
      table.locale,
      table.productId,
    ),
    check(
      "product_translations_locale_format_check",
      sql`${table.locale} ~ '^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})?$'`,
    ),
    check(
      "product_translations_name_not_blank_check",
      sql`length(btrim(${table.name})) > 0`,
    ),
  ],
);

export const restaurantTables = pgTable(
  "restaurant_tables",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    restaurantId: uuid("restaurant_id")
      .notNull()
      .references(() => restaurants.id, { onDelete: "restrict" }),
    name: varchar("name", { length: 80 }).notNull(),
    tableNumber: integer("table_number").notNull(),
    seats: smallint("seats").default(4).notNull(),
    qrTokenHash: varchar("qr_token_hash", { length: 80 }).notNull(),
    qrTokenVersion: integer("qr_token_version").default(1).notNull(),
    qrTokenRotatedAt: timestamp("qr_token_rotated_at", {
      withTimezone: true,
      mode: "date",
    })
      .defaultNow()
      .notNull(),
    qrTokenRevokedAt: timestamp("qr_token_revoked_at", {
      withTimezone: true,
      mode: "date",
    }),
    isActive: boolean("is_active").default(true).notNull(),
    currentStatus: tableStatusEnum("current_status")
      .default("AVAILABLE")
      .notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique("restaurant_tables_restaurant_id_id_key").on(
      table.restaurantId,
      table.id,
    ),
    unique("restaurant_tables_restaurant_number_key").on(
      table.restaurantId,
      table.tableNumber,
    ),
    unique("restaurant_tables_qr_token_hash_key").on(table.qrTokenHash),
    index("restaurant_tables_restaurant_status_idx").on(
      table.restaurantId,
      table.currentStatus,
      table.isActive,
    ),
    index("restaurant_tables_qr_lookup_idx")
      .on(table.qrTokenHash, table.qrTokenVersion)
      .where(sql`${table.isActive} and ${table.qrTokenRevokedAt} is null`),
    check("restaurant_tables_number_check", sql`${table.tableNumber} > 0`),
    check(
      "restaurant_tables_seats_check",
      sql`${table.seats} between 1 and 100`,
    ),
    check(
      "restaurant_tables_qr_hash_format_check",
      sql`${table.qrTokenHash} ~ '^v[0-9]+[.][A-Za-z0-9_-]{43}$'`,
    ),
    check(
      "restaurant_tables_qr_version_check",
      sql`${table.qrTokenVersion} > 0`,
    ),
  ],
);

export const restaurantCounters = pgTable(
  "restaurant_counters",
  {
    restaurantId: uuid("restaurant_id")
      .notNull()
      .references(() => restaurants.id, { onDelete: "restrict" }),
    counterName: varchar("counter_name", { length: 64 }).notNull(),
    currentValue: bigint("current_value", { mode: "bigint" })
      .default(sql`0`)
      .notNull(),
    updatedAt: updatedAt(),
  },
  (table) => [
    primaryKey({
      name: "restaurant_counters_pkey",
      columns: [table.restaurantId, table.counterName],
    }),
    check(
      "restaurant_counters_current_value_check",
      sql`${table.currentValue} >= 0`,
    ),
  ],
);

export const orders = pgTable(
  "orders",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    restaurantId: uuid("restaurant_id").notNull(),
    /**
     * Where the order is served. A dine-in order is anchored to a table; a
     * takeaway or courier order has no table to be anchored to, and inventing
     * one would put it on the floor plan and in the occupancy figures. The
     * channel is what tells the two apart, and `orders_channel_table_check`
     * makes the pairing an invariant rather than a convention.
     */
    channel: orderChannelEnum("channel").default("DINE_IN").notNull(),
    tableId: uuid("table_id"),
    orderSequence: bigint("order_sequence", { mode: "bigint" }).notNull(),
    orderNumber: varchar("order_number", { length: 32 }).notNull(),
    status: orderStatusEnum("status").default("NEW").notNull(),
    subtotal: money("subtotal"),
    discountTotal: money("discount_total").default("0.00"),
    serviceChargeTotal: money("service_charge_total").default("0.00"),
    taxTotal: money("tax_total").default("0.00"),
    total: money("total"),
    /**
     * The rates the order was opened with. Recalculating an order after a later
     * settings change must not re-price the round the guest already agreed to,
     * so the applied rates travel with the order. Null on rows created before
     * this column existed; those fall back to the restaurant settings.
     */
    serviceFeeRate: numeric("service_fee_rate", { precision: 5, scale: 2 }),
    taxRate: numeric("tax_rate", { precision: 5, scale: 2 }),
    notes: varchar("notes", { length: 1000 }),
    createdByType: orderCreatorTypeEnum("created_by_type").notNull(),
    createdByUserId: uuid("created_by_user_id"),
    /**
     * Which guest sitting placed this order, for orders a guest placed
     * themselves from the QR menu.
     *
     * The customer order view is otherwise scoped to (restaurant, table) plus
     * "not yet settled", which is a proxy for the current sitting and not the
     * sitting itself: an order left unsettled when a party leaves stays
     * visible to whoever scans that table next. This column is the missing
     * ownership fact, taken from the nonce the signed table session already
     * carries.
     *
     * Null for staff-created orders, for takeaway and courier orders, and for
     * every row written before this column existed. Customer-facing reads
     * must treat null as "not mine" — failing closed — while staff, kitchen
     * and cashier reads ignore this column entirely.
     */
    customerSessionNonce: varchar("customer_session_nonce", { length: 32 }),
    version: integer("version").default(1).notNull(),
    confirmedAt: timestamp("confirmed_at", {
      withTimezone: true,
      mode: "date",
    }),
    preparingAt: timestamp("preparing_at", {
      withTimezone: true,
      mode: "date",
    }),
    readyAt: timestamp("ready_at", { withTimezone: true, mode: "date" }),
    servedAt: timestamp("served_at", { withTimezone: true, mode: "date" }),
    closedAt: timestamp("closed_at", { withTimezone: true, mode: "date" }),
    cancelledAt: timestamp("cancelled_at", {
      withTimezone: true,
      mode: "date",
    }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    foreignKey({
      name: "orders_restaurant_table_fk",
      columns: [table.restaurantId, table.tableId],
      foreignColumns: [restaurantTables.restaurantId, restaurantTables.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "orders_restaurant_creator_fk",
      columns: [table.restaurantId, table.createdByUserId],
      foreignColumns: [staffProfiles.restaurantId, staffProfiles.id],
    }).onDelete("restrict"),
    unique("orders_restaurant_id_id_key").on(table.restaurantId, table.id),
    unique("orders_restaurant_sequence_key").on(
      table.restaurantId,
      table.orderSequence,
    ),
    unique("orders_restaurant_number_key").on(
      table.restaurantId,
      table.orderNumber,
    ),
    index("orders_restaurant_status_created_idx").on(
      table.restaurantId,
      table.status,
      table.createdAt,
    ),
    index("orders_restaurant_table_status_idx").on(
      table.restaurantId,
      table.tableId,
      table.status,
    ),
    check(
      "orders_channel_table_check",
      sql`(${table.channel} = 'DINE_IN' and ${table.tableId} is not null) or (${table.channel} in ('TAKEAWAY', 'DELIVERY') and ${table.tableId} is null)`,
    ),
    check("orders_sequence_check", sql`${table.orderSequence} > 0`),
    check("orders_subtotal_check", sql`${table.subtotal} >= 0`),
    check("orders_discount_total_check", sql`${table.discountTotal} >= 0`),
    check(
      "orders_service_charge_total_check",
      sql`${table.serviceChargeTotal} >= 0`,
    ),
    check("orders_tax_total_check", sql`${table.taxTotal} >= 0`),
    check("orders_total_check", sql`${table.total} >= 0`),
    check(
      "orders_total_formula_check",
      sql`${table.total} = ${table.subtotal} - ${table.discountTotal} + ${table.serviceChargeTotal} + ${table.taxTotal}`,
    ),
    check("orders_version_check", sql`${table.version} > 0`),
    check(
      "orders_service_fee_rate_check",
      sql`${table.serviceFeeRate} is null or ${table.serviceFeeRate} between 0 and 100`,
    ),
    check(
      "orders_tax_rate_check",
      sql`${table.taxRate} is null or ${table.taxRate} between 0 and 100`,
    ),
    check(
      "orders_creator_check",
      sql`${table.createdByType} <> 'STAFF' or ${table.createdByUserId} is not null`,
    ),
  ],
);

export const orderItems = pgTable(
  "order_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    restaurantId: uuid("restaurant_id").notNull(),
    orderId: uuid("order_id").notNull(),
    productId: uuid("product_id").notNull(),
    productNameSnapshot: varchar("product_name_snapshot", { length: 180 })
      .notNull(),
    unitPrice: money("unit_price"),
    quantity: integer("quantity").notNull(),
    lineTotal: money("line_total"),
    notes: varchar("notes", { length: 500 }),
    status: orderItemStatusEnum("status").default("PENDING").notNull(),
    sortOrder: integer("sort_order").default(0).notNull(),
    cancelledAt: timestamp("cancelled_at", {
      withTimezone: true,
      mode: "date",
    }),
    /** Set when a served line is written off the bill; the row is never deleted. */
    voidedAt: timestamp("voided_at", { withTimezone: true, mode: "date" }),
    voidedBy: uuid("voided_by"),
    voidReasonCode: voidReasonCodeEnum("void_reason_code"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    foreignKey({
      name: "order_items_restaurant_voider_fk",
      columns: [table.restaurantId, table.voidedBy],
      foreignColumns: [staffProfiles.restaurantId, staffProfiles.id],
    }).onDelete("restrict"),
    index("order_items_restaurant_voided_idx")
      .on(table.restaurantId, table.voidedAt)
      .where(sql`${table.voidedAt} is not null`),
    foreignKey({
      name: "order_items_restaurant_order_fk",
      columns: [table.restaurantId, table.orderId],
      foreignColumns: [orders.restaurantId, orders.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "order_items_restaurant_product_fk",
      columns: [table.restaurantId, table.productId],
      foreignColumns: [products.restaurantId, products.id],
    }).onDelete("restrict"),
    unique("order_items_restaurant_id_id_key").on(table.restaurantId, table.id),
    index("order_items_restaurant_order_status_idx").on(
      table.restaurantId,
      table.orderId,
      table.status,
      table.sortOrder,
    ),
    index("order_items_restaurant_product_idx").on(
      table.restaurantId,
      table.productId,
    ),
    check("order_items_unit_price_check", sql`${table.unitPrice} >= 0`),
    check(
      "order_items_quantity_check",
      sql`${table.quantity} between 1 and 99`,
    ),
    check("order_items_line_total_check", sql`${table.lineTotal} >= 0`),
    check(
      "order_items_line_total_formula_check",
      sql`${table.lineTotal} = ${table.unitPrice} * ${table.quantity}`,
    ),
    check("order_items_sort_order_check", sql`${table.sortOrder} >= 0`),
  ],
);

export const kitchenTickets = pgTable(
  "kitchen_tickets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    restaurantId: uuid("restaurant_id").notNull(),
    orderId: uuid("order_id").notNull(),
    status: kitchenTicketStatusEnum("status").default("NEW").notNull(),
    priority: smallint("priority").default(0).notNull(),
    notes: varchar("notes", { length: 500 }),
    preparationStartedAt: timestamp("preparation_started_at", {
      withTimezone: true,
      mode: "date",
    }),
    readyAt: timestamp("ready_at", { withTimezone: true, mode: "date" }),
    closedAt: timestamp("closed_at", { withTimezone: true, mode: "date" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    foreignKey({
      name: "kitchen_tickets_restaurant_order_fk",
      columns: [table.restaurantId, table.orderId],
      foreignColumns: [orders.restaurantId, orders.id],
    }).onDelete("restrict"),
    unique("kitchen_tickets_restaurant_id_id_key").on(
      table.restaurantId,
      table.id,
    ),
    unique("kitchen_tickets_restaurant_order_key").on(
      table.restaurantId,
      table.orderId,
    ),
    index("kitchen_tickets_restaurant_status_created_idx").on(
      table.restaurantId,
      table.status,
      table.createdAt,
    ),
    check(
      "kitchen_tickets_priority_check",
      sql`${table.priority} between -10 and 10`,
    ),
  ],
);

export const waiterCalls = pgTable(
  "waiter_calls",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    restaurantId: uuid("restaurant_id").notNull(),
    tableId: uuid("table_id").notNull(),
    type: waiterCallTypeEnum("type").notNull(),
    requestLabel: varchar("request_label", { length: 120 }),
    notes: varchar("notes", { length: 500 }),
    status: waiterCallStatusEnum("status").default("OPEN").notNull(),
    tableTokenVersion: integer("table_token_version").notNull(),
    acknowledgedAt: timestamp("acknowledged_at", {
      withTimezone: true,
      mode: "date",
    }),
    acknowledgedBy: uuid("acknowledged_by"),
    resolvedAt: timestamp("resolved_at", {
      withTimezone: true,
      mode: "date",
    }),
    resolvedBy: uuid("resolved_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    foreignKey({
      name: "waiter_calls_restaurant_table_fk",
      columns: [table.restaurantId, table.tableId],
      foreignColumns: [restaurantTables.restaurantId, restaurantTables.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "waiter_calls_restaurant_acknowledger_fk",
      columns: [table.restaurantId, table.acknowledgedBy],
      foreignColumns: [staffProfiles.restaurantId, staffProfiles.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "waiter_calls_restaurant_resolver_fk",
      columns: [table.restaurantId, table.resolvedBy],
      foreignColumns: [staffProfiles.restaurantId, staffProfiles.id],
    }).onDelete("restrict"),
    unique("waiter_calls_restaurant_id_id_key").on(table.restaurantId, table.id),
    uniqueIndex("waiter_calls_one_active_type_per_table_key")
      .on(table.restaurantId, table.tableId, table.type)
      .where(sql`${table.status} in ('OPEN', 'ACKNOWLEDGED')`),
    index("waiter_calls_restaurant_status_created_idx").on(
      table.restaurantId,
      table.status,
      table.createdAt,
    ),
    index("waiter_calls_restaurant_table_created_idx").on(
      table.restaurantId,
      table.tableId,
      table.createdAt,
    ),
    check(
      "waiter_calls_token_version_check",
      sql`${table.tableTokenVersion} > 0`,
    ),
  ],
);

export const orderEvents = pgTable(
  "order_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    restaurantId: uuid("restaurant_id").notNull(),
    orderId: uuid("order_id").notNull(),
    eventType: orderEventTypeEnum("event_type").notNull(),
    userId: uuid("user_id"),
    payload: jsonb("payload")
      .$type<JsonObject>()
      .default(sql`'{}'::jsonb`)
      .notNull(),
    processedAt: timestamp("processed_at", {
      withTimezone: true,
      mode: "date",
    }),
    createdAt: createdAt(),
  },
  (table) => [
    foreignKey({
      name: "order_events_restaurant_order_fk",
      columns: [table.restaurantId, table.orderId],
      foreignColumns: [orders.restaurantId, orders.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "order_events_restaurant_user_fk",
      columns: [table.restaurantId, table.userId],
      foreignColumns: [staffProfiles.restaurantId, staffProfiles.id],
    }).onDelete("restrict"),
    index("order_events_restaurant_order_created_idx").on(
      table.restaurantId,
      table.orderId,
      table.createdAt,
    ),
    index("order_events_restaurant_type_created_idx").on(
      table.restaurantId,
      table.eventType,
      table.createdAt,
    ),
  ],
);

/**
 * A physical or logical till. Shifts and their cash accountability hang off it,
 * so a register with history is deactivated, never deleted.
 */
export const cashRegisters = pgTable(
  "cash_registers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    restaurantId: uuid("restaurant_id")
      .notNull()
      .references(() => restaurants.id, { onDelete: "restrict" }),
    name: varchar("name", { length: 80 }).notNull(),
    /** Short operator-facing identifier, unique inside the restaurant. */
    code: varchar("code", { length: 40 }).notNull(),
    isActive: boolean("is_active").default(true).notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true, mode: "date" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique("cash_registers_restaurant_id_id_key").on(table.restaurantId, table.id),
    unique("cash_registers_restaurant_code_key").on(table.restaurantId, table.code),
    index("cash_registers_restaurant_active_idx").on(table.restaurantId, table.isActive),
    check(
      "cash_registers_code_format_check",
      sql`${table.code} ~ '^[A-Z0-9][A-Z0-9_-]{0,39}$'`,
    ),
    check("cash_registers_name_check", sql`length(btrim(${table.name})) > 0`),
  ],
);

/**
 * One cashier's accountability period on one register.
 *
 * The closing figures are a snapshot taken inside the closing transaction and
 * are never recomputed afterwards: a refund taken tomorrow belongs to
 * tomorrow's shift, and yesterday's counted drawer must stay exactly as it was
 * counted. The status/closing check constraint is what makes that immutable at
 * the database level rather than by convention.
 */
export const cashierShifts = pgTable(
  "cashier_shifts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    restaurantId: uuid("restaurant_id").notNull(),
    cashRegisterId: uuid("cash_register_id").notNull(),
    /** The register's name as it was when the shift opened. */
    registerNameSnapshot: varchar("register_name_snapshot", { length: 80 }).notNull(),
    openedByStaffId: uuid("opened_by_staff_id").notNull(),
    openedAt: timestamp("opened_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
    openingCash: money("opening_cash"),
    status: cashierShiftStatusEnum("status").default("OPEN").notNull(),
    closedAt: timestamp("closed_at", { withTimezone: true, mode: "date" }),
    closedByStaffId: uuid("closed_by_staff_id"),
    /** What the cashier physically counted; never server-derived. */
    countedCashAtClose: numeric("counted_cash_at_close", { precision: 12, scale: 2 }),
    /** Server-derived at close time and then frozen. */
    expectedCashAtClose: numeric("expected_cash_at_close", { precision: 12, scale: 2 }),
    /** counted − expected; negative means the drawer was short. */
    cashVariance: numeric("cash_variance", { precision: 12, scale: 2 }),
    closeNote: varchar("close_note", { length: 500 }),
    /**
     * The operational Z report: a frozen snapshot written in the same
     * transaction that closes the shift, and never recomputed afterwards. It is
     * deliberately stored rather than derived, because a refund issued by a
     * later shift changes today's live totals but must not change yesterday's
     * report. Null on shifts closed before Phase 8B; those are LEGACY and are
     * never back-filled with a reconstructed report.
     */
    zReportVersion: integer("z_report_version"),
    zReportGeneratedAt: timestamp("z_report_generated_at", {
      withTimezone: true,
      mode: "date",
    }),
    zReportSnapshot: jsonb("z_report_snapshot").$type<JsonObject>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    foreignKey({
      name: "cashier_shifts_restaurant_register_fk",
      columns: [table.restaurantId, table.cashRegisterId],
      foreignColumns: [cashRegisters.restaurantId, cashRegisters.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "cashier_shifts_restaurant_opener_fk",
      columns: [table.restaurantId, table.openedByStaffId],
      foreignColumns: [staffProfiles.restaurantId, staffProfiles.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "cashier_shifts_restaurant_closer_fk",
      columns: [table.restaurantId, table.closedByStaffId],
      foreignColumns: [staffProfiles.restaurantId, staffProfiles.id],
    }).onDelete("restrict"),
    unique("cashier_shifts_restaurant_id_id_key").on(table.restaurantId, table.id),
    // Two concurrent open requests cannot both win: the database decides.
    uniqueIndex("cashier_shifts_one_open_per_register_key")
      .on(table.restaurantId, table.cashRegisterId)
      .where(sql`${table.status} = 'OPEN'`),
    uniqueIndex("cashier_shifts_one_open_per_staff_key")
      .on(table.restaurantId, table.openedByStaffId)
      .where(sql`${table.status} = 'OPEN'`),
    index("cashier_shifts_restaurant_status_opened_idx").on(
      table.restaurantId,
      table.status,
      table.openedAt,
    ),
    index("cashier_shifts_restaurant_opener_opened_idx").on(
      table.restaurantId,
      table.openedByStaffId,
      table.openedAt,
    ),
    index("cashier_shifts_restaurant_register_opened_idx").on(
      table.restaurantId,
      table.cashRegisterId,
      table.openedAt,
    ),
    check("cashier_shifts_opening_cash_check", sql`${table.openingCash} >= 0`),
    check(
      "cashier_shifts_counted_cash_check",
      sql`${table.countedCashAtClose} is null or ${table.countedCashAtClose} >= 0`,
    ),
    // An OPEN shift carries no closing figures; a CLOSED one carries all of
    // them. This is what stops a closed shift being reopened or blanked.
    check(
      "cashier_shifts_closure_consistency_check",
      sql`(
        ${table.status} = 'OPEN'
        and ${table.closedAt} is null
        and ${table.closedByStaffId} is null
        and ${table.countedCashAtClose} is null
        and ${table.expectedCashAtClose} is null
        and ${table.cashVariance} is null
      ) or (
        ${table.status} = 'CLOSED'
        and ${table.closedAt} is not null
        and ${table.closedByStaffId} is not null
        and ${table.countedCashAtClose} is not null
        and ${table.expectedCashAtClose} is not null
        and ${table.cashVariance} is not null
        and ${table.cashVariance} = ${table.countedCashAtClose} - ${table.expectedCashAtClose}
      )`,
    ),
    // The three snapshot columns move together or not at all. Legacy shifts
    // closed before Phase 8B have all three null, which stays valid.
    check(
      "cashier_shifts_z_snapshot_consistency_check",
      sql`(
        ${table.zReportSnapshot} is null
        and ${table.zReportVersion} is null
        and ${table.zReportGeneratedAt} is null
      ) or (
        ${table.zReportSnapshot} is not null
        and ${table.zReportVersion} is not null
        and ${table.zReportGeneratedAt} is not null
        and ${table.status} = 'CLOSED'
      )`,
    ),
    index("cashier_shifts_z_report_idx")
      .on(table.restaurantId, table.zReportGeneratedAt)
      .where(sql`${table.zReportSnapshot} is not null`),
  ],
);

/**
 * A physically counted drawer, one row per denomination.
 *
 * Normalised rather than a JSON blob because this is an auditable financial
 * record: a row here is a statement that a named cashier counted N pieces of a
 * named face value at a named moment, and a reviewer must be able to query
 * across shifts ("how often is the ₺200 tray short?") without unpacking JSON.
 *
 * `subtotal_minor` is stored even though it is derivable, because it is the
 * server's own arithmetic frozen at the time of counting. If a denomination is
 * ever redefined, history must keep the number that was actually agreed.
 *
 * Amounts are integer minor units — kuruş, cent — never a float. The three
 * currencies are separate inventories and are never summed across rows.
 */
export const cashierShiftCashCounts = pgTable(
  "cashier_shift_cash_counts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    restaurantId: uuid("restaurant_id").notNull(),
    shiftId: uuid("shift_id").notNull(),
    phase: cashCountPhaseEnum("phase").notNull(),
    /** ISO-4217, constrained to the currencies the drawer may be counted in. */
    currency: varchar("currency", { length: 3 }).notNull(),
    /** Face value in minor units; the denomination's identity. */
    denominationMinor: integer("denomination_minor").notNull(),
    pieceCount: integer("piece_count").notNull(),
    /** Server-computed denomination_minor * piece_count, frozen at count time. */
    subtotalMinor: bigint("subtotal_minor", { mode: "number" }).notNull(),
    countedByStaffId: uuid("counted_by_staff_id").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    foreignKey({
      name: "cashier_shift_cash_counts_shift_fk",
      columns: [table.restaurantId, table.shiftId],
      foreignColumns: [cashierShifts.restaurantId, cashierShifts.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "cashier_shift_cash_counts_staff_fk",
      columns: [table.restaurantId, table.countedByStaffId],
      foreignColumns: [staffProfiles.restaurantId, staffProfiles.id],
    }).onDelete("restrict"),
    // One row per denomination per phase: a retried write cannot silently
    // double a drawer.
    unique("cashier_shift_cash_counts_unique_key").on(
      table.shiftId,
      table.phase,
      table.currency,
      table.denominationMinor,
    ),
    index("cashier_shift_cash_counts_shift_phase_idx").on(
      table.restaurantId,
      table.shiftId,
      table.phase,
    ),
    check("cashier_shift_cash_counts_currency_check", sql`${table.currency} in ('TRY', 'EUR', 'USD')`),
    check("cashier_shift_cash_counts_denomination_check", sql`${table.denominationMinor} > 0`),
    // Zero-count rows are not written at all, so a stored row is real money.
    check("cashier_shift_cash_counts_piece_check", sql`${table.pieceCount} > 0 and ${table.pieceCount} <= 100000`),
    check(
      "cashier_shift_cash_counts_subtotal_check",
      sql`${table.subtotalMinor} = ${table.denominationMinor}::bigint * ${table.pieceCount}::bigint`,
    ),
  ],
);


/**
 * Physical cash entering or leaving the drawer for reasons other than a
 * payment or refund. Append-only: a mistake is corrected with an opposite
 * movement, never by editing history.
 */
export const cashDrawerMovements = pgTable(
  "cash_drawer_movements",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    restaurantId: uuid("restaurant_id").notNull(),
    cashierShiftId: uuid("cashier_shift_id").notNull(),
    type: cashMovementTypeEnum("type").notNull(),
    /** Always positive; the direction is carried by `type`. */
    amount: money("amount"),
    reason: varchar("reason", { length: 120 }).notNull(),
    note: varchar("note", { length: 500 }),
    createdByStaffId: uuid("created_by_staff_id").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    foreignKey({
      name: "cash_drawer_movements_restaurant_shift_fk",
      columns: [table.restaurantId, table.cashierShiftId],
      foreignColumns: [cashierShifts.restaurantId, cashierShifts.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "cash_drawer_movements_restaurant_creator_fk",
      columns: [table.restaurantId, table.createdByStaffId],
      foreignColumns: [staffProfiles.restaurantId, staffProfiles.id],
    }).onDelete("restrict"),
    unique("cash_drawer_movements_restaurant_id_id_key").on(table.restaurantId, table.id),
    index("cash_drawer_movements_shift_created_idx").on(
      table.restaurantId,
      table.cashierShiftId,
      table.createdAt,
    ),
    check("cash_drawer_movements_amount_check", sql`${table.amount} > 0`),
    check(
      "cash_drawer_movements_reason_check",
      sql`length(btrim(${table.reason})) > 0`,
    ),
  ],
);

export const payments = pgTable(
  "payments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    restaurantId: uuid("restaurant_id").notNull(),
    orderId: uuid("order_id").notNull(),
    /** Optional: which split check this collection settled. */
    checkId: uuid("check_id"),
    /**
     * The cashier accountability period this collection belongs to. Nullable
     * on purpose: rows collected before shifts existed are LEGACY / PRE-SHIFT
     * and are never back-filled with an invented shift.
     */
    cashierShiftId: uuid("cashier_shift_id"),
    amount: money("amount"),
    /** Denormalized cache of payment_refunds; both move in one transaction. */
    refundedAmount: money("refunded_amount").default("0.00"),
    method: paymentMethodEnum("method").notNull(),
    status: paymentStatusEnum("status").default("PENDING").notNull(),
    externalReference: varchar("external_reference", { length: 255 }),
    createdByUserId: uuid("created_by_user_id").notNull(),
    metadata: jsonb("metadata")
      .$type<JsonObject>()
      .default(sql`'{}'::jsonb`)
      .notNull(),
    processedAt: timestamp("processed_at", {
      withTimezone: true,
      mode: "date",
    }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    foreignKey({
      name: "payments_restaurant_order_fk",
      columns: [table.restaurantId, table.orderId],
      foreignColumns: [orders.restaurantId, orders.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "payments_restaurant_creator_fk",
      columns: [table.restaurantId, table.createdByUserId],
      foreignColumns: [staffProfiles.restaurantId, staffProfiles.id],
    }).onDelete("restrict"),
    // Composite, so a payment can never be attributed to another tenant's shift.
    foreignKey({
      name: "payments_restaurant_shift_fk",
      columns: [table.restaurantId, table.cashierShiftId],
      foreignColumns: [cashierShifts.restaurantId, cashierShifts.id],
    }).onDelete("restrict"),
    index("payments_restaurant_shift_idx")
      .on(table.restaurantId, table.cashierShiftId)
      .where(sql`${table.cashierShiftId} is not null`),
    unique("payments_restaurant_id_id_key").on(table.restaurantId, table.id),
    // Phase 7 allows several collections per order (split bills, cash + card),
    // so "one live payment per order" is gone. Double collection is now stopped
    // by the order row lock plus a server-derived balance, and a repeated
    // request is stopped at the database by this idempotency-key index.
    uniqueIndex("payments_restaurant_idempotency_key")
      .on(table.restaurantId, sql`(${table.metadata} ->> 'idempotencyKeyHash')`)
      .where(sql`${table.metadata} ->> 'idempotencyKeyHash' is not null`),
    uniqueIndex("payments_restaurant_external_reference_key")
      .on(table.restaurantId, table.externalReference)
      .where(sql`${table.externalReference} is not null`),
    index("payments_restaurant_order_status_idx").on(
      table.restaurantId,
      table.orderId,
      table.status,
    ),
    index("payments_restaurant_created_idx").on(
      table.restaurantId,
      table.createdAt,
    ),
    check("payments_amount_check", sql`${table.amount} > 0`),
    check(
      "payments_refunded_amount_check",
      sql`${table.refundedAmount} >= 0 and ${table.refundedAmount} <= ${table.amount}`,
    ),
  ],
);

/**
 * A collected payment is immutable. Money going back is a second, opposite
 * record here, so gross, refunds and net stay separately provable.
 */
export const paymentRefunds = pgTable(
  "payment_refunds",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    restaurantId: uuid("restaurant_id").notNull(),
    paymentId: uuid("payment_id").notNull(),
    orderId: uuid("order_id").notNull(),
    /**
     * The shift that gave the money back, which is not necessarily the shift
     * that collected it. Yesterday's takings refunded today belong to today's
     * drawer. Nullable for pre-shift history; never back-filled.
     */
    cashierShiftId: uuid("cashier_shift_id"),
    amount: money("amount"),
    reasonCode: refundReasonCodeEnum("reason_code").notNull(),
    note: varchar("note", { length: 300 }),
    status: refundStatusEnum("status").default("COMPLETED").notNull(),
    externalReference: varchar("external_reference", { length: 255 }),
    createdByUserId: uuid("created_by_user_id").notNull(),
    metadata: jsonb("metadata")
      .$type<JsonObject>()
      .default(sql`'{}'::jsonb`)
      .notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    foreignKey({
      name: "payment_refunds_restaurant_payment_fk",
      columns: [table.restaurantId, table.paymentId],
      foreignColumns: [payments.restaurantId, payments.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "payment_refunds_restaurant_order_fk",
      columns: [table.restaurantId, table.orderId],
      foreignColumns: [orders.restaurantId, orders.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "payment_refunds_restaurant_creator_fk",
      columns: [table.restaurantId, table.createdByUserId],
      foreignColumns: [staffProfiles.restaurantId, staffProfiles.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "payment_refunds_restaurant_shift_fk",
      columns: [table.restaurantId, table.cashierShiftId],
      foreignColumns: [cashierShifts.restaurantId, cashierShifts.id],
    }).onDelete("restrict"),
    index("payment_refunds_restaurant_shift_idx")
      .on(table.restaurantId, table.cashierShiftId)
      .where(sql`${table.cashierShiftId} is not null`),
    unique("payment_refunds_restaurant_id_id_key").on(table.restaurantId, table.id),
    // A retried request can never produce a second refund.
    uniqueIndex("payment_refunds_restaurant_idempotency_key")
      .on(table.restaurantId, sql`(${table.metadata} ->> 'idempotencyKeyHash')`)
      .where(sql`${table.metadata} ->> 'idempotencyKeyHash' is not null`),
    index("payment_refunds_restaurant_created_idx").on(table.restaurantId, table.createdAt),
    index("payment_refunds_restaurant_payment_idx").on(table.restaurantId, table.paymentId),
    check("payment_refunds_amount_check", sql`${table.amount} > 0`),
  ],
);

/** One printable bill. An order can carry several when the party splits. */
export const orderChecks = pgTable(
  "order_checks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    restaurantId: uuid("restaurant_id").notNull(),
    orderId: uuid("order_id").notNull(),
    label: varchar("label", { length: 80 }).notNull(),
    status: orderCheckStatusEnum("status").default("OPEN").notNull(),
    /** Snapshot of what this check owes; derived from its allocations. */
    total: money("total").default("0.00"),
    createdByUserId: uuid("created_by_user_id").notNull(),
    closedAt: timestamp("closed_at", { withTimezone: true, mode: "date" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    foreignKey({
      name: "order_checks_restaurant_order_fk",
      columns: [table.restaurantId, table.orderId],
      foreignColumns: [orders.restaurantId, orders.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "order_checks_restaurant_creator_fk",
      columns: [table.restaurantId, table.createdByUserId],
      foreignColumns: [staffProfiles.restaurantId, staffProfiles.id],
    }).onDelete("restrict"),
    unique("order_checks_restaurant_id_id_key").on(table.restaurantId, table.id),
    index("order_checks_restaurant_order_idx").on(
      table.restaurantId,
      table.orderId,
      table.status,
    ),
    check("order_checks_total_check", sql`${table.total} >= 0`),
  ],
);

/**
 * How much of one order line belongs to one check. A line of three portions can
 * sit on two checks; the allocated quantities may never exceed the line.
 */
export const orderCheckItems = pgTable(
  "order_check_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    restaurantId: uuid("restaurant_id").notNull(),
    checkId: uuid("check_id").notNull(),
    orderItemId: uuid("order_item_id").notNull(),
    quantity: integer("quantity").notNull(),
    /** Unit price as sold, so a later price change cannot move a printed bill. */
    unitPriceSnapshot: money("unit_price_snapshot"),
    lineTotal: money("line_total"),
    createdAt: createdAt(),
  },
  (table) => [
    foreignKey({
      name: "order_check_items_restaurant_check_fk",
      columns: [table.restaurantId, table.checkId],
      foreignColumns: [orderChecks.restaurantId, orderChecks.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "order_check_items_restaurant_item_fk",
      columns: [table.restaurantId, table.orderItemId],
      foreignColumns: [orderItems.restaurantId, orderItems.id],
    }).onDelete("restrict"),
    unique("order_check_items_restaurant_id_id_key").on(table.restaurantId, table.id),
    // One row per (check, line); growing a share updates that row.
    unique("order_check_items_check_item_key").on(table.checkId, table.orderItemId),
    index("order_check_items_restaurant_item_idx").on(
      table.restaurantId,
      table.orderItemId,
    ),
    check("order_check_items_quantity_check", sql`${table.quantity} between 1 and 99`),
    check("order_check_items_unit_price_check", sql`${table.unitPriceSnapshot} >= 0`),
    check(
      "order_check_items_line_total_formula_check",
      sql`${table.lineTotal} = ${table.unitPriceSnapshot} * ${table.quantity}`,
    ),
  ],
);

/**
 * A local print agent running inside the restaurant.
 *
 * The cloud server never dials a printer on the restaurant LAN. The agent
 * makes an *outbound* HTTPS connection, claims its own jobs and delivers them,
 * so no inbound port is ever exposed. It authenticates with its own bearer
 * token — never a database credential and never a service-role key — and only
 * the token's HMAC digest is stored here.
 */
export const printerAgents = pgTable(
  "printer_agents",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    restaurantId: uuid("restaurant_id")
      .notNull()
      .references(() => restaurants.id, { onDelete: "restrict" }),
    name: varchar("name", { length: 80 }).notNull(),
    /** `v<version>.<43-char base64url digest>`; the raw token is never stored. */
    tokenHash: varchar("token_hash", { length: 80 }).notNull(),
    tokenVersion: integer("token_version").default(1).notNull(),
    isActive: boolean("is_active").default(true).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true, mode: "date" }),
    softwareVersion: varchar("software_version", { length: 40 }),
    revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "date" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique("printer_agents_restaurant_id_id_key").on(table.restaurantId, table.id),
    unique("printer_agents_token_hash_key").on(table.tokenHash),
    index("printer_agents_restaurant_active_idx").on(table.restaurantId, table.isActive),
    check("printer_agents_token_version_check", sql`${table.tokenVersion} > 0`),
    check(
      "printer_agents_token_hash_format_check",
      sql`${table.tokenHash} ~ '^v[0-9]+[.][A-Za-z0-9_-]{43}$'`,
    ),
  ],
);

/**
 * A printer as the cloud knows it. The LAN address deliberately stays in the
 * agent's own configuration: the server records a stable `device_key` such as
 * `kitchen-main`, and the agent maps that to `192.168.1.50:9100` locally.
 */
export const restaurantPrinters = pgTable(
  "restaurant_printers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    restaurantId: uuid("restaurant_id").notNull(),
    printerAgentId: uuid("printer_agent_id").notNull(),
    name: varchar("name", { length: 80 }).notNull(),
    code: varchar("code", { length: 40 }).notNull(),
    stationType: printerStationTypeEnum("station_type").default("GENERAL").notNull(),
    /** Resolved to a transport target by the agent, not by the server. */
    deviceKey: varchar("device_key", { length: 80 }).notNull(),
    charactersPerLine: smallint("characters_per_line").default(48).notNull(),
    /** Only a code page the renderer actually supports may be stored. */
    encoding: varchar("encoding", { length: 20 }).default("CP857").notNull(),
    autoCut: boolean("auto_cut").default(true).notNull(),
    defaultCopies: smallint("default_copies").default(1).notNull(),
    isActive: boolean("is_active").default(true).notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true, mode: "date" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    foreignKey({
      name: "restaurant_printers_restaurant_agent_fk",
      columns: [table.restaurantId, table.printerAgentId],
      foreignColumns: [printerAgents.restaurantId, printerAgents.id],
    }).onDelete("restrict"),
    unique("restaurant_printers_restaurant_id_id_key").on(table.restaurantId, table.id),
    unique("restaurant_printers_restaurant_code_key").on(table.restaurantId, table.code),
    index("restaurant_printers_restaurant_active_idx").on(
      table.restaurantId,
      table.isActive,
    ),
    index("restaurant_printers_agent_idx").on(table.restaurantId, table.printerAgentId),
    check(
      "restaurant_printers_code_format_check",
      sql`${table.code} ~ '^[A-Z0-9][A-Z0-9_-]{0,39}$'`,
    ),
    check(
      "restaurant_printers_device_key_format_check",
      sql`${table.deviceKey} ~ '^[a-z0-9][a-z0-9_-]{0,79}$'`,
    ),
    check(
      "restaurant_printers_characters_check",
      sql`${table.charactersPerLine} between 24 and 96`,
    ),
    check("restaurant_printers_copies_check", sql`${table.defaultCopies} between 1 and 5`),
  ],
);

/**
 * Which printer a document goes to. A kitchen route may be narrowed to one
 * menu category, so grills print at the grill and drinks at the bar; a route
 * with no category is the station's default.
 */
export const printerRoutes = pgTable(
  "printer_routes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    restaurantId: uuid("restaurant_id").notNull(),
    documentType: printDocumentTypeEnum("document_type").notNull(),
    /** Null means "everything this document type covers". */
    categoryId: uuid("category_id"),
    printerId: uuid("printer_id").notNull(),
    copies: smallint("copies").default(1).notNull(),
    isActive: boolean("is_active").default(true).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    foreignKey({
      name: "printer_routes_restaurant_printer_fk",
      columns: [table.restaurantId, table.printerId],
      foreignColumns: [restaurantPrinters.restaurantId, restaurantPrinters.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "printer_routes_restaurant_category_fk",
      columns: [table.restaurantId, table.categoryId],
      foreignColumns: [categories.restaurantId, categories.id],
    }).onDelete("restrict"),
    unique("printer_routes_restaurant_id_id_key").on(table.restaurantId, table.id),
    // The same category may fan out to several printers, but never twice to
    // the same one.
    uniqueIndex("printer_routes_unique_target_key")
      .on(table.restaurantId, table.documentType, table.categoryId, table.printerId)
      .where(sql`${table.categoryId} is not null`),
    uniqueIndex("printer_routes_unique_default_key")
      .on(table.restaurantId, table.documentType, table.printerId)
      .where(sql`${table.categoryId} is null`),
    index("printer_routes_lookup_idx").on(
      table.restaurantId,
      table.documentType,
      table.isActive,
    ),
    check("printer_routes_copies_check", sql`${table.copies} between 1 and 5`),
  ],
);

/**
 * One document queued for one printer.
 *
 * The queue lives in PostgreSQL, so it survives a server restart, and the
 * payload is an immutable snapshot taken when the job was created: reprinting
 * yesterday's ticket reproduces yesterday's ticket even if the order has moved
 * on since. A reprint is always a *new* row pointing back at the original;
 * a retry re-delivers the same row.
 */
export const printJobs = pgTable(
  "print_jobs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    restaurantId: uuid("restaurant_id").notNull(),
    printerId: uuid("printer_id").notNull(),
    /** Kept so history reads correctly after a printer is renamed or retired. */
    printerNameSnapshot: varchar("printer_name_snapshot", { length: 80 }).notNull(),
    documentType: printDocumentTypeEnum("document_type").notNull(),
    /** What the document was made from: ORDER, PAYMENT, SHIFT, PRINTER. */
    sourceType: varchar("source_type", { length: 40 }).notNull(),
    sourceId: uuid("source_id"),
    payloadVersion: integer("payload_version").notNull(),
    payloadSnapshot: jsonb("payload_snapshot").$type<JsonObject>().notNull(),
    copies: smallint("copies").default(1).notNull(),
    status: printJobStatusEnum("status").default("PENDING").notNull(),
    /** Deterministic per document occurrence; the database enforces one job. */
    dedupeKey: varchar("dedupe_key", { length: 160 }),
    requestedByStaffId: uuid("requested_by_staff_id"),
    reprintOfJobId: uuid("reprint_of_job_id"),
    reprintReason: varchar("reprint_reason", { length: 300 }),
    attemptCount: smallint("attempt_count").default(0).notNull(),
    availableAt: timestamp("available_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
    claimedAt: timestamp("claimed_at", { withTimezone: true, mode: "date" }),
    claimedByAgentId: uuid("claimed_by_agent_id"),
    /** Server-clock lease; a crashed agent cannot strand a job in PROCESSING. */
    leaseUntil: timestamp("lease_until", { withTimezone: true, mode: "date" }),
    printedAt: timestamp("printed_at", { withTimezone: true, mode: "date" }),
    failedAt: timestamp("failed_at", { withTimezone: true, mode: "date" }),
    lastErrorCode: varchar("last_error_code", { length: 60 }),
    lastErrorSummary: varchar("last_error_summary", { length: 300 }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    foreignKey({
      name: "print_jobs_restaurant_printer_fk",
      columns: [table.restaurantId, table.printerId],
      foreignColumns: [restaurantPrinters.restaurantId, restaurantPrinters.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "print_jobs_restaurant_requester_fk",
      columns: [table.restaurantId, table.requestedByStaffId],
      foreignColumns: [staffProfiles.restaurantId, staffProfiles.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "print_jobs_restaurant_agent_fk",
      columns: [table.restaurantId, table.claimedByAgentId],
      foreignColumns: [printerAgents.restaurantId, printerAgents.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "print_jobs_reprint_origin_fk",
      columns: [table.restaurantId, table.reprintOfJobId],
      foreignColumns: [table.restaurantId, table.id],
    }).onDelete("restrict"),
    unique("print_jobs_restaurant_id_id_key").on(table.restaurantId, table.id),
    // The dedupe guard: a repeated confirmation cannot queue a second original.
    uniqueIndex("print_jobs_restaurant_dedupe_key")
      .on(table.restaurantId, table.dedupeKey)
      .where(sql`${table.dedupeKey} is not null`),
    // The claim query: pending/failed work for one printer, oldest first.
    index("print_jobs_claim_idx")
      .on(table.restaurantId, table.printerId, table.availableAt)
      .where(sql`${table.status} in ('PENDING', 'PROCESSING')`),
    index("print_jobs_restaurant_status_created_idx").on(
      table.restaurantId,
      table.status,
      table.createdAt,
    ),
    index("print_jobs_restaurant_source_idx").on(
      table.restaurantId,
      table.sourceType,
      table.sourceId,
    ),
    index("print_jobs_reprint_origin_idx")
      .on(table.restaurantId, table.reprintOfJobId)
      .where(sql`${table.reprintOfJobId} is not null`),
    check("print_jobs_copies_check", sql`${table.copies} between 1 and 5`),
    check("print_jobs_attempts_check", sql`${table.attemptCount} between 0 and 50`),
    check("print_jobs_payload_version_check", sql`${table.payloadVersion} > 0`),
    // A reprint always carries its reason; an original never claims one.
    check(
      "print_jobs_reprint_reason_check",
      sql`(${table.reprintOfJobId} is null and ${table.reprintReason} is null)
        or (${table.reprintOfJobId} is not null and length(btrim(${table.reprintReason})) > 0)`,
    ),
  ],
);

/** Every delivery attempt, kept as history. Never carries a raw error dump. */
export const printJobAttempts = pgTable(
  "print_job_attempts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    restaurantId: uuid("restaurant_id").notNull(),
    printJobId: uuid("print_job_id").notNull(),
    printerAgentId: uuid("printer_agent_id"),
    attemptNumber: smallint("attempt_number").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true, mode: "date" }),
    succeeded: boolean("succeeded").default(false).notNull(),
    errorCode: varchar("error_code", { length: 60 }),
    /** A short, sanitised message; stack traces never reach this column. */
    errorSummary: varchar("error_summary", { length: 300 }),
    bytesWritten: integer("bytes_written"),
    createdAt: createdAt(),
  },
  (table) => [
    foreignKey({
      name: "print_job_attempts_restaurant_job_fk",
      columns: [table.restaurantId, table.printJobId],
      foreignColumns: [printJobs.restaurantId, printJobs.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "print_job_attempts_restaurant_agent_fk",
      columns: [table.restaurantId, table.printerAgentId],
      foreignColumns: [printerAgents.restaurantId, printerAgents.id],
    }).onDelete("restrict"),
    unique("print_job_attempts_restaurant_id_id_key").on(table.restaurantId, table.id),
    unique("print_job_attempts_job_attempt_key").on(table.printJobId, table.attemptNumber),
    index("print_job_attempts_job_created_idx").on(table.printJobId, table.createdAt),
    check("print_job_attempts_number_check", sql`${table.attemptNumber} > 0`),
    check(
      "print_job_attempts_bytes_check",
      sql`${table.bytesWritten} is null or ${table.bytesWritten} >= 0`,
    ),
  ],
);

export const restaurantSettings = pgTable(
  "restaurant_settings",
  {
    restaurantId: uuid("restaurant_id")
      .primaryKey()
      .references(() => restaurants.id, { onDelete: "restrict" }),
    menuEnabled: boolean("menu_enabled").default(true).notNull(),
    orderingEnabled: boolean("ordering_enabled").default(true).notNull(),
    waiterCallEnabled: boolean("waiter_call_enabled").default(true).notNull(),
    billRequestEnabled: boolean("bill_request_enabled").default(true).notNull(),
    introEnabled: boolean("intro_enabled").default(true).notNull(),
    waiterApprovalRequired: boolean("waiter_approval_required")
      .default(true)
      .notNull(),
    customerNotesEnabled: boolean("customer_notes_enabled")
      .default(true)
      .notNull(),
    menuImagesEnabled: boolean("menu_images_enabled").default(true).notNull(),
    serviceFeeRate: percentage("service_fee_rate").default("0.00"),
    taxRate: percentage("tax_rate").default("0.00"),
    maxItemQuantity: smallint("max_item_quantity").default(20).notNull(),
    orderNotesMaxLength: smallint("order_notes_max_length")
      .default(500)
      .notNull(),
    waiterCallCooldownSeconds: smallint("waiter_call_cooldown_seconds")
      .default(30)
      .notNull(),
    notifications: jsonb("notifications")
      .$type<JsonObject>()
      .default(sql`'{"sound":true,"waiterCall":true,"newOrder":true,"billRequest":true}'::jsonb`)
      .notNull(),
    version: integer("version").default(1).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    check(
      "restaurant_settings_service_fee_rate_check",
      sql`${table.serviceFeeRate} between 0 and 100`,
    ),
    check(
      "restaurant_settings_tax_rate_check",
      sql`${table.taxRate} between 0 and 100`,
    ),
    check(
      "restaurant_settings_max_item_quantity_check",
      sql`${table.maxItemQuantity} between 1 and 99`,
    ),
    check(
      "restaurant_settings_notes_length_check",
      sql`${table.orderNotesMaxLength} between 0 and 1000`,
    ),
    check(
      "restaurant_settings_call_cooldown_check",
      sql`${table.waiterCallCooldownSeconds} between 5 and 3600`,
    ),
    check("restaurant_settings_version_check", sql`${table.version} > 0`),
  ],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    restaurantId: uuid("restaurant_id")
      .notNull()
      .references(() => restaurants.id, { onDelete: "restrict" }),
    actorUserId: uuid("actor_user_id"),
    action: varchar("action", { length: 100 }).notNull(),
    entityType: varchar("entity_type", { length: 80 }).notNull(),
    entityId: uuid("entity_id"),
    oldValue: jsonb("old_value").$type<JsonObject>(),
    newValue: jsonb("new_value").$type<JsonObject>(),
    metadata: jsonb("metadata")
      .$type<JsonObject>()
      .default(sql`'{}'::jsonb`)
      .notNull(),
    requestId: varchar("request_id", { length: 100 }),
    ipAddress: inet("ip_address"),
    userAgent: varchar("user_agent", { length: 512 }),
    createdAt: createdAt(),
  },
  (table) => [
    foreignKey({
      name: "audit_logs_restaurant_actor_fk",
      columns: [table.restaurantId, table.actorUserId],
      foreignColumns: [staffProfiles.restaurantId, staffProfiles.id],
    }).onDelete("restrict"),
    index("audit_logs_restaurant_created_idx").on(
      table.restaurantId,
      table.createdAt,
    ),
    index("audit_logs_restaurant_entity_created_idx").on(
      table.restaurantId,
      table.entityType,
      table.entityId,
      table.createdAt,
    ),
    index("audit_logs_restaurant_actor_created_idx").on(
      table.restaurantId,
      table.actorUserId,
      table.createdAt,
    ),
  ],
);

export const outboxEvents = pgTable(
  "outbox_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    restaurantId: uuid("restaurant_id")
      .notNull()
      .references(() => restaurants.id, { onDelete: "restrict" }),
    aggregateType: varchar("aggregate_type", { length: 80 }).notNull(),
    aggregateId: uuid("aggregate_id").notNull(),
    eventType: varchar("event_type", { length: 100 }).notNull(),
    payload: jsonb("payload").$type<JsonObject>().notNull(),
    status: outboxStatusEnum("status").default("PENDING").notNull(),
    attempts: smallint("attempts").default(0).notNull(),
    availableAt: timestamp("available_at", {
      withTimezone: true,
      mode: "date",
    })
      .defaultNow()
      .notNull(),
    lockedAt: timestamp("locked_at", { withTimezone: true, mode: "date" }),
    lockedBy: varchar("locked_by", { length: 120 }),
    publishedAt: timestamp("published_at", {
      withTimezone: true,
      mode: "date",
    }),
    lastError: varchar("last_error", { length: 2000 }),
    /** Set once retries are exhausted; such rows need an explicit manual retry. */
    deadLetteredAt: timestamp("dead_lettered_at", {
      withTimezone: true,
      mode: "date",
    }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("outbox_events_dead_letter_idx")
      .on(table.restaurantId, table.deadLetteredAt)
      .where(sql`${table.deadLetteredAt} is not null`),
    index("outbox_events_dispatch_idx")
      .on(table.status, table.availableAt, table.createdAt)
      .where(sql`${table.status} in ('PENDING', 'FAILED')`),
    index("outbox_events_restaurant_created_idx").on(
      table.restaurantId,
      table.createdAt,
    ),
    index("outbox_events_aggregate_idx").on(
      table.restaurantId,
      table.aggregateType,
      table.aggregateId,
    ),
    check(
      "outbox_events_attempts_check",
      sql`${table.attempts} between 0 and 50`,
    ),
  ],
);

export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    restaurantId: uuid("restaurant_id")
      .notNull()
      .references(() => restaurants.id, { onDelete: "restrict" }),
    scope: varchar("scope", { length: 100 }).notNull(),
    keyHash: char("key_hash", { length: 64 }).notNull(),
    requestHash: char("request_hash", { length: 64 }).notNull(),
    status: idempotencyStatusEnum("status").default("PROCESSING").notNull(),
    resourceType: varchar("resource_type", { length: 80 }),
    resourceId: uuid("resource_id"),
    responseStatus: smallint("response_status"),
    responseBody: jsonb("response_body").$type<JsonValue>(),
    lockedUntil: timestamp("locked_until", {
      withTimezone: true,
      mode: "date",
    }),
    expiresAt: timestamp("expires_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique("idempotency_keys_restaurant_scope_hash_key").on(
      table.restaurantId,
      table.scope,
      table.keyHash,
    ),
    index("idempotency_keys_expiry_idx").on(table.expiresAt),
    index("idempotency_keys_restaurant_resource_idx").on(
      table.restaurantId,
      table.resourceType,
      table.resourceId,
    ),
    check(
      "idempotency_keys_key_hash_format_check",
      sql`${table.keyHash} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "idempotency_keys_request_hash_format_check",
      sql`${table.requestHash} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "idempotency_keys_response_status_check",
      sql`${table.responseStatus} is null or ${table.responseStatus} between 100 and 599`,
    ),
    check(
      "idempotency_keys_expiry_check",
      sql`${table.expiresAt} > ${table.createdAt}`,
    ),
  ],
);

/**
 * Short-lived distributed request markers used for serverless-safe API rate
 * limiting. Keys are HMAC digests; raw IPs, identifiers and table sessions are
 * never persisted. Rows may be deleted after expiry without affecting history.
 */
export const apiRateLimits = pgTable(
  "api_rate_limits",
  {
    id: bigint("id", { mode: "bigint" }).generatedAlwaysAsIdentity().primaryKey(),
    keyHash: varchar("key_hash", { length: 160 }).notNull(),
    requestCount: integer("request_count").default(1).notNull(),
    createdAt: createdAt(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
  },
  (table) => [
    index("api_rate_limits_key_created_idx").on(table.keyHash, table.createdAt),
    uniqueIndex("api_rate_limits_key_hash_key").on(table.keyHash),
    index("api_rate_limits_expires_idx").on(table.expiresAt),
    check("api_rate_limits_request_count_check", sql`${table.requestCount} > 0`),
    check("api_rate_limits_expiry_check", sql`${table.expiresAt} > ${table.createdAt}`),
  ],
);

export type RestaurantRecord = typeof restaurants.$inferSelect;
export type NewRestaurantRecord = typeof restaurants.$inferInsert;
export type StaffProfileRecord = typeof staffProfiles.$inferSelect;
export type NewStaffProfileRecord = typeof staffProfiles.$inferInsert;
export type CategoryRecord = typeof categories.$inferSelect;
export type ProductRecord = typeof products.$inferSelect;
export type RestaurantTableRecord = typeof restaurantTables.$inferSelect;
export type OrderRecord = typeof orders.$inferSelect;
export type NewOrderRecord = typeof orders.$inferInsert;
export type OrderItemRecord = typeof orderItems.$inferSelect;
export type NewOrderItemRecord = typeof orderItems.$inferInsert;
export type KitchenTicketRecord = typeof kitchenTickets.$inferSelect;
export type WaiterCallRecord = typeof waiterCalls.$inferSelect;
export type PaymentRecord = typeof payments.$inferSelect;
export type RestaurantSettingsRecord = typeof restaurantSettings.$inferSelect;
export type AuditLogRecord = typeof auditLogs.$inferSelect;
export type OutboxEventRecord = typeof outboxEvents.$inferSelect;
export type IdempotencyKeyRecord = typeof idempotencyKeys.$inferSelect;
export type ApiRateLimitRecord = typeof apiRateLimits.$inferSelect;

// Phase 38 ERP tables live in a separate source file to keep this already large
// operational schema navigable. They are still part of the one Drizzle schema.
export * from "./erp-schema";
export type CashRegisterRecord = typeof cashRegisters.$inferSelect;
export type CashierShiftRecord = typeof cashierShifts.$inferSelect;
export type CashDrawerMovementRecord = typeof cashDrawerMovements.$inferSelect;
export type PrinterAgentRecord = typeof printerAgents.$inferSelect;
export type RestaurantPrinterRecord = typeof restaurantPrinters.$inferSelect;
export type PrinterRouteRecord = typeof printerRoutes.$inferSelect;
export type PrintJobRecord = typeof printJobs.$inferSelect;
export type PrintJobAttemptRecord = typeof printJobAttempts.$inferSelect;
