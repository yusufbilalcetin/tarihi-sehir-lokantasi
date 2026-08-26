import "server-only";

import { and, asc, count, eq, gt, inArray, lt, notInArray, sql } from "drizzle-orm";

import type { Database } from "@/db";
import {
  auditLogs,
  attendanceRecords,
  customerAccounts,
  fulfillmentRequestItems,
  fulfillmentRequests,
  goodsReceiptItems,
  goodsReceipts,
  inventoryItems,
  orderItems,
  orders,
  popularProductSnapshots,
  productionBatches,
  products,
  purchaseOrderItems,
  purchaseOrders,
  recipeIngredients,
  recipeVersions,
  reservations,
  staffSchedules,
  stockMovements,
  supplierPayments,
  supplierInvoices,
  suppliers,
  wasteRecords,
  warehouses,
} from "@/db/schema";
import { DomainError, validationError } from "@/lib/api/domain-error";
import { convertQuantity, evaluateStockBalance, formatFixedDecimal, parseFixedDecimal, roundRatio } from "@/lib/domain/erp";
import { ERP_UNIT_LABELS } from "@/lib/domain/erp-workspaces";
import { OPEN_ORDER_STATUSES } from "@/lib/domain/status";
import type { ErpOverview, ErpRepository } from "./erp-repository";

/** The dashboard names what needs a decision now; the stock module holds the rest. */
const CRITICAL_STOCK_LIMIT = 12;

function duplicateError(message: string): never {
  throw new DomainError("CONFLICT", message, { httpStatus: 409 });
}

export class DrizzleErpRepository implements ErpRepository {
  constructor(private readonly db: Database) {}

  /**
   * One round trip for the whole dashboard.
   *
   * Eleven statements issued together, none of them per-card and none of them
   * unbounded: the critical-stock list carries its own `count(*) over()` so the
   * warning badge is exact while the rendered list stays capped, and every
   * "today" figure is a single aggregate over a date-bounded predicate rather
   * than a scan the client then adds up.
   */
  async overview(restaurantId: string): Promise<ErpOverview> {
    const today = new Date().toISOString().slice(0, 10);
    const now = new Date();
    // Today as a half-open window on the raw timestamp column. Writing this as
    // `(created_at at time zone 'Europe/Istanbul')::date = today` reads better
    // and is unusable by an index: the planner would cast every row of the
    // restaurant's history. The bounds are computed once, here.
    const dayStart = sql`${today}::date::timestamp at time zone 'Europe/Istanbul'`;
    const dayEnd = sql`(${today}::date + 1)::timestamp at time zone 'Europe/Istanbul'`;
    const [criticalRows, warehouseCount, recipeCount, inventoryCount, supplierCount, productionRows, purchaseRows, invoiceRows, reservationRows, attendanceCount, salesRows, wasteRows] = await Promise.all([
      this.db.execute(sql`
        select i.id::text as id, i.name, i.category, i.base_unit as base_unit,
          coalesce(sum(sm.quantity_delta), 0)::numeric(18,6)::text as current_quantity,
          i.reorder_level::text as reorder_level,
          count(*) over()::int as full_count
        from inventory_items i
        left join stock_movements sm on sm.restaurant_id=i.restaurant_id and sm.inventory_item_id=i.id
        where i.restaurant_id=${restaurantId} and i.is_active
        group by i.id
        having coalesce(sum(sm.quantity_delta), 0) <= i.reorder_level
        order by coalesce(sum(sm.quantity_delta), 0) - i.reorder_level, i.name
        limit ${CRITICAL_STOCK_LIMIT}`),
      this.db.select({ value: count() }).from(warehouses).where(and(eq(warehouses.restaurantId, restaurantId), eq(warehouses.isActive, true))),
      this.db.select({ value: count() }).from(recipeVersions).where(and(eq(recipeVersions.restaurantId, restaurantId), eq(recipeVersions.status, "ACTIVE"))),
      this.db.select({ value: count() }).from(inventoryItems).where(and(eq(inventoryItems.restaurantId, restaurantId), eq(inventoryItems.isActive, true))),
      this.db.select({ value: count() }).from(suppliers).where(and(eq(suppliers.restaurantId, restaurantId), eq(suppliers.isActive, true))),
      this.db.select({
        total: count(),
        incomplete: sql<number>`count(*) filter (where ${productionBatches.status} in ('PLANNED','IN_PROGRESS'))::int`,
      }).from(productionBatches).where(and(eq(productionBatches.restaurantId, restaurantId), eq(productionBatches.businessDate, today), inArray(productionBatches.status, ["PLANNED", "IN_PROGRESS", "COMPLETED"]))),
      this.db.select({
        open: count(),
        pendingReceipt: sql<number>`count(*) filter (where ${purchaseOrders.status} in ('SENT','PARTIALLY_RECEIVED'))::int`,
      }).from(purchaseOrders).where(and(eq(purchaseOrders.restaurantId, restaurantId), inArray(purchaseOrders.status, ["DRAFT", "SENT", "PARTIALLY_RECEIVED"]))),
      this.db.select({ count: count(), balance: sql<string>`coalesce(sum(${supplierInvoices.total} - ${supplierInvoices.paidTotal}), 0)::numeric(14,2)` }).from(supplierInvoices).where(and(eq(supplierInvoices.restaurantId, restaurantId), inArray(supplierInvoices.status, ["OPEN", "PARTIALLY_PAID"]))),
      this.db.select({
        upcoming: count(),
        today: sql<number>`count(*) filter (where ${reservations.startsAt} >= ${dayStart} and ${reservations.startsAt} < ${dayEnd})::int`,
      }).from(reservations).where(and(eq(reservations.restaurantId, restaurantId), gt(reservations.endsAt, now), inArray(reservations.status, ["PENDING", "CONFIRMED"]))),
      this.db.select({ value: count() }).from(attendanceRecords).where(and(eq(attendanceRecords.restaurantId, restaurantId), eq(attendanceRecords.status, "OPEN"))),
      // Same basis as the finance summary: gross sales are SERVED and
      // COMPLETED, so the dashboard and the report never disagree.
      this.db.execute(sql`
        select coalesce(sum(o.total) filter (where o.status in ('SERVED','COMPLETED')), 0)::numeric(14,2)::text as sales,
          count(*) filter (where o.status in ('SERVED','COMPLETED'))::int as order_count,
          count(*) filter (where o.status::text in ${[...OPEN_ORDER_STATUSES]})::int as open_orders
        from orders o
        where o.restaurant_id=${restaurantId}
          and o.created_at >= ${dayStart} and o.created_at < ${dayEnd}`),
      this.db.execute(sql`
        select coalesce(sum(estimated_cost), 0)::numeric(14,2)::text as cost
        from waste_records
        where restaurant_id=${restaurantId}
          and occurred_at >= ${dayStart} and occurred_at < ${dayEnd}`),
    ]);

    const critical = Array.from(criticalRows as readonly Record<string, unknown>[]);
    const sales = Array.from(salesRows as readonly Record<string, unknown>[])[0];
    const waste = Array.from(wasteRows as readonly Record<string, unknown>[])[0];
    const asCount = (value: unknown) => (typeof value === "number" ? value : Number(value ?? 0)) || 0;

    return {
      criticalStock: critical.map((row) => ({
        id: String(row.id),
        name: String(row.name),
        category: row.category === null || row.category === undefined ? null : String(row.category),
        baseUnit: row.base_unit as ErpOverview["criticalStock"][number]["baseUnit"],
        currentQuantity: String(row.current_quantity),
        reorderLevel: String(row.reorder_level),
      })),
      today: {
        sales: String(sales?.sales ?? "0.00"),
        orderCount: asCount(sales?.order_count),
        openOrders: asCount(sales?.open_orders),
        production: productionRows[0]?.total ?? 0,
        incompleteProduction: productionRows[0]?.incomplete ?? 0,
        wasteCost: String(waste?.cost ?? "0.00"),
        reservations: reservationRows[0]?.today ?? 0,
      },
      counts: {
        criticalStock: asCount(critical[0]?.full_count),
        warehouses: warehouseCount[0]?.value ?? 0,
        inventoryItems: inventoryCount[0]?.value ?? 0,
        suppliers: supplierCount[0]?.value ?? 0,
        activeRecipes: recipeCount[0]?.value ?? 0,
        openPurchaseOrders: purchaseRows[0]?.open ?? 0,
        pendingGoodsReceipts: purchaseRows[0]?.pendingReceipt ?? 0,
        openSupplierInvoices: invoiceRows[0]?.count ?? 0,
        upcomingReservations: reservationRows[0]?.upcoming ?? 0,
        openAttendance: attendanceCount[0]?.value ?? 0,
      },
      outstandingSupplierPayable: invoiceRows[0]?.balance ?? "0.00",
    };
  }

  createWarehouse(input: Parameters<ErpRepository["createWarehouse"]>[0]) {
    return this.db.transaction(async (tx) => {
      const [created] = await tx.insert(warehouses).values({ restaurantId: input.restaurantId, name: input.name, code: input.code }).returning({ id: warehouses.id, name: warehouses.name, code: warehouses.code });
      await tx.insert(auditLogs).values({ restaurantId: input.restaurantId, actorUserId: input.audit.actorStaffId, action: "erp.warehouse.created", entityType: "warehouse", entityId: created.id, newValue: { name: created.name, code: created.code }, requestId: input.audit.requestId });
      return created;
    });
  }

  createInventoryItem(input: Parameters<ErpRepository["createInventoryItem"]>[0]) {
    return this.db.transaction(async (tx) => {
      const [created] = await tx.insert(inventoryItems).values({ restaurantId: input.restaurantId, name: input.name, category: input.category, baseUnit: input.baseUnit, reorderLevel: input.reorderLevel, negativeStockPolicy: input.negativeStockPolicy }).returning({ id: inventoryItems.id, name: inventoryItems.name });
      await tx.insert(auditLogs).values({ restaurantId: input.restaurantId, actorUserId: input.audit.actorStaffId, action: "erp.inventory_item.created", entityType: "inventory_item", entityId: created.id, newValue: { name: created.name, baseUnit: input.baseUnit, reorderLevel: input.reorderLevel }, requestId: input.audit.requestId });
      return created;
    });
  }

  postStockMovement(input: Parameters<ErpRepository["postStockMovement"]>[0]) {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${input.restaurantId}:${input.inventoryItemId}:${input.warehouseId}`}, 0))`);
      const [existing] = await tx.select({ id: stockMovements.id, quantityDelta: stockMovements.quantityDelta }).from(stockMovements).where(and(eq(stockMovements.restaurantId, input.restaurantId), eq(stockMovements.idempotencyKey, input.idempotencyKey))).limit(1);
      const [balanceRow] = await tx.select({ balance: sql<string>`coalesce(sum(${stockMovements.quantityDelta}), 0)::numeric(18,6)` }).from(stockMovements).where(and(eq(stockMovements.restaurantId, input.restaurantId), eq(stockMovements.inventoryItemId, input.inventoryItemId), eq(stockMovements.warehouseId, input.warehouseId)));
      const [item] = await tx.select({ policy: inventoryItems.negativeStockPolicy, baseUnit: inventoryItems.baseUnit }).from(inventoryItems).where(and(eq(inventoryItems.restaurantId, input.restaurantId), eq(inventoryItems.id, input.inventoryItemId))).limit(1);
      if (!item) throw new DomainError("NOT_FOUND", "Stok kalemi bulunamadı.", { httpStatus: 404 });
      const current = parseFixedDecimal(balanceRow?.balance ?? "0", 6);
      if (existing) return { id: existing.id, quantityDelta: existing.quantityDelta, balance: formatFixedDecimal(current, 6), warning: current < 0n, replayed: true };
      const next = evaluateStockBalance(current, parseFixedDecimal(input.quantityDelta, 6), item.policy, { unit: ERP_UNIT_LABELS[item.baseUnit] });
      const [created] = await tx.insert(stockMovements).values({ restaurantId: input.restaurantId, inventoryItemId: input.inventoryItemId, warehouseId: input.warehouseId, movementType: input.movementType, quantityDelta: input.quantityDelta, unitCost: input.unitCost, sourceType: input.sourceType, sourceId: input.sourceId, idempotencyKey: input.idempotencyKey, reason: input.reason, actorStaffId: input.audit.actorStaffId }).returning({ id: stockMovements.id, quantityDelta: stockMovements.quantityDelta });
      await tx.insert(auditLogs).values({ restaurantId: input.restaurantId, actorUserId: input.audit.actorStaffId, action: "erp.stock_movement.posted", entityType: "stock_movement", entityId: created.id, newValue: { inventoryItemId: input.inventoryItemId, warehouseId: input.warehouseId, movementType: input.movementType, quantityDelta: input.quantityDelta, warning: next.warning }, requestId: input.audit.requestId });
      return { ...created, balance: formatFixedDecimal(next.nextAtoms, 6), warning: next.warning, replayed: false };
    });
  }

  createRecipe(input: Parameters<ErpRepository["createRecipe"]>[0]) {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${input.restaurantId}:${input.productId}:recipe`}, 0))`);
      const [versionRow] = await tx.select({ next: sql<number>`coalesce(max(${recipeVersions.version}), 0)::int + 1` }).from(recipeVersions).where(and(eq(recipeVersions.restaurantId, input.restaurantId), eq(recipeVersions.productId, input.productId)));
      const version = versionRow?.next ?? 1;
      const [created] = await tx.insert(recipeVersions).values({ restaurantId: input.restaurantId, productId: input.productId, version, yieldPortions: input.yieldPortions, createdByStaffId: input.audit.actorStaffId }).returning({ id: recipeVersions.id });
      await tx.insert(recipeIngredients).values(input.ingredients.map((line) => ({ restaurantId: input.restaurantId, recipeVersionId: created.id, inventoryItemId: line.inventoryItemId, quantity: line.quantity, unit: line.unit })));
      await tx.insert(auditLogs).values({ restaurantId: input.restaurantId, actorUserId: input.audit.actorStaffId, action: "erp.recipe.created", entityType: "recipe_version", entityId: created.id, newValue: { productId: input.productId, version, yieldPortions: input.yieldPortions, ingredientCount: input.ingredients.length }, requestId: input.audit.requestId });
      return { id: created.id, version };
    });
  }

  createSupplier(input: Parameters<ErpRepository["createSupplier"]>[0]) {
    return this.db.transaction(async (tx) => {
      const [created] = await tx.insert(suppliers).values({ restaurantId: input.restaurantId, name: input.name, contactPerson: input.contactPerson, phone: input.phone, email: input.email, notes: input.notes }).returning({ id: suppliers.id, name: suppliers.name });
      await tx.insert(auditLogs).values({ restaurantId: input.restaurantId, actorUserId: input.audit.actorStaffId, action: "erp.supplier.created", entityType: "supplier", entityId: created.id, newValue: { name: created.name }, requestId: input.audit.requestId });
      return created;
    });
  }

  createSchedule(input: Parameters<ErpRepository["createSchedule"]>[0]) {
    return this.db.transaction(async (tx) => {
      const overlap = await tx.select({ id: staffSchedules.id }).from(staffSchedules).where(and(eq(staffSchedules.restaurantId, input.restaurantId), eq(staffSchedules.staffId, input.staffId), inArray(staffSchedules.status, ["PLANNED", "CONFIRMED"]), lt(staffSchedules.startsAt, input.endsAt), gt(staffSchedules.endsAt, input.startsAt))).limit(1);
      if (overlap.length) duplicateError("Personelin bu zaman aralığında başka vardiyası var.");
      const [created] = await tx.insert(staffSchedules).values({ restaurantId: input.restaurantId, staffId: input.staffId, startsAt: input.startsAt, endsAt: input.endsAt, roleLabel: input.roleLabel, locationLabel: input.locationLabel, notes: input.notes, createdByStaffId: input.audit.actorStaffId }).returning({ id: staffSchedules.id });
      await tx.insert(auditLogs).values({ restaurantId: input.restaurantId, actorUserId: input.audit.actorStaffId, action: "erp.schedule.created", entityType: "staff_schedule", entityId: created.id, newValue: { staffId: input.staffId, startsAt: input.startsAt.toISOString(), endsAt: input.endsAt.toISOString() }, requestId: input.audit.requestId });
      return created;
    });
  }

  createReservation(input: Parameters<ErpRepository["createReservation"]>[0]) {
    return this.db.transaction(async (tx) => {
      if (input.tableId) {
        const overlap = await tx.select({ id: reservations.id }).from(reservations).where(and(eq(reservations.restaurantId, input.restaurantId), eq(reservations.tableId, input.tableId), inArray(reservations.status, ["CONFIRMED", "SEATED"]), lt(reservations.startsAt, input.endsAt), gt(reservations.endsAt, input.startsAt))).limit(1);
        if (overlap.length) duplicateError("Masa bu zaman aralığında başka bir rezervasyona atanmış.");
      }
      const [created] = await tx.insert(reservations).values({ restaurantId: input.restaurantId, tableId: input.tableId, customerName: input.customerName, phone: input.phone, partySize: input.partySize, startsAt: input.startsAt, endsAt: input.endsAt, notes: input.notes, createdByStaffId: input.audit.actorStaffId }).returning({ id: reservations.id, status: reservations.status });
      await tx.insert(auditLogs).values({ restaurantId: input.restaurantId, actorUserId: input.audit.actorStaffId, action: "erp.reservation.created", entityType: "reservation", entityId: created.id, newValue: { tableId: input.tableId, partySize: input.partySize, startsAt: input.startsAt.toISOString() }, requestId: input.audit.requestId });
      return { id: created.id, status: "PENDING" as const };
    });
  }

  createCustomerAccount(input: Parameters<ErpRepository["createCustomerAccount"]>[0]) {
    return this.db.transaction(async (tx) => {
      // customer_accounts_consent_check: a consent flag without the moment it
      // was given is not consent, it is an assertion. The timestamp is taken
      // here rather than accepted from the caller.
      const [created] = await tx.insert(customerAccounts).values({ restaurantId: input.restaurantId, name: input.name, email: input.email, phone: input.phone, marketingConsent: input.marketingConsent, marketingConsentAt: input.marketingConsent ? new Date() : null }).returning({ id: customerAccounts.id, name: customerAccounts.name });
      // The audit records that an account was opened and whether consent was
      // recorded — not the person's contact details.
      await tx.insert(auditLogs).values({ restaurantId: input.restaurantId, actorUserId: input.audit.actorStaffId, action: "erp.customer_account.created", entityType: "customer_account", entityId: created.id, newValue: { marketingConsent: input.marketingConsent }, requestId: input.audit.requestId });
      return created;
    });
  }

  /**
   * Opens a takeaway or courier order.
   *
   * The request is deliberately not an `orders` row. A dine-in order is
   * anchored to a table — `orders.table_id` is NOT NULL, and the floor plan,
   * table status, occupancy reports and the customer QR session all hang off
   * that anchor. Inventing a pretend table to carry a takeaway would put a
   * real, sessionable QR token on a counter that does not exist and would
   * count it as occupied floor space in every table report. So takeaway and
   * courier work live in their own tables, which is what the nullable
   * `fulfillment_requests.order_id` was there for: the request may later be
   * linked to exactly one order, and until then it stands on its own.
   *
   * Prices come from the product catalogue, never from the caller. Line totals
   * are computed the same way the database CHECK verifies them, so a drift
   * between the two is impossible rather than merely unlikely.
   */
  createFulfillmentRequest(input: Parameters<ErpRepository["createFulfillmentRequest"]>[0]) {
    return this.db.transaction(async (tx) => {
      const [existing] = await tx.select({ id: fulfillmentRequests.id, deliveryFee: fulfillmentRequests.deliveryFee }).from(fulfillmentRequests).where(and(eq(fulfillmentRequests.restaurantId, input.restaurantId), eq(fulfillmentRequests.idempotencyKey, input.idempotencyKey))).limit(1);
      if (existing) {
        const priced = await tx.select({ lineTotal: fulfillmentRequestItems.lineTotal }).from(fulfillmentRequestItems).where(and(eq(fulfillmentRequestItems.restaurantId, input.restaurantId), eq(fulfillmentRequestItems.fulfillmentRequestId, existing.id)));
        const linesMinor = priced.reduce((sum, line) => sum + parseFixedDecimal(line.lineTotal, 2), 0n);
        return { id: existing.id, status: "DRAFT" as const, itemCount: priced.length, linesTotal: formatFixedDecimal(linesMinor, 2), total: formatFixedDecimal(linesMinor + parseFixedDecimal(existing.deliveryFee ?? "0", 2), 2), replayed: true };
      }

      const productIds = input.items.map((line) => line.productId);
      const catalogue = await tx.select({ id: products.id, name: products.name, price: products.price }).from(products).where(and(eq(products.restaurantId, input.restaurantId), inArray(products.id, productIds), eq(products.isActive, true), eq(products.isAvailable, true)));
      const priceById = new Map(catalogue.map((product) => [product.id, product]));
      if (priceById.size !== productIds.length) throw validationError("Seçilen ürünlerden biri satışa kapalı ya da bu restorana ait değil.");

      let linesMinor = 0n;
      const lines = input.items.map((line) => {
        const product = priceById.get(line.productId)!;
        const unitMinor = parseFixedDecimal(product.price, 2);
        const lineMinor = unitMinor * BigInt(line.quantity);
        linesMinor += lineMinor;
        return { restaurantId: input.restaurantId, productId: line.productId, productNameSnapshot: product.name, unitPrice: formatFixedDecimal(unitMinor, 2), quantity: line.quantity, lineTotal: formatFixedDecimal(lineMinor, 2), notes: line.notes };
      });

      const [created] = await tx.insert(fulfillmentRequests).values({ restaurantId: input.restaurantId, channel: input.channel, customerName: input.customerName, contact: input.contact, address: input.address, deliveryNotes: input.deliveryNotes, requestedAt: input.requestedAt, deliveryFee: input.deliveryFee, idempotencyKey: input.idempotencyKey }).returning({ id: fulfillmentRequests.id });
      await tx.insert(fulfillmentRequestItems).values(lines.map((line) => ({ ...line, fulfillmentRequestId: created.id })));
      // The audit trail records the transaction, not the customer: a name,
      // phone number and home address are not needed to prove what happened.
      await tx.insert(auditLogs).values({ restaurantId: input.restaurantId, actorUserId: input.audit.actorStaffId, action: "erp.fulfillment.created", entityType: "fulfillment_request", entityId: created.id, newValue: { channel: input.channel, itemCount: lines.length, linesTotal: formatFixedDecimal(linesMinor, 2), deliveryFee: input.deliveryFee }, requestId: input.audit.requestId });

      const totalMinor = linesMinor + parseFixedDecimal(input.deliveryFee, 2);
      return { id: created.id, status: "DRAFT" as const, itemCount: lines.length, linesTotal: formatFixedDecimal(linesMinor, 2), total: formatFixedDecimal(totalMinor, 2), replayed: false };
    });
  }

  async refreshPopularProducts(input: Parameters<ErpRepository["refreshPopularProducts"]>[0]) {
    const rows = await this.db.select({
      productId: orderItems.productId,
      quantity: sql<number>`sum(${orderItems.quantity})::int`,
    }).from(orderItems).innerJoin(orders, and(eq(orders.restaurantId, orderItems.restaurantId), eq(orders.id, orderItems.orderId))).where(and(
      eq(orderItems.restaurantId, input.restaurantId),
      inArray(orders.status, ["SERVED", "COMPLETED"]),
      notInArray(orderItems.status, ["CANCELLED", "VOIDED"]),
      sql`${orders.createdAt} >= now() - (${input.windowDays}::text || ' days')::interval`,
    )).groupBy(orderItems.productId).orderBy(sql`sum(${orderItems.quantity}) desc`, asc(orderItems.productId)).limit(12);

    await this.db.transaction(async (tx) => {
      await tx.delete(popularProductSnapshots).where(and(eq(popularProductSnapshots.restaurantId, input.restaurantId), eq(popularProductSnapshots.windowDays, input.windowDays)));
      if (rows.length) await tx.insert(popularProductSnapshots).values(rows.map((row, index) => ({ restaurantId: input.restaurantId, productId: row.productId, windowDays: input.windowDays, quantitySold: row.quantity, rank: index + 1 })));
      await tx.insert(auditLogs).values({ restaurantId: input.restaurantId, actorUserId: input.audit.actorStaffId, action: "erp.popular_snapshot.refreshed", entityType: "popular_product_snapshot", newValue: { windowDays: input.windowDays, productCount: rows.length }, requestId: input.audit.requestId });
    });
    return { refreshed: rows.length, windowDays: input.windowDays };
  }

  createProductionBatch(input: Parameters<ErpRepository["createProductionBatch"]>[0]) {
    return this.db.transaction(async (tx) => {
      const [existing] = await tx.select({ id: productionBatches.id }).from(productionBatches).where(and(eq(productionBatches.restaurantId, input.restaurantId), eq(productionBatches.idempotencyKey, input.idempotencyKey))).limit(1);
      if (existing) return { id: existing.id, status: "PLANNED" as const, replayed: true };
      const [created] = await tx.insert(productionBatches).values({ restaurantId: input.restaurantId, productId: input.productId, recipeVersionId: input.recipeVersionId, warehouseId: input.warehouseId, businessDate: input.businessDate, plannedPortions: input.plannedPortions, idempotencyKey: input.idempotencyKey }).returning({ id: productionBatches.id });
      await tx.insert(auditLogs).values({ restaurantId: input.restaurantId, actorUserId: input.audit.actorStaffId, action: "erp.production.planned", entityType: "production_batch", entityId: created.id, newValue: { productId: input.productId, recipeVersionId: input.recipeVersionId, plannedPortions: input.plannedPortions, businessDate: input.businessDate }, requestId: input.audit.requestId });
      return { id: created.id, status: "PLANNED" as const, replayed: false };
    });
  }

  completeProductionBatch(input: Parameters<ErpRepository["completeProductionBatch"]>[0]) {
    return this.db.transaction(async (tx) => {
      const [batch] = await tx.select({ id: productionBatches.id, recipeVersionId: productionBatches.recipeVersionId, warehouseId: productionBatches.warehouseId, consumptionPostedAt: productionBatches.consumptionPostedAt }).from(productionBatches).where(and(eq(productionBatches.restaurantId, input.restaurantId), eq(productionBatches.id, input.batchId))).for("update").limit(1);
      if (!batch) throw new DomainError("NOT_FOUND", "Üretim batch'i bulunamadı.", { httpStatus: 404 });
      if (batch.consumptionPostedAt) return { id: batch.id, consumedItems: 0, replayed: true };
      const [recipe] = await tx.select({ yieldPortions: recipeVersions.yieldPortions }).from(recipeVersions).where(and(eq(recipeVersions.restaurantId, input.restaurantId), eq(recipeVersions.id, batch.recipeVersionId))).limit(1);
      if (!recipe) throw new DomainError("NOT_FOUND", "Üretim reçetesi bulunamadı.", { httpStatus: 404 });
      const lines = await tx.select({ inventoryItemId: recipeIngredients.inventoryItemId, quantity: recipeIngredients.quantity, unit: recipeIngredients.unit, baseUnit: inventoryItems.baseUnit, policy: inventoryItems.negativeStockPolicy }).from(recipeIngredients).innerJoin(inventoryItems, and(eq(inventoryItems.restaurantId, recipeIngredients.restaurantId), eq(inventoryItems.id, recipeIngredients.inventoryItemId))).where(and(eq(recipeIngredients.restaurantId, input.restaurantId), eq(recipeIngredients.recipeVersionId, batch.recipeVersionId))).orderBy(asc(recipeIngredients.inventoryItemId));
      const yieldScaled = parseFixedDecimal(recipe.yieldPortions, 6);
      const actualScaled = parseFixedDecimal(input.actualPortions, 6);
      if (!lines.length) throw new DomainError("CONFLICT", "Reçetede stok kalemi bulunmuyor.", { httpStatus: 409 });
      for (const line of lines) {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${input.restaurantId}:${line.inventoryItemId}:${batch.warehouseId}`}, 0))`);
        const recipeScaled = parseFixedDecimal(line.quantity, 6);
        const consumedInputUnit = formatFixedDecimal(roundRatio(recipeScaled * actualScaled, yieldScaled), 6);
        const consumedBaseUnit = convertQuantity(consumedInputUnit, line.unit, line.baseUnit);
        const [balanceRow] = await tx.select({ balance: sql<string>`coalesce(sum(${stockMovements.quantityDelta}), 0)::numeric(18,6)` }).from(stockMovements).where(and(eq(stockMovements.restaurantId, input.restaurantId), eq(stockMovements.inventoryItemId, line.inventoryItemId), eq(stockMovements.warehouseId, batch.warehouseId)));
        evaluateStockBalance(parseFixedDecimal(balanceRow?.balance ?? "0", 6), -parseFixedDecimal(consumedBaseUnit, 6), line.policy);
        await tx.insert(stockMovements).values({ restaurantId: input.restaurantId, inventoryItemId: line.inventoryItemId, warehouseId: batch.warehouseId, movementType: "PRODUCTION_CONSUMPTION", quantityDelta: `-${consumedBaseUnit}`, sourceType: "PRODUCTION_BATCH", sourceId: batch.id, idempotencyKey: `production:${batch.id}:${line.inventoryItemId}`, reason: "Üretim reçetesi tüketimi", actorStaffId: input.audit.actorStaffId });
      }
      const at = new Date();
      await tx.update(productionBatches).set({ actualPortions: input.actualPortions, status: "COMPLETED", producedByStaffId: input.audit.actorStaffId, consumptionPostedAt: at, updatedAt: at }).where(and(eq(productionBatches.restaurantId, input.restaurantId), eq(productionBatches.id, batch.id)));
      await tx.insert(auditLogs).values({ restaurantId: input.restaurantId, actorUserId: input.audit.actorStaffId, action: "erp.production.completed", entityType: "production_batch", entityId: batch.id, newValue: { actualPortions: input.actualPortions, consumedItems: lines.length }, requestId: input.audit.requestId });
      return { id: batch.id, consumedItems: lines.length, replayed: false };
    });
  }

  recordWaste(input: Parameters<ErpRepository["recordWaste"]>[0]) {
    return this.db.transaction(async (tx) => {
      const [existing] = await tx.select({ id: wasteRecords.id }).from(wasteRecords).where(and(eq(wasteRecords.restaurantId, input.restaurantId), eq(wasteRecords.idempotencyKey, input.idempotencyKey))).limit(1);
      if (existing) return { id: existing.id, replayed: true };
      const [item] = await tx.select({ baseUnit: inventoryItems.baseUnit, policy: inventoryItems.negativeStockPolicy }).from(inventoryItems).where(and(eq(inventoryItems.restaurantId, input.restaurantId), eq(inventoryItems.id, input.inventoryItemId))).limit(1);
      if (!item) throw new DomainError("NOT_FOUND", "Stok kalemi bulunamadı.", { httpStatus: 404 });
      const baseQuantity = convertQuantity(input.quantity, input.unit, item.baseUnit);
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${input.restaurantId}:${input.inventoryItemId}:${input.warehouseId}`}, 0))`);
      const [balanceRow] = await tx.select({ balance: sql<string>`coalesce(sum(${stockMovements.quantityDelta}), 0)::numeric(18,6)` }).from(stockMovements).where(and(eq(stockMovements.restaurantId, input.restaurantId), eq(stockMovements.inventoryItemId, input.inventoryItemId), eq(stockMovements.warehouseId, input.warehouseId)));
      evaluateStockBalance(parseFixedDecimal(balanceRow?.balance ?? "0", 6), -parseFixedDecimal(baseQuantity, 6), item.policy);
      const [created] = await tx.insert(wasteRecords).values({ restaurantId: input.restaurantId, warehouseId: input.warehouseId, inventoryItemId: input.inventoryItemId, wasteType: input.wasteType, quantity: input.quantity, unit: input.unit, estimatedCost: input.estimatedCost, reason: input.reason, recordedByStaffId: input.audit.actorStaffId, idempotencyKey: input.idempotencyKey }).returning({ id: wasteRecords.id });
      const movementType = input.wasteType === "STAFF_MEAL" ? "STAFF_MEAL" : input.wasteType === "COMPLIMENTARY" ? "COMPLIMENTARY" : "WASTE";
      await tx.insert(stockMovements).values({ restaurantId: input.restaurantId, inventoryItemId: input.inventoryItemId, warehouseId: input.warehouseId, movementType, quantityDelta: `-${baseQuantity}`, sourceType: "WASTE_RECORD", sourceId: created.id, idempotencyKey: `waste:${input.idempotencyKey}`, reason: input.reason, actorStaffId: input.audit.actorStaffId });
      await tx.insert(auditLogs).values({ restaurantId: input.restaurantId, actorUserId: input.audit.actorStaffId, action: "erp.waste.recorded", entityType: "waste_record", entityId: created.id, newValue: { inventoryItemId: input.inventoryItemId, wasteType: input.wasteType, quantity: input.quantity, unit: input.unit, estimatedCost: input.estimatedCost }, requestId: input.audit.requestId });
      return { id: created.id, replayed: false };
    });
  }

  createPurchaseOrder(input: Parameters<ErpRepository["createPurchaseOrder"]>[0]) {
    return this.db.transaction(async (tx) => {
      const [created] = await tx.insert(purchaseOrders).values({ restaurantId: input.restaurantId, supplierId: input.supplierId, orderNumber: input.orderNumber, expectedAt: input.expectedAt, notes: input.notes, createdByStaffId: input.audit.actorStaffId }).returning({ id: purchaseOrders.id });
      await tx.insert(purchaseOrderItems).values(input.items.map((line) => ({ restaurantId: input.restaurantId, purchaseOrderId: created.id, inventoryItemId: line.inventoryItemId, orderedQuantity: line.orderedQuantity, unit: line.unit, unitPrice: line.unitPrice, lineTotal: line.lineTotal })));
      await tx.insert(auditLogs).values({ restaurantId: input.restaurantId, actorUserId: input.audit.actorStaffId, action: "erp.purchase_order.created", entityType: "purchase_order", entityId: created.id, newValue: { supplierId: input.supplierId, orderNumber: input.orderNumber, itemCount: input.items.length }, requestId: input.audit.requestId });
      return { id: created.id, status: "DRAFT" as const };
    });
  }

  receiveGoods(input: Parameters<ErpRepository["receiveGoods"]>[0]) {
    return this.db.transaction(async (tx) => {
      const [existing] = await tx.select({ id: goodsReceipts.id }).from(goodsReceipts).where(and(eq(goodsReceipts.restaurantId, input.restaurantId), eq(goodsReceipts.idempotencyKey, input.idempotencyKey))).limit(1);
      if (existing) return { id: existing.id, replayed: true };
      const [receipt] = await tx.insert(goodsReceipts).values({ restaurantId: input.restaurantId, purchaseOrderId: input.purchaseOrderId, supplierId: input.supplierId, warehouseId: input.warehouseId, receiptNumber: input.receiptNumber, receivedByStaffId: input.audit.actorStaffId, idempotencyKey: input.idempotencyKey }).returning({ id: goodsReceipts.id });
      for (const line of [...input.items].sort((a, b) => a.inventoryItemId.localeCompare(b.inventoryItemId))) {
        const [poLine] = await tx.select({ ordered: purchaseOrderItems.orderedQuantity, received: purchaseOrderItems.receivedQuantity, unit: purchaseOrderItems.unit }).from(purchaseOrderItems).where(and(eq(purchaseOrderItems.restaurantId, input.restaurantId), eq(purchaseOrderItems.purchaseOrderId, input.purchaseOrderId), eq(purchaseOrderItems.id, line.purchaseOrderItemId), eq(purchaseOrderItems.inventoryItemId, line.inventoryItemId))).for("update").limit(1);
        if (!poLine) throw new DomainError("NOT_FOUND", "Satın alma siparişi satırı bulunamadı.", { httpStatus: 404 });
        if (poLine.unit !== line.unit) throw new DomainError("CONFLICT", "Mal kabul birimi sipariş birimiyle eşleşmiyor.", { httpStatus: 409 });
        const nextReceived = parseFixedDecimal(poLine.received, 6) + parseFixedDecimal(line.receivedQuantity, 6);
        if (nextReceived > parseFixedDecimal(poLine.ordered, 6)) throw new DomainError("CONFLICT", "Mal kabul miktarı sipariş miktarını aşıyor.", { httpStatus: 409 });
        const [item] = await tx.select({ baseUnit: inventoryItems.baseUnit }).from(inventoryItems).where(and(eq(inventoryItems.restaurantId, input.restaurantId), eq(inventoryItems.id, line.inventoryItemId))).limit(1);
        if (!item) throw new DomainError("NOT_FOUND", "Stok kalemi bulunamadı.", { httpStatus: 404 });
        const baseQuantity = convertQuantity(line.receivedQuantity, line.unit, item.baseUnit);
        const baseUnitsPerPurchaseUnit = parseFixedDecimal(convertQuantity("1", line.unit, item.baseUnit), 6);
        const unitCost = formatFixedDecimal(
          roundRatio(parseFixedDecimal(line.unitPrice, 6) * 1_000_000n, baseUnitsPerPurchaseUnit),
          6,
        );
        await tx.insert(goodsReceiptItems).values({ restaurantId: input.restaurantId, goodsReceiptId: receipt.id, purchaseOrderItemId: line.purchaseOrderItemId, inventoryItemId: line.inventoryItemId, receivedQuantity: line.receivedQuantity, unit: line.unit, unitPrice: line.unitPrice });
        await tx.update(purchaseOrderItems).set({ receivedQuantity: formatFixedDecimal(nextReceived, 6), updatedAt: new Date() }).where(and(eq(purchaseOrderItems.restaurantId, input.restaurantId), eq(purchaseOrderItems.id, line.purchaseOrderItemId)));
        await tx.insert(stockMovements).values({ restaurantId: input.restaurantId, inventoryItemId: line.inventoryItemId, warehouseId: input.warehouseId, movementType: "PURCHASE_RECEIPT", quantityDelta: baseQuantity, unitCost, sourceType: "GOODS_RECEIPT", sourceId: receipt.id, idempotencyKey: `receipt:${input.idempotencyKey}:${line.purchaseOrderItemId}`, reason: `Mal kabul ${input.receiptNumber}`, actorStaffId: input.audit.actorStaffId });
      }
      const remaining = await tx.select({ value: sql<number>`count(*)::int` }).from(purchaseOrderItems).where(and(eq(purchaseOrderItems.restaurantId, input.restaurantId), eq(purchaseOrderItems.purchaseOrderId, input.purchaseOrderId), sql`${purchaseOrderItems.receivedQuantity} < ${purchaseOrderItems.orderedQuantity}`));
      await tx.update(purchaseOrders).set({ status: (remaining[0]?.value ?? 0) > 0 ? "PARTIALLY_RECEIVED" : "RECEIVED", updatedAt: new Date() }).where(and(eq(purchaseOrders.restaurantId, input.restaurantId), eq(purchaseOrders.id, input.purchaseOrderId)));
      await tx.insert(auditLogs).values({ restaurantId: input.restaurantId, actorUserId: input.audit.actorStaffId, action: "erp.goods_receipt.created", entityType: "goods_receipt", entityId: receipt.id, newValue: { purchaseOrderId: input.purchaseOrderId, receiptNumber: input.receiptNumber, itemCount: input.items.length }, requestId: input.audit.requestId });
      return { id: receipt.id, replayed: false };
    });
  }

  createSupplierInvoice(input: Parameters<ErpRepository["createSupplierInvoice"]>[0]) {
    return this.db.transaction(async (tx) => {
      const [created] = await tx.insert(supplierInvoices).values({ restaurantId: input.restaurantId, supplierId: input.supplierId, goodsReceiptId: input.goodsReceiptId, invoiceNumber: input.invoiceNumber, total: input.total, paidTotal: "0.00", dueDate: input.dueDate }).returning({ id: supplierInvoices.id });
      await tx.insert(auditLogs).values({ restaurantId: input.restaurantId, actorUserId: input.audit.actorStaffId, action: "erp.supplier_invoice.created", entityType: "supplier_invoice", entityId: created.id, newValue: { supplierId: input.supplierId, invoiceNumber: input.invoiceNumber, total: input.total }, requestId: input.audit.requestId });
      return { id: created.id, status: "OPEN" as const };
    });
  }

  recordSupplierPayment(input: Parameters<ErpRepository["recordSupplierPayment"]>[0]) {
    return this.db.transaction(async (tx) => {
      const [existing] = await tx.select({ id: supplierPayments.id }).from(supplierPayments).where(and(eq(supplierPayments.restaurantId, input.restaurantId), eq(supplierPayments.idempotencyKey, input.idempotencyKey))).limit(1);
      const [invoice] = await tx.select({ total: supplierInvoices.total, paidTotal: supplierInvoices.paidTotal }).from(supplierInvoices).where(and(eq(supplierInvoices.restaurantId, input.restaurantId), eq(supplierInvoices.supplierId, input.supplierId), eq(supplierInvoices.id, input.supplierInvoiceId))).for("update").limit(1);
      if (!invoice) throw new DomainError("NOT_FOUND", "Tedarikçi faturası bulunamadı.", { httpStatus: 404 });
      const currentPaid = parseFixedDecimal(invoice.paidTotal, 2);
      const total = parseFixedDecimal(invoice.total, 2);
      if (existing) return { id: existing.id, remaining: formatFixedDecimal(total - currentPaid, 2), replayed: true };
      const amount = parseFixedDecimal(input.amount, 2);
      if (currentPaid + amount > total) throw new DomainError("CONFLICT", "Ödeme kalan tedarikçi borcunu aşıyor.", { httpStatus: 409 });
      const [created] = await tx.insert(supplierPayments).values({ restaurantId: input.restaurantId, supplierId: input.supplierId, supplierInvoiceId: input.supplierInvoiceId, amount: input.amount, method: input.method, reference: input.reference, idempotencyKey: input.idempotencyKey, paidByStaffId: input.audit.actorStaffId }).returning({ id: supplierPayments.id });
      const nextPaid = currentPaid + amount;
      await tx.update(supplierInvoices).set({ paidTotal: formatFixedDecimal(nextPaid, 2), status: nextPaid === total ? "PAID" : "PARTIALLY_PAID", updatedAt: new Date() }).where(and(eq(supplierInvoices.restaurantId, input.restaurantId), eq(supplierInvoices.id, input.supplierInvoiceId)));
      await tx.insert(auditLogs).values({ restaurantId: input.restaurantId, actorUserId: input.audit.actorStaffId, action: "erp.supplier_payment.recorded", entityType: "supplier_payment", entityId: created.id, newValue: { supplierInvoiceId: input.supplierInvoiceId, amount: input.amount, method: input.method }, requestId: input.audit.requestId });
      return { id: created.id, remaining: formatFixedDecimal(total - nextPaid, 2), replayed: false };
    });
  }
}
