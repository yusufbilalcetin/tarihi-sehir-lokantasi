import { relations } from "drizzle-orm";

import {
  auditLogs,
  apiRateLimits,
  categories,
  categoryTranslations,
  idempotencyKeys,
  kitchenTickets,
  orderEvents,
  orderItems,
  orders,
  outboxEvents,
  payments,
  products,
  productTranslations,
  restaurantCounters,
  restaurantSettings,
  restaurants,
  restaurantTables,
  staffProfiles,
  waiterCalls,
} from "./schema";

// Imported deliberately so the table participates in the unified Drizzle
// schema; it has no tenant relation because all persisted keys are one-way
// HMAC digests and expire quickly.
void apiRateLimits;

export const restaurantsRelations = relations(restaurants, ({ many, one }) => ({
  staffProfiles: many(staffProfiles),
  categories: many(categories),
  categoryTranslations: many(categoryTranslations),
  products: many(products),
  productTranslations: many(productTranslations),
  tables: many(restaurantTables),
  orders: many(orders),
  orderItems: many(orderItems),
  kitchenTickets: many(kitchenTickets),
  waiterCalls: many(waiterCalls),
  orderEvents: many(orderEvents),
  payments: many(payments),
  counters: many(restaurantCounters),
  auditLogs: many(auditLogs),
  outboxEvents: many(outboxEvents),
  idempotencyKeys: many(idempotencyKeys),
  settings: one(restaurantSettings),
}));

export const staffProfilesRelations = relations(
  staffProfiles,
  ({ many, one }) => ({
    restaurant: one(restaurants, {
      fields: [staffProfiles.restaurantId],
      references: [restaurants.id],
    }),
    createdOrders: many(orders, { relationName: "orderCreator" }),
    acknowledgedCalls: many(waiterCalls, {
      relationName: "callAcknowledger",
    }),
    resolvedCalls: many(waiterCalls, { relationName: "callResolver" }),
    orderEvents: many(orderEvents, { relationName: "orderEventActor" }),
    payments: many(payments, { relationName: "paymentCreator" }),
    auditLogs: many(auditLogs, { relationName: "auditActor" }),
  }),
);

export const categoriesRelations = relations(categories, ({ many, one }) => ({
  restaurant: one(restaurants, {
    fields: [categories.restaurantId],
    references: [restaurants.id],
  }),
  products: many(products),
  translations: many(categoryTranslations),
}));

export const categoryTranslationsRelations = relations(
  categoryTranslations,
  ({ one }) => ({
    restaurant: one(restaurants, {
      fields: [categoryTranslations.restaurantId],
      references: [restaurants.id],
    }),
    category: one(categories, {
      fields: [categoryTranslations.restaurantId, categoryTranslations.categoryId],
      references: [categories.restaurantId, categories.id],
    }),
  }),
);

export const productsRelations = relations(products, ({ many, one }) => ({
  restaurant: one(restaurants, {
    fields: [products.restaurantId],
    references: [restaurants.id],
  }),
  category: one(categories, {
    fields: [products.restaurantId, products.categoryId],
    references: [categories.restaurantId, categories.id],
  }),
  orderItems: many(orderItems),
  translations: many(productTranslations),
}));

export const productTranslationsRelations = relations(
  productTranslations,
  ({ one }) => ({
    restaurant: one(restaurants, {
      fields: [productTranslations.restaurantId],
      references: [restaurants.id],
    }),
    product: one(products, {
      fields: [productTranslations.restaurantId, productTranslations.productId],
      references: [products.restaurantId, products.id],
    }),
  }),
);

export const restaurantTablesRelations = relations(
  restaurantTables,
  ({ many, one }) => ({
    restaurant: one(restaurants, {
      fields: [restaurantTables.restaurantId],
      references: [restaurants.id],
    }),
    orders: many(orders),
    waiterCalls: many(waiterCalls),
  }),
);

export const restaurantCountersRelations = relations(
  restaurantCounters,
  ({ one }) => ({
    restaurant: one(restaurants, {
      fields: [restaurantCounters.restaurantId],
      references: [restaurants.id],
    }),
  }),
);

export const ordersRelations = relations(orders, ({ many, one }) => ({
  restaurant: one(restaurants, {
    fields: [orders.restaurantId],
    references: [restaurants.id],
  }),
  table: one(restaurantTables, {
    fields: [orders.restaurantId, orders.tableId],
    references: [restaurantTables.restaurantId, restaurantTables.id],
  }),
  creator: one(staffProfiles, {
    fields: [orders.restaurantId, orders.createdByUserId],
    references: [staffProfiles.restaurantId, staffProfiles.id],
    relationName: "orderCreator",
  }),
  items: many(orderItems),
  events: many(orderEvents),
  payments: many(payments),
  kitchenTicket: one(kitchenTickets),
}));

export const orderItemsRelations = relations(orderItems, ({ one }) => ({
  restaurant: one(restaurants, {
    fields: [orderItems.restaurantId],
    references: [restaurants.id],
  }),
  order: one(orders, {
    fields: [orderItems.restaurantId, orderItems.orderId],
    references: [orders.restaurantId, orders.id],
  }),
  product: one(products, {
    fields: [orderItems.restaurantId, orderItems.productId],
    references: [products.restaurantId, products.id],
  }),
}));

export const kitchenTicketsRelations = relations(kitchenTickets, ({ one }) => ({
  restaurant: one(restaurants, {
    fields: [kitchenTickets.restaurantId],
    references: [restaurants.id],
  }),
  order: one(orders, {
    fields: [kitchenTickets.restaurantId, kitchenTickets.orderId],
    references: [orders.restaurantId, orders.id],
  }),
}));

export const waiterCallsRelations = relations(waiterCalls, ({ one }) => ({
  restaurant: one(restaurants, {
    fields: [waiterCalls.restaurantId],
    references: [restaurants.id],
  }),
  table: one(restaurantTables, {
    fields: [waiterCalls.restaurantId, waiterCalls.tableId],
    references: [restaurantTables.restaurantId, restaurantTables.id],
  }),
  acknowledgedByProfile: one(staffProfiles, {
    fields: [waiterCalls.restaurantId, waiterCalls.acknowledgedBy],
    references: [staffProfiles.restaurantId, staffProfiles.id],
    relationName: "callAcknowledger",
  }),
  resolvedByProfile: one(staffProfiles, {
    fields: [waiterCalls.restaurantId, waiterCalls.resolvedBy],
    references: [staffProfiles.restaurantId, staffProfiles.id],
    relationName: "callResolver",
  }),
}));

export const orderEventsRelations = relations(orderEvents, ({ one }) => ({
  restaurant: one(restaurants, {
    fields: [orderEvents.restaurantId],
    references: [restaurants.id],
  }),
  order: one(orders, {
    fields: [orderEvents.restaurantId, orderEvents.orderId],
    references: [orders.restaurantId, orders.id],
  }),
  actor: one(staffProfiles, {
    fields: [orderEvents.restaurantId, orderEvents.userId],
    references: [staffProfiles.restaurantId, staffProfiles.id],
    relationName: "orderEventActor",
  }),
}));

export const paymentsRelations = relations(payments, ({ one }) => ({
  restaurant: one(restaurants, {
    fields: [payments.restaurantId],
    references: [restaurants.id],
  }),
  order: one(orders, {
    fields: [payments.restaurantId, payments.orderId],
    references: [orders.restaurantId, orders.id],
  }),
  creator: one(staffProfiles, {
    fields: [payments.restaurantId, payments.createdByUserId],
    references: [staffProfiles.restaurantId, staffProfiles.id],
    relationName: "paymentCreator",
  }),
}));

export const restaurantSettingsRelations = relations(
  restaurantSettings,
  ({ one }) => ({
    restaurant: one(restaurants, {
      fields: [restaurantSettings.restaurantId],
      references: [restaurants.id],
    }),
  }),
);

export const auditLogsRelations = relations(auditLogs, ({ one }) => ({
  restaurant: one(restaurants, {
    fields: [auditLogs.restaurantId],
    references: [restaurants.id],
  }),
  actor: one(staffProfiles, {
    fields: [auditLogs.restaurantId, auditLogs.actorUserId],
    references: [staffProfiles.restaurantId, staffProfiles.id],
    relationName: "auditActor",
  }),
}));

export const outboxEventsRelations = relations(outboxEvents, ({ one }) => ({
  restaurant: one(restaurants, {
    fields: [outboxEvents.restaurantId],
    references: [restaurants.id],
  }),
}));

export const idempotencyKeysRelations = relations(
  idempotencyKeys,
  ({ one }) => ({
    restaurant: one(restaurants, {
      fields: [idempotencyKeys.restaurantId],
      references: [restaurants.id],
    }),
  }),
);
