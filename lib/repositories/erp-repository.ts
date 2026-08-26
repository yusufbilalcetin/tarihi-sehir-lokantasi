import type { InventoryUnit, NegativeStockPolicy, StockMovementType } from "@/lib/domain/erp";

export interface ErpAuditContext {
  readonly actorStaffId: string;
  readonly requestId: string;
}

/**
 * The manager's "what is happening today" screen, as data.
 *
 * Every field below is a real aggregate over a real table. A metric with no
 * domain behind it is absent rather than reported as zero, because a confident
 * zero is worse than a missing card: it says the number was measured.
 *
 * `criticalStock` is bounded — the dashboard names the items that need a
 * decision now and hands the full list to the stock module, so the screen can
 * never turn into an unbounded table.
 */
export interface ErpOverview {
  /** Ledger balance at or below the reorder level. Bounded; see `counts.criticalStock`. */
  readonly criticalStock: readonly {
    readonly id: string;
    readonly name: string;
    readonly category: string | null;
    readonly baseUnit: InventoryUnit;
    readonly currentQuantity: string;
    readonly reorderLevel: string;
  }[];
  readonly today: {
    /** Gross sales on the same basis as the finance summary: SERVED and COMPLETED. */
    readonly sales: string;
    readonly orderCount: number;
    readonly openOrders: number;
    readonly production: number;
    /** Batches planned or in progress today and not yet completed. */
    readonly incompleteProduction: number;
    readonly wasteCost: string;
    readonly reservations: number;
  };
  readonly counts: {
    readonly criticalStock: number;
    readonly warehouses: number;
    /** Setup progress is derived from these, never stored as a flag. */
    readonly inventoryItems: number;
    readonly suppliers: number;
    readonly activeRecipes: number;
    readonly openPurchaseOrders: number;
    /** Sent or partially received: goods the restaurant is still waiting on. */
    readonly pendingGoodsReceipts: number;
    readonly openSupplierInvoices: number;
    readonly upcomingReservations: number;
    readonly openAttendance: number;
  };
  readonly outstandingSupplierPayable: string;
}

export interface ErpRepository {
  overview(restaurantId: string): Promise<ErpOverview>;
  createWarehouse(input: { restaurantId: string; name: string; code: string; audit: ErpAuditContext }): Promise<{ id: string; name: string; code: string }>;
  createInventoryItem(input: { restaurantId: string; name: string; category: string | null; baseUnit: InventoryUnit; reorderLevel: string; negativeStockPolicy: NegativeStockPolicy; audit: ErpAuditContext }): Promise<{ id: string; name: string }>;
  postStockMovement(input: { restaurantId: string; inventoryItemId: string; warehouseId: string; movementType: StockMovementType; quantityDelta: string; unitCost: string | null; sourceType: string; sourceId: string | null; idempotencyKey: string; reason: string; audit: ErpAuditContext }): Promise<{ id: string; quantityDelta: string; balance: string; warning: boolean; replayed: boolean }>;
  createRecipe(input: { restaurantId: string; productId: string; yieldPortions: string; ingredients: readonly { inventoryItemId: string; quantity: string; unit: InventoryUnit }[]; audit: ErpAuditContext }): Promise<{ id: string; version: number }>;
  createSupplier(input: { restaurantId: string; name: string; contactPerson: string | null; phone: string | null; email: string | null; notes: string | null; audit: ErpAuditContext }): Promise<{ id: string; name: string }>;
  createSchedule(input: { restaurantId: string; staffId: string; startsAt: Date; endsAt: Date; roleLabel: string | null; locationLabel: string | null; notes: string | null; audit: ErpAuditContext }): Promise<{ id: string }>;
  createReservation(input: { restaurantId: string; tableId: string | null; customerName: string; phone: string; partySize: number; startsAt: Date; endsAt: Date; notes: string | null; audit: ErpAuditContext }): Promise<{ id: string; status: "PENDING" }>;
  createCustomerAccount(input: { restaurantId: string; name: string; email: string | null; phone: string | null; marketingConsent: boolean; audit: ErpAuditContext }): Promise<{ id: string; name: string }>;
  createFulfillmentRequest(input: { restaurantId: string; channel: "TAKEAWAY" | "DELIVERY"; customerName: string; contact: string; address: string | null; deliveryNotes: string | null; requestedAt: Date | null; deliveryFee: string; idempotencyKey: string; items: readonly { productId: string; quantity: number; notes: string | null }[]; audit: ErpAuditContext }): Promise<{ id: string; status: "DRAFT"; itemCount: number; linesTotal: string; total: string; replayed: boolean }>;
  refreshPopularProducts(input: { restaurantId: string; windowDays: number; audit: ErpAuditContext }): Promise<{ refreshed: number; windowDays: number }>;
  createProductionBatch(input: { restaurantId: string; productId: string; recipeVersionId: string; warehouseId: string; businessDate: string; plannedPortions: string; idempotencyKey: string; audit: ErpAuditContext }): Promise<{ id: string; status: "PLANNED"; replayed: boolean }>;
  completeProductionBatch(input: { restaurantId: string; batchId: string; actualPortions: string; audit: ErpAuditContext }): Promise<{ id: string; consumedItems: number; replayed: boolean }>;
  recordWaste(input: { restaurantId: string; warehouseId: string; inventoryItemId: string; wasteType: "SPOILAGE" | "SPILL" | "PREPARATION_WASTE" | "STAFF_MEAL" | "COMPLIMENTARY" | "OTHER"; quantity: string; unit: InventoryUnit; estimatedCost: string; reason: string; idempotencyKey: string; audit: ErpAuditContext }): Promise<{ id: string; replayed: boolean }>;
  createPurchaseOrder(input: { restaurantId: string; supplierId: string; orderNumber: string; expectedAt: Date | null; notes: string | null; items: readonly { inventoryItemId: string; orderedQuantity: string; unit: InventoryUnit; unitPrice: string; lineTotal: string }[]; audit: ErpAuditContext }): Promise<{ id: string; status: "DRAFT" }>;
  receiveGoods(input: { restaurantId: string; purchaseOrderId: string; supplierId: string; warehouseId: string; receiptNumber: string; idempotencyKey: string; items: readonly { purchaseOrderItemId: string; inventoryItemId: string; receivedQuantity: string; unit: InventoryUnit; unitPrice: string }[]; audit: ErpAuditContext }): Promise<{ id: string; replayed: boolean }>;
  createSupplierInvoice(input: { restaurantId: string; supplierId: string; goodsReceiptId: string | null; invoiceNumber: string; total: string; dueDate: string | null; audit: ErpAuditContext }): Promise<{ id: string; status: "OPEN" }>;
  recordSupplierPayment(input: { restaurantId: string; supplierId: string; supplierInvoiceId: string; amount: string; method: "BANK" | "CASH" | "OTHER"; reference: string | null; idempotencyKey: string; audit: ErpAuditContext }): Promise<{ id: string; remaining: string; replayed: boolean }>;
}
