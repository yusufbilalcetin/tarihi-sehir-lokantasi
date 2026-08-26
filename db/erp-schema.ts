import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

const createdAt = () => timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull();
const updatedAt = () => timestamp("updated_at", { withTimezone: true, mode: "date" }).defaultNow().notNull();
const quantity = (name: string) => numeric(name, { precision: 18, scale: 6 }).notNull();
const money = (name: string) => numeric(name, { precision: 14, scale: 2 }).notNull();

export const inventoryUnitEnum = pgEnum("inventory_unit", ["MG", "G", "KG", "ML", "L", "UNIT", "PACKAGE", "CASE"]);
export const negativeStockPolicyEnum = pgEnum("negative_stock_policy", ["WARN", "BLOCK"]);
export const stockMovementTypeEnum = pgEnum("stock_movement_type", ["PURCHASE_RECEIPT", "PRODUCTION_CONSUMPTION", "MANUAL_ADJUSTMENT", "WASTE", "STAFF_MEAL", "COMPLIMENTARY", "TRANSFER_IN", "TRANSFER_OUT", "COUNT_CORRECTION", "RETURN_TO_SUPPLIER"]);
export const stockCountStatusEnum = pgEnum("stock_count_status", ["DRAFT", "COMPLETED", "CANCELLED"]);
export const recipeStatusEnum = pgEnum("recipe_status", ["DRAFT", "ACTIVE", "RETIRED"]);
export const productionStatusEnum = pgEnum("production_status", ["PLANNED", "IN_PROGRESS", "COMPLETED", "CANCELLED"]);
export const wasteTypeEnum = pgEnum("waste_type", ["SPOILAGE", "SPILL", "PREPARATION_WASTE", "STAFF_MEAL", "COMPLIMENTARY", "OTHER"]);
export const purchaseOrderStatusEnum = pgEnum("purchase_order_status", ["DRAFT", "SENT", "PARTIALLY_RECEIVED", "RECEIVED", "CANCELLED"]);
export const supplierInvoiceStatusEnum = pgEnum("supplier_invoice_status", ["OPEN", "PARTIALLY_PAID", "PAID", "CANCELLED"]);
export const supplierPaymentMethodEnum = pgEnum("supplier_payment_method", ["BANK", "CASH", "OTHER"]);
export const attendanceStatusEnum = pgEnum("attendance_status", ["OPEN", "COMPLETED", "CORRECTED"]);
export const scheduleStatusEnum = pgEnum("schedule_status", ["PLANNED", "CONFIRMED", "COMPLETED", "CANCELLED"]);
export const payrollStatusEnum = pgEnum("payroll_status", ["DRAFT", "APPROVED", "PAID", "CANCELLED"]);
export const feedbackStatusEnum = pgEnum("feedback_status", ["NEW", "REVIEWED", "HIDDEN"]);
export const reservationStatusEnum = pgEnum("reservation_status", ["PENDING", "CONFIRMED", "SEATED", "COMPLETED", "CANCELLED", "NO_SHOW"]);
export const orderChannelEnum = pgEnum("order_channel", ["DINE_IN", "TAKEAWAY", "DELIVERY"]);
export const fulfillmentStatusEnum = pgEnum("fulfillment_status", ["DRAFT", "PLACED", "WAITING_FOR_COURIER", "OUT_FOR_DELIVERY", "DELIVERED", "CANCELLED"]);
export const loyaltyEntryTypeEnum = pgEnum("loyalty_entry_type", ["EARN", "REDEEM", "ADJUST", "EXPIRE"]);
export const integrationKindEnum = pgEnum("integration_kind", ["PAYMENT_TERMINAL", "FISCAL_DOCUMENT", "FISCAL_DEVICE", "ACCOUNTING", "DELIVERY_PROVIDER"]);
export const externalTransactionStatusEnum = pgEnum("external_transaction_status", ["PENDING", "PROCESSING", "SUCCEEDED", "FAILED", "CANCELLED"]);

export const warehouses = pgTable("warehouses", {
  id: uuid("id").defaultRandom().primaryKey(), restaurantId: uuid("restaurant_id").notNull(),
  name: varchar("name", { length: 120 }).notNull(), code: varchar("code", { length: 40 }).notNull(),
  isActive: boolean("is_active").default(true).notNull(), createdAt: createdAt(), updatedAt: updatedAt(),
}, (t) => [unique("warehouses_restaurant_id_id_key").on(t.restaurantId, t.id), unique("warehouses_restaurant_code_key").on(t.restaurantId, t.code), index("warehouses_restaurant_active_idx").on(t.restaurantId, t.isActive)]);

export const inventoryItems = pgTable("inventory_items", {
  id: uuid("id").defaultRandom().primaryKey(), restaurantId: uuid("restaurant_id").notNull(),
  name: varchar("name", { length: 160 }).notNull(), category: varchar("category", { length: 80 }),
  baseUnit: inventoryUnitEnum("base_unit").notNull(), reorderLevel: quantity("reorder_level").default("0"),
  negativeStockPolicy: negativeStockPolicyEnum("negative_stock_policy").default("WARN").notNull(),
  isActive: boolean("is_active").default(true).notNull(), createdAt: createdAt(), updatedAt: updatedAt(),
}, (t) => [unique("inventory_items_restaurant_id_id_key").on(t.restaurantId, t.id), uniqueIndex("inventory_items_restaurant_name_key").on(t.restaurantId, sql`lower(${t.name})`), index("inventory_items_restaurant_active_idx").on(t.restaurantId, t.isActive), check("inventory_items_reorder_level_check", sql`${t.reorderLevel} >= 0`)]);

export const stockMovements = pgTable("stock_movements", {
  id: uuid("id").defaultRandom().primaryKey(), restaurantId: uuid("restaurant_id").notNull(), inventoryItemId: uuid("inventory_item_id").notNull(), warehouseId: uuid("warehouse_id").notNull(),
  movementType: stockMovementTypeEnum("movement_type").notNull(), quantityDelta: quantity("quantity_delta"), unitCost: numeric("unit_cost", { precision: 18, scale: 6 }),
  sourceType: varchar("source_type", { length: 50 }).notNull(), sourceId: uuid("source_id"), idempotencyKey: varchar("idempotency_key", { length: 160 }),
  reason: varchar("reason", { length: 300 }), actorStaffId: uuid("actor_staff_id"), occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(), createdAt: createdAt(),
}, (t) => [unique("stock_movements_restaurant_id_id_key").on(t.restaurantId, t.id), uniqueIndex("stock_movements_restaurant_idempotency_key").on(t.restaurantId, t.idempotencyKey).where(sql`${t.idempotencyKey} is not null`), index("stock_movements_item_warehouse_created_idx").on(t.restaurantId, t.inventoryItemId, t.warehouseId, t.occurredAt), index("stock_movements_restaurant_occurred_idx").on(t.restaurantId, t.occurredAt.desc()), check("stock_movements_non_zero_check", sql`${t.quantityDelta} <> 0`), check("stock_movements_unit_cost_check", sql`${t.unitCost} is null or ${t.unitCost} >= 0`)]);

export const stockCounts = pgTable("stock_counts", {
  id: uuid("id").defaultRandom().primaryKey(), restaurantId: uuid("restaurant_id").notNull(), warehouseId: uuid("warehouse_id").notNull(),
  status: stockCountStatusEnum("status").default("DRAFT").notNull(), countedByStaffId: uuid("counted_by_staff_id").notNull(), completedAt: timestamp("completed_at", { withTimezone: true, mode: "date" }), createdAt: createdAt(), updatedAt: updatedAt(),
}, (t) => [unique("stock_counts_restaurant_id_id_key").on(t.restaurantId, t.id), index("stock_counts_restaurant_warehouse_created_idx").on(t.restaurantId, t.warehouseId, t.createdAt)]);

export const stockCountLines = pgTable("stock_count_lines", {
  id: uuid("id").defaultRandom().primaryKey(), restaurantId: uuid("restaurant_id").notNull(), stockCountId: uuid("stock_count_id").notNull(), inventoryItemId: uuid("inventory_item_id").notNull(),
  expectedQuantity: quantity("expected_quantity"), countedQuantity: quantity("counted_quantity"), varianceQuantity: quantity("variance_quantity"), createdAt: createdAt(),
}, (t) => [unique("stock_count_lines_count_item_key").on(t.stockCountId, t.inventoryItemId), index("stock_count_lines_restaurant_count_idx").on(t.restaurantId, t.stockCountId)]);

export const recipeVersions = pgTable("recipe_versions", {
  id: uuid("id").defaultRandom().primaryKey(), restaurantId: uuid("restaurant_id").notNull(), productId: uuid("product_id").notNull(), version: integer("version").notNull(),
  status: recipeStatusEnum("status").default("DRAFT").notNull(), yieldPortions: quantity("yield_portions"), effectiveFrom: timestamp("effective_from", { withTimezone: true, mode: "date" }), effectiveTo: timestamp("effective_to", { withTimezone: true, mode: "date" }), createdByStaffId: uuid("created_by_staff_id").notNull(), createdAt: createdAt(), updatedAt: updatedAt(),
}, (t) => [unique("recipe_versions_product_version_key").on(t.restaurantId, t.productId, t.version), uniqueIndex("recipe_versions_one_active_product_key").on(t.restaurantId, t.productId).where(sql`${t.status} = 'ACTIVE'`), index("recipe_versions_restaurant_effective_idx").on(t.restaurantId, t.effectiveFrom), check("recipe_versions_yield_check", sql`${t.yieldPortions} > 0`), check("recipe_versions_period_check", sql`${t.effectiveTo} is null or ${t.effectiveFrom} is null or ${t.effectiveTo} > ${t.effectiveFrom}`)]);

export const recipeIngredients = pgTable("recipe_ingredients", {
  id: uuid("id").defaultRandom().primaryKey(), restaurantId: uuid("restaurant_id").notNull(), recipeVersionId: uuid("recipe_version_id").notNull(), inventoryItemId: uuid("inventory_item_id").notNull(), quantity: quantity("quantity"), unit: inventoryUnitEnum("unit").notNull(), createdAt: createdAt(),
}, (t) => [unique("recipe_ingredients_recipe_item_key").on(t.recipeVersionId, t.inventoryItemId), index("recipe_ingredients_restaurant_recipe_idx").on(t.restaurantId, t.recipeVersionId), check("recipe_ingredients_quantity_check", sql`${t.quantity} > 0`)]);

export const productionBatches = pgTable("production_batches", {
  id: uuid("id").defaultRandom().primaryKey(), restaurantId: uuid("restaurant_id").notNull(), productId: uuid("product_id").notNull(), recipeVersionId: uuid("recipe_version_id").notNull(), warehouseId: uuid("warehouse_id").notNull(), businessDate: date("business_date", { mode: "string" }).notNull(),
  plannedPortions: quantity("planned_portions"), actualPortions: quantity("actual_portions").default("0"), soldPortions: quantity("sold_portions").default("0"), wastePortions: quantity("waste_portions").default("0"),
  status: productionStatusEnum("status").default("PLANNED").notNull(), producedByStaffId: uuid("produced_by_staff_id"), consumptionPostedAt: timestamp("consumption_posted_at", { withTimezone: true, mode: "date" }), idempotencyKey: varchar("idempotency_key", { length: 160 }).notNull(), createdAt: createdAt(), updatedAt: updatedAt(),
}, (t) => [unique("production_batches_restaurant_id_id_key").on(t.restaurantId, t.id), unique("production_batches_restaurant_idempotency_key").on(t.restaurantId, t.idempotencyKey), index("production_batches_restaurant_date_status_idx").on(t.restaurantId, t.businessDate, t.status), check("production_batches_quantities_check", sql`${t.plannedPortions} >= 0 and ${t.actualPortions} >= 0 and ${t.soldPortions} >= 0 and ${t.wastePortions} >= 0`)]);

export const wasteRecords = pgTable("waste_records", {
  id: uuid("id").defaultRandom().primaryKey(), restaurantId: uuid("restaurant_id").notNull(), warehouseId: uuid("warehouse_id").notNull(), inventoryItemId: uuid("inventory_item_id"), productionBatchId: uuid("production_batch_id"),
  wasteType: wasteTypeEnum("waste_type").notNull(), quantity: quantity("quantity"), unit: inventoryUnitEnum("unit").notNull(), estimatedCost: money("estimated_cost").default("0"), reason: varchar("reason", { length: 300 }).notNull(), recordedByStaffId: uuid("recorded_by_staff_id").notNull(), occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(), idempotencyKey: varchar("idempotency_key", { length: 160 }).notNull(), createdAt: createdAt(),
}, (t) => [unique("waste_records_restaurant_idempotency_key").on(t.restaurantId, t.idempotencyKey), index("waste_records_restaurant_occurred_idx").on(t.restaurantId, t.occurredAt), check("waste_records_quantity_check", sql`${t.quantity} > 0`), check("waste_records_source_check", sql`${t.inventoryItemId} is not null or ${t.productionBatchId} is not null`)]);

export const suppliers = pgTable("suppliers", {
  id: uuid("id").defaultRandom().primaryKey(), restaurantId: uuid("restaurant_id").notNull(), name: varchar("name", { length: 180 }).notNull(), contactPerson: varchar("contact_person", { length: 160 }), phone: varchar("phone", { length: 40 }), email: varchar("email", { length: 254 }), notes: text("notes"), isActive: boolean("is_active").default(true).notNull(), createdAt: createdAt(), updatedAt: updatedAt(),
}, (t) => [unique("suppliers_restaurant_id_id_key").on(t.restaurantId, t.id), uniqueIndex("suppliers_restaurant_name_key").on(t.restaurantId, sql`lower(${t.name})`), index("suppliers_restaurant_active_idx").on(t.restaurantId, t.isActive)]);

export const supplierItems = pgTable("supplier_items", {
  id: uuid("id").defaultRandom().primaryKey(), restaurantId: uuid("restaurant_id").notNull(), supplierId: uuid("supplier_id").notNull(), inventoryItemId: uuid("inventory_item_id").notNull(), supplierItemCode: varchar("supplier_item_code", { length: 80 }), packQuantity: quantity("pack_quantity"), packUnit: inventoryUnitEnum("pack_unit").notNull(), lastUnitPrice: money("last_unit_price").default("0"), leadTimeDays: smallint("lead_time_days"), isActive: boolean("is_active").default(true).notNull(), createdAt: createdAt(), updatedAt: updatedAt(),
}, (t) => [unique("supplier_items_supplier_inventory_key").on(t.supplierId, t.inventoryItemId), index("supplier_items_restaurant_inventory_idx").on(t.restaurantId, t.inventoryItemId), check("supplier_items_pack_check", sql`${t.packQuantity} > 0`), check("supplier_items_lead_time_check", sql`${t.leadTimeDays} is null or ${t.leadTimeDays} >= 0`)]);

export const purchaseOrders = pgTable("purchase_orders", {
  id: uuid("id").defaultRandom().primaryKey(), restaurantId: uuid("restaurant_id").notNull(), supplierId: uuid("supplier_id").notNull(), orderNumber: varchar("order_number", { length: 40 }).notNull(), status: purchaseOrderStatusEnum("status").default("DRAFT").notNull(), expectedAt: timestamp("expected_at", { withTimezone: true, mode: "date" }), notes: text("notes"), createdByStaffId: uuid("created_by_staff_id").notNull(), sentAt: timestamp("sent_at", { withTimezone: true, mode: "date" }), cancelledAt: timestamp("cancelled_at", { withTimezone: true, mode: "date" }), createdAt: createdAt(), updatedAt: updatedAt(),
}, (t) => [unique("purchase_orders_restaurant_number_key").on(t.restaurantId, t.orderNumber), index("purchase_orders_restaurant_status_created_idx").on(t.restaurantId, t.status, t.createdAt)]);

export const purchaseOrderItems = pgTable("purchase_order_items", {
  id: uuid("id").defaultRandom().primaryKey(), restaurantId: uuid("restaurant_id").notNull(), purchaseOrderId: uuid("purchase_order_id").notNull(), inventoryItemId: uuid("inventory_item_id").notNull(), orderedQuantity: quantity("ordered_quantity"), receivedQuantity: quantity("received_quantity").default("0"), unit: inventoryUnitEnum("unit").notNull(), unitPrice: money("unit_price"), lineTotal: money("line_total"), createdAt: createdAt(), updatedAt: updatedAt(),
}, (t) => [unique("purchase_order_items_order_item_key").on(t.purchaseOrderId, t.inventoryItemId), index("purchase_order_items_restaurant_order_idx").on(t.restaurantId, t.purchaseOrderId), check("purchase_order_items_qty_check", sql`${t.orderedQuantity} > 0 and ${t.receivedQuantity} >= 0 and ${t.receivedQuantity} <= ${t.orderedQuantity}`), check("purchase_order_items_total_check", sql`${t.lineTotal} = round(${t.orderedQuantity} * ${t.unitPrice}, 2)`)]);

export const goodsReceipts = pgTable("goods_receipts", {
  id: uuid("id").defaultRandom().primaryKey(), restaurantId: uuid("restaurant_id").notNull(), purchaseOrderId: uuid("purchase_order_id").notNull(), supplierId: uuid("supplier_id").notNull(), warehouseId: uuid("warehouse_id").notNull(), receiptNumber: varchar("receipt_number", { length: 60 }).notNull(), receivedByStaffId: uuid("received_by_staff_id").notNull(), idempotencyKey: varchar("idempotency_key", { length: 160 }).notNull(), receivedAt: timestamp("received_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(), createdAt: createdAt(),
}, (t) => [unique("goods_receipts_restaurant_number_key").on(t.restaurantId, t.receiptNumber), unique("goods_receipts_restaurant_idempotency_key").on(t.restaurantId, t.idempotencyKey), index("goods_receipts_restaurant_po_idx").on(t.restaurantId, t.purchaseOrderId)]);

export const goodsReceiptItems = pgTable("goods_receipt_items", {
  id: uuid("id").defaultRandom().primaryKey(), restaurantId: uuid("restaurant_id").notNull(), goodsReceiptId: uuid("goods_receipt_id").notNull(), purchaseOrderItemId: uuid("purchase_order_item_id").notNull(), inventoryItemId: uuid("inventory_item_id").notNull(), receivedQuantity: quantity("received_quantity"), unit: inventoryUnitEnum("unit").notNull(), unitPrice: money("unit_price"), createdAt: createdAt(),
}, (t) => [unique("goods_receipt_items_receipt_po_item_key").on(t.goodsReceiptId, t.purchaseOrderItemId), index("goods_receipt_items_restaurant_inventory_created_idx").on(t.restaurantId, t.inventoryItemId, t.createdAt), check("goods_receipt_items_qty_check", sql`${t.receivedQuantity} > 0`)]);

export const supplierInvoices = pgTable("supplier_invoices", {
  id: uuid("id").defaultRandom().primaryKey(), restaurantId: uuid("restaurant_id").notNull(), supplierId: uuid("supplier_id").notNull(), goodsReceiptId: uuid("goods_receipt_id"), invoiceNumber: varchar("invoice_number", { length: 80 }).notNull(), total: money("total"), paidTotal: money("paid_total").default("0"), dueDate: date("due_date", { mode: "string" }), status: supplierInvoiceStatusEnum("status").default("OPEN").notNull(), createdAt: createdAt(), updatedAt: updatedAt(),
}, (t) => [unique("supplier_invoices_restaurant_number_key").on(t.restaurantId, t.invoiceNumber), index("supplier_invoices_restaurant_supplier_status_idx").on(t.restaurantId, t.supplierId, t.status), check("supplier_invoices_paid_check", sql`${t.paidTotal} >= 0 and ${t.paidTotal} <= ${t.total}`)]);

export const supplierPayments = pgTable("supplier_payments", {
  id: uuid("id").defaultRandom().primaryKey(), restaurantId: uuid("restaurant_id").notNull(), supplierId: uuid("supplier_id").notNull(), supplierInvoiceId: uuid("supplier_invoice_id").notNull(), amount: money("amount"), method: supplierPaymentMethodEnum("method").notNull(), reference: varchar("reference", { length: 100 }), idempotencyKey: varchar("idempotency_key", { length: 160 }).notNull(), paidByStaffId: uuid("paid_by_staff_id").notNull(), paidAt: timestamp("paid_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(), createdAt: createdAt(),
}, (t) => [unique("supplier_payments_restaurant_idempotency_key").on(t.restaurantId, t.idempotencyKey), index("supplier_payments_restaurant_invoice_idx").on(t.restaurantId, t.supplierInvoiceId), check("supplier_payments_amount_check", sql`${t.amount} > 0`)]);

export const attendanceRecords = pgTable("attendance_records", {
  id: uuid("id").defaultRandom().primaryKey(), restaurantId: uuid("restaurant_id").notNull(), staffId: uuid("staff_id").notNull(), businessDate: date("business_date", { mode: "string" }).notNull(), clockInAt: timestamp("clock_in_at", { withTimezone: true, mode: "date" }).notNull(), clockOutAt: timestamp("clock_out_at", { withTimezone: true, mode: "date" }), breakMinutes: integer("break_minutes").default(0).notNull(), status: attendanceStatusEnum("status").default("OPEN").notNull(), correctionReason: varchar("correction_reason", { length: 300 }), correctedByStaffId: uuid("corrected_by_staff_id"), createdAt: createdAt(), updatedAt: updatedAt(),
}, (t) => [uniqueIndex("attendance_records_one_open_staff_key").on(t.restaurantId, t.staffId).where(sql`${t.status} = 'OPEN'`), index("attendance_records_restaurant_date_idx").on(t.restaurantId, t.businessDate), check("attendance_records_time_check", sql`${t.clockOutAt} is null or ${t.clockOutAt} > ${t.clockInAt}`), check("attendance_records_break_check", sql`${t.breakMinutes} >= 0`)]);

export const staffSchedules = pgTable("staff_schedules", {
  id: uuid("id").defaultRandom().primaryKey(), restaurantId: uuid("restaurant_id").notNull(), staffId: uuid("staff_id").notNull(), startsAt: timestamp("starts_at", { withTimezone: true, mode: "date" }).notNull(), endsAt: timestamp("ends_at", { withTimezone: true, mode: "date" }).notNull(), roleLabel: varchar("role_label", { length: 80 }), locationLabel: varchar("location_label", { length: 120 }), notes: varchar("notes", { length: 300 }), status: scheduleStatusEnum("status").default("PLANNED").notNull(), createdByStaffId: uuid("created_by_staff_id").notNull(), createdAt: createdAt(), updatedAt: updatedAt(),
}, (t) => [index("staff_schedules_restaurant_staff_time_idx").on(t.restaurantId, t.staffId, t.startsAt), check("staff_schedules_time_check", sql`${t.endsAt} > ${t.startsAt}`)]);

export const payrollEntries = pgTable("payroll_entries", {
  id: uuid("id").defaultRandom().primaryKey(), restaurantId: uuid("restaurant_id").notNull(), staffId: uuid("staff_id").notNull(), periodStart: date("period_start", { mode: "string" }).notNull(), periodEnd: date("period_end", { mode: "string" }).notNull(), workedMinutes: integer("worked_minutes").default(0).notNull(), overtimeMinutes: integer("overtime_minutes").default(0).notNull(), grossSalary: money("gross_salary"), allowances: money("allowances").default("0"), deductions: money("deductions").default("0"), netPayable: money("net_payable"), status: payrollStatusEnum("status").default("DRAFT").notNull(), correctionReason: varchar("correction_reason", { length: 300 }), approvedByStaffId: uuid("approved_by_staff_id"), createdAt: createdAt(), updatedAt: updatedAt(),
}, (t) => [unique("payroll_entries_staff_period_key").on(t.restaurantId, t.staffId, t.periodStart, t.periodEnd), index("payroll_entries_restaurant_period_idx").on(t.restaurantId, t.periodStart, t.status), check("payroll_entries_period_check", sql`${t.periodEnd} >= ${t.periodStart}`), check("payroll_entries_minutes_check", sql`${t.workedMinutes} >= 0 and ${t.overtimeMinutes} >= 0`), check("payroll_entries_total_check", sql`${t.netPayable} = ${t.grossSalary} + ${t.allowances} - ${t.deductions}`)]);

export const customerFeedback = pgTable("customer_feedback", {
  id: uuid("id").defaultRandom().primaryKey(), restaurantId: uuid("restaurant_id").notNull(), orderId: uuid("order_id"), tableId: uuid("table_id"), sessionFingerprintHash: varchar("session_fingerprint_hash", { length: 80 }).notNull(), rating: smallint("rating").notNull(), foodRating: smallint("food_rating"), serviceRating: smallint("service_rating"), cleanlinessRating: smallint("cleanliness_rating"), comment: varchar("comment", { length: 1000 }), status: feedbackStatusEnum("status").default("NEW").notNull(), reviewedByStaffId: uuid("reviewed_by_staff_id"), createdAt: createdAt(), updatedAt: updatedAt(),
}, (t) => [uniqueIndex("customer_feedback_session_order_key").on(t.restaurantId, t.sessionFingerprintHash, t.orderId).where(sql`${t.orderId} is not null`), index("customer_feedback_restaurant_rating_created_idx").on(t.restaurantId, t.rating, t.createdAt), check("customer_feedback_rating_check", sql`${t.rating} between 1 and 5 and (${t.foodRating} is null or ${t.foodRating} between 1 and 5) and (${t.serviceRating} is null or ${t.serviceRating} between 1 and 5) and (${t.cleanlinessRating} is null or ${t.cleanlinessRating} between 1 and 5)`)]);

export const reservations = pgTable("reservations", {
  id: uuid("id").defaultRandom().primaryKey(), restaurantId: uuid("restaurant_id").notNull(), tableId: uuid("table_id"), customerName: varchar("customer_name", { length: 160 }).notNull(), phone: varchar("phone", { length: 40 }).notNull(), partySize: smallint("party_size").notNull(), startsAt: timestamp("starts_at", { withTimezone: true, mode: "date" }).notNull(), endsAt: timestamp("ends_at", { withTimezone: true, mode: "date" }).notNull(), status: reservationStatusEnum("status").default("PENDING").notNull(), notes: varchar("notes", { length: 500 }), createdByStaffId: uuid("created_by_staff_id"), createdAt: createdAt(), updatedAt: updatedAt(),
}, (t) => [index("reservations_restaurant_time_status_idx").on(t.restaurantId, t.startsAt, t.status), index("reservations_restaurant_table_time_idx").on(t.restaurantId, t.tableId, t.startsAt), check("reservations_party_check", sql`${t.partySize} between 1 and 100`), check("reservations_time_check", sql`${t.endsAt} > ${t.startsAt}`)]);

export const fulfillmentRequests = pgTable("fulfillment_requests", {
  id: uuid("id").defaultRandom().primaryKey(), restaurantId: uuid("restaurant_id").notNull(), orderId: uuid("order_id"), channel: orderChannelEnum("channel").notNull(), status: fulfillmentStatusEnum("status").default("DRAFT").notNull(), customerName: varchar("customer_name", { length: 160 }).notNull(), contact: varchar("contact", { length: 80 }).notNull(), address: text("address"), deliveryNotes: varchar("delivery_notes", { length: 500 }), requestedAt: timestamp("requested_at", { withTimezone: true, mode: "date" }), deliveryFee: money("delivery_fee").default("0"), courierStaffId: uuid("courier_staff_id"), idempotencyKey: varchar("idempotency_key", { length: 160 }).notNull(), createdAt: createdAt(), updatedAt: updatedAt(),
}, (t) => [unique("fulfillment_requests_restaurant_id_id_key").on(t.restaurantId, t.id), unique("fulfillment_requests_restaurant_idempotency_key").on(t.restaurantId, t.idempotencyKey), uniqueIndex("fulfillment_requests_order_key").on(t.restaurantId, t.orderId).where(sql`${t.orderId} is not null`), index("fulfillment_requests_restaurant_channel_status_idx").on(t.restaurantId, t.channel, t.status), check("fulfillment_requests_channel_check", sql`(${t.channel} = 'TAKEAWAY' and ${t.address} is null) or (${t.channel} = 'DELIVERY' and length(btrim(${t.address})) > 0)`), check("fulfillment_requests_fee_check", sql`${t.deliveryFee} >= 0`)]);

export const fulfillmentRequestItems = pgTable("fulfillment_request_items", {
  id: uuid("id").defaultRandom().primaryKey(), restaurantId: uuid("restaurant_id").notNull(), fulfillmentRequestId: uuid("fulfillment_request_id").notNull(), productId: uuid("product_id").notNull(),
  productNameSnapshot: varchar("product_name_snapshot", { length: 180 }).notNull(), unitPrice: money("unit_price"), quantity: integer("quantity").notNull(), lineTotal: money("line_total"), notes: varchar("notes", { length: 500 }), createdAt: createdAt(),
}, (t) => [unique("fulfillment_request_items_request_product_key").on(t.fulfillmentRequestId, t.productId), index("fulfillment_request_items_restaurant_request_idx").on(t.restaurantId, t.fulfillmentRequestId), check("fulfillment_request_items_quantity_check", sql`${t.quantity} between 1 and 99`), check("fulfillment_request_items_total_check", sql`${t.lineTotal} = round(${t.unitPrice} * ${t.quantity}, 2)`)]);

export const customerAccounts = pgTable("customer_accounts", {
  id: uuid("id").defaultRandom().primaryKey(), restaurantId: uuid("restaurant_id").notNull(), authUserId: uuid("auth_user_id"), name: varchar("name", { length: 160 }).notNull(), email: varchar("email", { length: 254 }), phone: varchar("phone", { length: 40 }), marketingConsent: boolean("marketing_consent").default(false).notNull(), marketingConsentAt: timestamp("marketing_consent_at", { withTimezone: true, mode: "date" }), isActive: boolean("is_active").default(true).notNull(), createdAt: createdAt(), updatedAt: updatedAt(),
}, (t) => [unique("customer_accounts_restaurant_id_id_key").on(t.restaurantId, t.id), uniqueIndex("customer_accounts_auth_key").on(t.restaurantId, t.authUserId).where(sql`${t.authUserId} is not null`), index("customer_accounts_restaurant_active_idx").on(t.restaurantId, t.isActive), check("customer_accounts_consent_check", sql`not ${t.marketingConsent} or ${t.marketingConsentAt} is not null`)]);

export const customerOrderLinks = pgTable("customer_order_links", {
  restaurantId: uuid("restaurant_id").notNull(), customerAccountId: uuid("customer_account_id").notNull(), orderId: uuid("order_id").notNull(), linkedAt: timestamp("linked_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
}, (t) => [unique("customer_order_links_order_key").on(t.restaurantId, t.orderId), index("customer_order_links_customer_idx").on(t.restaurantId, t.customerAccountId, t.linkedAt)]);

export const loyaltyLedger = pgTable("loyalty_ledger", {
  id: uuid("id").defaultRandom().primaryKey(), restaurantId: uuid("restaurant_id").notNull(), customerAccountId: uuid("customer_account_id").notNull(), orderId: uuid("order_id"), entryType: loyaltyEntryTypeEnum("entry_type").notNull(), points: integer("points").notNull(), reason: varchar("reason", { length: 300 }).notNull(), idempotencyKey: varchar("idempotency_key", { length: 160 }).notNull(), actorStaffId: uuid("actor_staff_id"), expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }), createdAt: createdAt(),
}, (t) => [unique("loyalty_ledger_restaurant_idempotency_key").on(t.restaurantId, t.idempotencyKey), index("loyalty_ledger_customer_created_idx").on(t.restaurantId, t.customerAccountId, t.createdAt), check("loyalty_ledger_points_check", sql`${t.points} > 0`)]);

export const popularProductSnapshots = pgTable("popular_product_snapshots", {
  restaurantId: uuid("restaurant_id").notNull(), productId: uuid("product_id").notNull(), windowDays: smallint("window_days").default(30).notNull(), quantitySold: integer("quantity_sold").notNull(), rank: smallint("rank").notNull(), calculatedAt: timestamp("calculated_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
}, (t) => [unique("popular_product_snapshots_product_key").on(t.restaurantId, t.productId, t.windowDays), index("popular_product_snapshots_restaurant_rank_idx").on(t.restaurantId, t.windowDays, t.rank), check("popular_product_snapshots_values_check", sql`${t.windowDays} between 1 and 366 and ${t.quantitySold} >= 0 and ${t.rank} > 0`)]);

export const integrationConnections = pgTable("integration_connections", {
  id: uuid("id").defaultRandom().primaryKey(), restaurantId: uuid("restaurant_id").notNull(), kind: integrationKindEnum("kind").notNull(), provider: varchar("provider", { length: 80 }).notNull(), displayName: varchar("display_name", { length: 120 }).notNull(), secretReference: varchar("secret_reference", { length: 160 }), isEnabled: boolean("is_enabled").default(false).notNull(), configuration: jsonb("configuration").default(sql`'{}'::jsonb`).notNull(), createdByStaffId: uuid("created_by_staff_id").notNull(), createdAt: createdAt(), updatedAt: updatedAt(),
}, (t) => [unique("integration_connections_restaurant_kind_provider_key").on(t.restaurantId, t.kind, t.provider), index("integration_connections_restaurant_enabled_idx").on(t.restaurantId, t.kind, t.isEnabled), check("integration_connections_secret_reference_check", sql`${t.secretReference} is null or ${t.secretReference} ~ '^[A-Z][A-Z0-9_]{2,159}$'`)]);

export const externalTransactions = pgTable("external_transactions", {
  id: uuid("id").defaultRandom().primaryKey(), restaurantId: uuid("restaurant_id").notNull(), integrationConnectionId: uuid("integration_connection_id").notNull(), operationType: varchar("operation_type", { length: 60 }).notNull(), sourceType: varchar("source_type", { length: 40 }).notNull(), sourceId: uuid("source_id"), amount: numeric("amount", { precision: 14, scale: 2 }), currency: varchar("currency", { length: 3 }), status: externalTransactionStatusEnum("status").default("PENDING").notNull(), providerReference: varchar("provider_reference", { length: 180 }), idempotencyKey: varchar("idempotency_key", { length: 160 }).notNull(), errorCode: varchar("error_code", { length: 60 }), createdAt: createdAt(), updatedAt: updatedAt(),
}, (t) => [unique("external_transactions_restaurant_idempotency_key").on(t.restaurantId, t.idempotencyKey), index("external_transactions_restaurant_status_created_idx").on(t.restaurantId, t.status, t.createdAt), check("external_transactions_amount_check", sql`${t.amount} is null or ${t.amount} >= 0`), check("external_transactions_currency_check", sql`${t.currency} is null or ${t.currency} ~ '^[A-Z]{3}$'`)]);
