import type {
  AdminCategoryResult,
  AdminProductResult,
} from "@/lib/services/admin-menu-service";
import type { AdminReportsResult } from "@/lib/services/admin-reports-service";
import type { AutoTranslateResult } from "@/lib/services/menu-auto-translate-service";
import type { ReviewReport } from "@/lib/domain/report-review";
import type {
  BusiestReport,
  CategoryReportRow,
  FinanceReport,
  KitchenReport,
  OrderTimelineReport,
  ProductDetailReport,
  ProductReport,
  ReportSummary,
  ReviewDetailReport,
  StaffReportRow,
  TableReportRow,
} from "@/lib/domain/report-contracts";
import type { RestaurantSettingsResult } from "@/lib/services/admin-settings-service";
import type { AuditLogPage } from "@/lib/domain/audit-log";
import type {
  AdminStaffPage,
  AdminStaffResult,
} from "@/lib/services/admin-staff-service";
import type { ManagedTableResult } from "@/lib/services/table-service";

export interface TableQrCodeRow {
  readonly tableId: string;
  readonly tableName: string;
  readonly tableNumber: number;
  readonly seats: number;
  readonly isActive: boolean;
  readonly revoked: boolean;
  /** Absolute, production-correct `/menu/<token>` address. */
  readonly menuUrl: string;
}

export interface TableQrCodesResult {
  readonly restaurantName: string;
  readonly tables: readonly TableQrCodeRow[];
}
import type { CustomerActiveOrderResult } from "@/lib/services/customer-order-query-service";
import type { PublicMenuResult } from "@/lib/services/menu-service";
import type { OrderChecksResult } from "@/lib/services/order-check-service";
import type {
  AddOrderItemsResult,
  CancelOrderItemResult,
} from "@/lib/services/order-service";
import type { OrderLedgerResult, RefundResult } from "@/lib/services/payment-service";
import type { ShiftMoneySummary } from "@/lib/domain/cashier-shift";
import type { XReport, ZReportSnapshot } from "@/lib/domain/cashier-report";
import type { DailyCashReport } from "@/lib/services/cashier-report-service";
import type {
  CashDrawerMovementRecord,
  ShiftHistoryPage,
} from "@/lib/repositories/cashier-shift-repository";
import type { CashRegisterResult } from "@/lib/services/cash-register-service";
import type {
  CurrentShiftResult,
  ShiftDetailResult,
} from "@/lib/services/cashier-shift-service";
import type {
  AgentResult,
  PrinterAdminService,
  PrinterResult,
} from "@/lib/services/printer-admin-service";
import type { EnqueueResult, PrintService } from "@/lib/services/print-service";
import type { StaffOrderListResult } from "@/lib/services/staff-order-service";
import type { StaffTableResult } from "@/lib/services/staff-table-service";
import type {
  TableMoveResult,
  TableResetResult,
} from "@/lib/services/table-operations-service";
import { apiRequest, newIdempotencyKey } from "./client";

export interface CustomerMenuPayload extends PublicMenuResult {
  readonly table: { readonly id: string; readonly name: string; readonly number: number };
}

export interface GuestSessionPayload {
  readonly restaurant: { readonly name: string; readonly currency: string };
  readonly session: { readonly expiresAt: string };
}

export interface GuestOrderPayload {
  readonly orderNumber: string;
  /** Already in words — "Paket Sipariş" or "Kurye Siparişi". */
  readonly channelLabel: string;
  readonly status: string;
  readonly total: string;
  readonly currency: string;
  readonly createdAt: string;
  readonly replayed: boolean;
}

/**
 * What a guest is shown while their own takeaway or courier order is worked on.
 *
 * The steps arrive as translation keys, not sentences: the guest may be
 * reading in any supported language, and the words come from the same menu
 * dictionary the rest of their session uses. Nothing here identifies the order
 * internally — no id, no restaurant, no courier, no telephone number.
 */
export interface OrderTrackingPayload {
  readonly orderNumber: string;
  readonly channel: "TAKEAWAY" | "DELIVERY";
  readonly current: string;
  readonly steps: readonly {
    readonly key: string;
    readonly state: "done" | "current" | "upcoming";
  }[];
  readonly cancelled: boolean;
  readonly total: string;
  readonly currency: string;
  readonly placedAt: string;
  readonly updatedAt: string;
  readonly items: readonly { readonly name: string; readonly quantity: number }[];
}

export interface CreateOrderPayload {
  readonly orderId: string;
  readonly orderNumber: string;
  readonly status: string;
  readonly total: string;
  readonly currency: string;
  readonly createdAt: string;
  readonly replayed: boolean;
}

export interface CustomerCallPayload {
  readonly id: string;
  readonly type: "WAITER_CALL" | "BILL_REQUEST";
  readonly status: "OPEN" | "ACKNOWLEDGED";
  readonly createdAt: string;
  readonly replayed: boolean;
}

/** Data-minimized shape returned by the table-session scoped customer read. */
export interface ActiveCustomerCallPayload {
  readonly type: "WAITER_CALL" | "BILL_REQUEST";
  readonly status: "OPEN" | "ACKNOWLEDGED";
  readonly createdAt: string;
}

export interface StaffCallPayload {
  readonly id: string;
  readonly type: "WAITER_CALL" | "BILL_REQUEST" | "OTHER";
  readonly status: "OPEN" | "ACKNOWLEDGED" | "RESOLVED" | "CANCELLED";
  readonly requestLabel: string | null;
  readonly notes: string | null;
  readonly table: { readonly id: string; readonly name: string; readonly number: number };
  readonly acknowledgedAt: string | null;
  readonly resolvedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export const menuApi = {
  get: (signal?: AbortSignal) =>
    apiRequest<CustomerMenuPayload>("/api/menu", { signal }),
};

/**
 * The public ordering door, for a guest with no table.
 *
 * Nothing here carries a restaurant, a table or a price: the session names the
 * restaurant, the channel decides the table, and the server prices the order.
 */
export const guestApi = {
  openSession: (restaurantSlug: string) =>
    apiRequest<GuestSessionPayload>("/api/guest-sessions", {
      method: "POST",
      body: { restaurantSlug },
    }),
  menu: (signal?: AbortSignal, locale?: string) =>
    apiRequest<PublicMenuResult>(
      locale ? `/api/guest-menu?locale=${encodeURIComponent(locale)}` : "/api/guest-menu",
      { signal },
    ),
  createOrder: (
    input: {
      readonly channel: "TAKEAWAY" | "DELIVERY";
      readonly items: readonly { productId: string; quantity: number; note?: string }[];
      readonly customerName: string;
      readonly contact: string;
      readonly address?: string;
      readonly deliveryNotes?: string;
      readonly note?: string;
    },
    idempotencyKey: string,
  ) =>
    apiRequest<GuestOrderPayload>("/api/guest-orders", {
      method: "POST",
      idempotencyKey,
      body: input,
    }),
  // No argument: the order is the one the tracking capability names.
  tracking: (signal?: AbortSignal) =>
    apiRequest<{ order: OrderTrackingPayload }>("/api/guest-orders/tracking", { signal }),
};

export const orderApi = {
  create: (
    items: readonly { productId: string; quantity: number; note?: string }[],
    note: string | undefined,
    idempotencyKey: string,
  ) =>
    apiRequest<CreateOrderPayload>("/api/orders", {
      method: "POST",
      idempotencyKey,
      body: note ? { items, note } : { items },
    }),
  active: (signal?: AbortSignal) =>
    apiRequest<{ orders: readonly CustomerActiveOrderResult[] }>("/api/orders/active", { signal }),
  activeCalls: (signal?: AbortSignal) =>
    apiRequest<{ calls: readonly ActiveCustomerCallPayload[] }>("/api/calls", { signal }),
  call: (notes?: string) =>
    apiRequest<CustomerCallPayload>("/api/calls", {
      method: "POST",
      body: notes ? { notes } : {},
    }),
  requestBill: () =>
    apiRequest<CustomerCallPayload>("/api/bill-requests", { method: "POST", body: {} }),
  newIdempotencyKey,
};

export const staffApi = {
  orders: (
    params?: {
      status?: string;
      tableId?: string;
      date?: string;
      open?: boolean;
      /** The till asks for each order's money position; other screens do not. */
      withBalance?: boolean;
    },
    signal?: AbortSignal,
  ) => {
    const search = new URLSearchParams();
    if (params?.status) search.set("status", params.status);
    if (params?.tableId) search.set("tableId", params.tableId);
    if (params?.date) search.set("date", params.date);
    // Live-service screens pass this so settled orders cannot use up the row
    // budget a still-open ticket needs.
    if (params?.open) search.set("open", "true");
    if (params?.withBalance) search.set("withBalance", "true");
    const query = search.toString();
    return apiRequest<{ orders: readonly StaffOrderListResult[] }>(
      query ? `/api/staff/orders?${query}` : "/api/staff/orders",
      { signal },
    );
  },
  calls: (params?: { status?: string; type?: string }, signal?: AbortSignal) => {
    const search = new URLSearchParams();
    if (params?.status) search.set("status", params.status);
    if (params?.type) search.set("type", params.type);
    const query = search.toString();
    return apiRequest<{ calls: readonly StaffCallPayload[] }>(
      query ? `/api/staff/calls?${query}` : "/api/staff/calls",
      { signal },
    );
  },
  updateOrderStatus: (orderId: string, status: string) =>
    apiRequest<{ orderId: string; status: string }>(`/api/orders/${orderId}/status`, {
      method: "PATCH",
      body: { status },
    }),
  updateOrderItemStatus: (
    orderItemId: string,
    status: string,
    reason: { expectedOrderVersion: number; reasonCode?: string; reasonNote?: string },
  ) =>
    apiRequest<{ orderItemId: string; status: string; reverted: boolean }>(
      `/api/order-items/${orderItemId}/status`,
      { method: "PATCH", body: { status, ...(reason ?? {}) } },
    ),
  tables: (signal?: AbortSignal) =>
    apiRequest<{ tables: readonly StaffTableResult[] }>("/api/staff/tables", { signal }),
  updateCall: (callId: string, status: "ACKNOWLEDGED" | "RESOLVED") =>
    apiRequest<StaffCallPayload>(`/api/staff/calls/${callId}`, {
      method: "PATCH",
      body: { status },
    }),
  createCall: (body: {
    tableId: string;
    type: "WAITER_CALL" | "BILL_REQUEST" | "OTHER";
    requestLabel?: string;
    notes?: string;
  }) => apiRequest<StaffCallPayload>("/api/staff/calls", { method: "POST", body }),
  menu: (signal?: AbortSignal, locale?: string) =>
    apiRequest<PublicMenuResult>(`/api/staff/menu${locale ? `?locale=${encodeURIComponent(locale)}` : ""}`, { signal }),
  createOrder: (
    body: {
      tableId: string;
      items: readonly { productId: string; quantity: number; note?: string }[];
      notes?: string;
    },
    idempotencyKey: string,
  ) =>
    apiRequest<CreateOrderPayload>("/api/staff/orders", {
      method: "POST",
      idempotencyKey,
      body,
    }),
  addOrderItems: (
    orderId: string,
    items: readonly { productId: string; quantity: number; note?: string }[],
    idempotencyKey: string,
  ) =>
    apiRequest<AddOrderItemsResult>(`/api/orders/${orderId}/items`, {
      method: "POST",
      idempotencyKey,
      body: { items },
    }),
  cancelOrderItem: (
    orderId: string,
    orderItemId: string,
    body: { reason: string; reasonNote?: string },
  ) =>
    apiRequest<CancelOrderItemResult>(
      `/api/orders/${orderId}/items/${orderItemId}/cancel`,
      { method: "POST", body },
    ),
  cancelOrder: (orderId: string, body: { reason: string; reasonNote?: string }) =>
    apiRequest<{ orderId: string; status: string }>(`/api/orders/${orderId}/cancel`, {
      method: "POST",
      body,
    }),
  transferTable: (sourceTableId: string, targetTableId: string) =>
    apiRequest<TableMoveResult>(`/api/staff/tables/${sourceTableId}/transfer`, {
      method: "POST",
      body: { targetTableId },
    }),
  mergeTables: (sourceTableId: string, targetTableId: string) =>
    apiRequest<TableMoveResult>("/api/staff/tables/merge", {
      method: "POST",
      body: { sourceTableId, targetTableId },
    }),
  resetTable: (tableId: string) =>
    apiRequest<TableResetResult>(`/api/staff/tables/${tableId}/reset`, {
      method: "POST",
      body: {},
    }),
  newIdempotencyKey,
};

/** The audit page plus the people who appear in it, for the actor filter. */
export type AuditLogPageResult = AuditLogPage & {
  readonly actors: readonly { readonly id: string; readonly name: string }[];
};

export const adminApi = {
  menu: (signal?: AbortSignal) =>
    apiRequest<{
      categories: readonly AdminCategoryResult[];
      products: readonly AdminProductResult[];
      /** False when no translation provider is configured for this deployment. */
      autoTranslateAvailable: boolean;
    }>("/api/admin/menu", { signal }),
  /**
   * Fills in the other languages for one already-saved row. Never sent as part
   * of a save: the dish is committed first, and this may fail on its own.
   */
  autoTranslate: (body: {
    entityType: "CATEGORY" | "PRODUCT";
    entityId: string;
    sourceLocale?: string;
    targetLocales?: readonly string[];
    overwrite?: boolean;
  }) =>
    apiRequest<AutoTranslateResult>("/api/admin/menu/translations/auto", {
      method: "POST",
      body,
    }),
  createCategory: (body: Record<string, unknown>) =>
    apiRequest<AdminCategoryResult>("/api/admin/categories", { method: "POST", body }),
  updateCategory: (categoryId: string, body: Record<string, unknown>) =>
    apiRequest<AdminCategoryResult>(`/api/admin/categories/${categoryId}`, {
      method: "PATCH",
      body,
    }),
  createProduct: (body: Record<string, unknown>) =>
    apiRequest<AdminProductResult>("/api/admin/products", { method: "POST", body }),
  updateProduct: (productId: string, body: Record<string, unknown>) =>
    apiRequest<AdminProductResult>(`/api/admin/products/${productId}`, {
      method: "PATCH",
      body,
    }),
  uploadProductImage: (productId: string, file: File) => {
    const formData = new FormData();
    formData.append("file", file);
    return apiRequest<AdminProductResult>(`/api/admin/products/${productId}/image`, {
      method: "POST",
      formData,
    });
  },
  /** Read-only. Re-derives every table's current QR address; rotates nothing. */
  tableQrCodes: (signal?: AbortSignal) =>
    apiRequest<TableQrCodesResult>("/api/admin/tables/qr-codes", { signal }),
  /** One transactional write of the whole running order. */
  reorderMenu: (body: {
    categories?: readonly { id: string; sortOrder: number }[];
    products?: readonly { id: string; sortOrder: number }[];
  }) =>
    apiRequest<{ categories: number; products: number }>("/api/admin/menu/order", {
      method: "PATCH",
      body,
    }),
  createTable: (body: { name: string; tableNumber: number; seats: number }) =>
    apiRequest<{ table: ManagedTableResult; rawToken: string }>("/api/admin/tables", {
      method: "POST",
      body,
    }),
  updateTable: (tableId: string, body: Record<string, unknown>) =>
    apiRequest<ManagedTableResult>(`/api/admin/tables/${tableId}`, { method: "PATCH", body }),
  rotateTableToken: (tableId: string) =>
    apiRequest<{ table: ManagedTableResult; rawToken: string }>(
      `/api/admin/tables/${tableId}/qr/rotate`,
      { method: "POST", body: {} },
    ),
  revokeTableToken: (tableId: string) =>
    apiRequest<ManagedTableResult>(`/api/admin/tables/${tableId}/qr/revoke`, {
      method: "POST",
      body: {},
    }),
  pauseTableQr: (tableId: string) =>
    apiRequest<ManagedTableResult>(`/api/admin/tables/${tableId}/qr/pause`, {
      method: "POST",
      body: {},
    }),
  resumeTableQr: (tableId: string) =>
    apiRequest<ManagedTableResult>(`/api/admin/tables/${tableId}/qr/resume`, {
      method: "POST",
      body: {},
    }),
  auditLogs: (query: string, signal?: AbortSignal) =>
    apiRequest<AuditLogPageResult>(`/api/admin/audit-logs?${query}`, { signal }),
  settings: (signal?: AbortSignal) =>
    apiRequest<RestaurantSettingsResult>("/api/admin/settings", { signal }),
  updateSettings: (body: Record<string, unknown>) =>
    apiRequest<RestaurantSettingsResult>("/api/admin/settings", { method: "PATCH", body }),
  staff: (query: string, signal?: AbortSignal) =>
    apiRequest<AdminStaffPage>(
      query ? `/api/admin/staff?${query}` : "/api/admin/staff",
      { signal },
    ),
  staffDetail: (staffId: string, signal?: AbortSignal) =>
    apiRequest<AdminStaffResult>(`/api/admin/staff/${staffId}`, { signal }),
  /** No password field: the account sets its own through the setup link. */
  createStaff: (body: {
    name: string;
    email: string;
    role: string;
    phone?: string;
    loginIdentifier?: string;
  }) =>
    apiRequest<{ staff: AdminStaffResult; passwordSetupEmailRequested: boolean }>(
      "/api/admin/staff",
      { method: "POST", body },
    ),
  updateStaff: (staffId: string, body: Record<string, unknown>) =>
    apiRequest<AdminStaffResult>(`/api/admin/staff/${staffId}`, { method: "PATCH", body }),
  requestStaffPasswordReset: (staffId: string) =>
    apiRequest<{ emailRequested: boolean; email: string }>(
      `/api/admin/staff/${staffId}/password-reset`,
      { method: "POST", body: {} },
    ),
  reports: (signal?: AbortSignal) =>
    apiRequest<AdminReportsResult>("/api/admin/reports", { signal }),
  reportSummary: (query: string, signal?: AbortSignal) =>
    apiRequest<ReportSummary>(`/api/admin/reports/summary?${query}`, { signal }),
  reportProducts: (query: string, signal?: AbortSignal) =>
    apiRequest<ProductReport>(`/api/admin/reports/products?${query}`, { signal }),
  reportBusiest: (query: string, signal?: AbortSignal) =>
    apiRequest<BusiestReport>(`/api/admin/reports/busiest?${query}`, { signal }),
  reportFinance: (query: string, signal?: AbortSignal) =>
    apiRequest<FinanceReport>(`/api/admin/reports/finance?${query}`, { signal }),
  reportTables: (query: string, signal?: AbortSignal) =>
    apiRequest<{ tables: readonly TableReportRow[] }>(
      `/api/admin/reports/tables?${query}`,
      { signal },
    ),
  reportStaff: (query: string, signal?: AbortSignal) =>
    apiRequest<{ staff: readonly StaffReportRow[] }>(`/api/admin/reports/staff?${query}`, {
      signal,
    }),
  reportReviewAlerts: (query: string, signal?: AbortSignal) =>
    apiRequest<ReviewReport>(`/api/admin/reports/review-alerts?${query}`, { signal }),
  reportReviewDetail: (query: string, signal?: AbortSignal) =>
    apiRequest<ReviewDetailReport>(`/api/admin/reports/review-alerts/detail?${query}`, {
      signal,
    }),
  reportCategories: (query: string, signal?: AbortSignal) =>
    apiRequest<readonly CategoryReportRow[]>(`/api/admin/reports/categories?${query}`, {
      signal,
    }),
  reportKitchen: (query: string, signal?: AbortSignal) =>
    apiRequest<KitchenReport>(`/api/admin/reports/kitchen?${query}`, { signal }),
  reportProductDetail: (query: string, signal?: AbortSignal) =>
    apiRequest<ProductDetailReport>(`/api/admin/reports/product-detail?${query}`, { signal }),
  /** End-of-day cash report for one restaurant-local calendar day. */
  cashierDayReport: (query: string, signal?: AbortSignal) =>
    apiRequest<DailyCashReport>(`/api/admin/reports/cashier-day?${query}`, { signal }),
  reportOrderTimeline: (orderId: string, signal?: AbortSignal) =>
    apiRequest<OrderTimelineReport>(
      `/api/admin/reports/order-timeline?orderId=${encodeURIComponent(orderId)}`,
      { signal },
    ),
};

export interface PaymentPayload {
  readonly paymentId: string;
  readonly orderId: string;
  readonly orderNumber: string;
  readonly amount: string;
  readonly method: "CASH" | "CARD" | "OTHER";
  readonly status: "COMPLETED";
  readonly processedAt: string;
  readonly replayed: boolean;
}

export const paymentApi = {
  /** Omitting `amount` settles the whole remaining balance. */
  collect: (
    body: {
      orderId: string;
      method: "CASH" | "CARD" | "OTHER";
      amount?: string;
      checkId?: string;
    },
    idempotencyKey: string,
  ) => apiRequest<PaymentPayload>("/api/payments", { method: "POST", idempotencyKey, body }),
  refund: (
    paymentId: string,
    body: { amount: string; reasonCode: string; note?: string },
    idempotencyKey: string,
  ) =>
    apiRequest<RefundResult>(`/api/payments/${paymentId}/refund`, {
      method: "POST",
      idempotencyKey,
      body,
    }),
  newIdempotencyKey,
};

export const cashierShiftApi = {
  current: (signal?: AbortSignal) =>
    apiRequest<CurrentShiftResult>("/api/cashier/shifts/current", { signal }),
  open: (body: {
    cashRegisterId: string;
    openingCash: string;
    /** A counted drawer. The server reprices it and ignores any client total. */
    cashCounts?: readonly {
      currency: string;
      denominationMinor: number;
      count: number;
    }[];
  }) =>
    apiRequest<ShiftDetailResult>("/api/cashier/shifts", { method: "POST", body }),
  close: (shiftId: string, body: { countedCash: string; note?: string }) =>
    apiRequest<ShiftDetailResult>(`/api/cashier/shifts/${shiftId}/close`, {
      method: "POST",
      body,
    }),
  /**
   * The key is the caller's, not this function's.
   *
   * Minting it here would defeat the point: a retry would arrive with a fresh
   * key and be written as a second movement. The panel holds one key for one
   * intended movement and reuses it across retries.
   */
  recordMovement: (
    shiftId: string,
    body: { type: "CASH_IN" | "CASH_OUT"; amount: string; reason: string; note?: string },
    idempotencyKey: string,
  ) =>
    apiRequest<{ movement: CashDrawerMovementRecord; summary: ShiftMoneySummary }>(
      `/api/cashier/shifts/${shiftId}/movements`,
      { method: "POST", idempotencyKey, body },
    ),
  detail: (shiftId: string, signal?: AbortSignal) =>
    apiRequest<ShiftDetailResult>(`/api/cashier/shifts/${shiftId}`, { signal }),
  /** Live snapshot of an open drawer; reading it changes nothing. */
  xReport: (shiftId: string, signal?: AbortSignal) =>
    apiRequest<XReport>(`/api/cashier/shifts/${shiftId}/x-report`, { signal }),
  /** The stored, immutable report of a closed drawer. */
  zReport: (shiftId: string, signal?: AbortSignal) =>
    apiRequest<ZReportSnapshot>(`/api/cashier/shifts/${shiftId}/z-report`, { signal }),
  history: (query: string, signal?: AbortSignal) =>
    apiRequest<ShiftHistoryPage>(
      query ? `/api/cashier/shifts?${query}` : "/api/cashier/shifts",
      { signal },
    ),
};

export const cashRegisterApi = {
  list: (signal?: AbortSignal) =>
    apiRequest<{ registers: readonly CashRegisterResult[] }>("/api/admin/cash-registers", {
      signal,
    }),
  create: (body: { name: string; code: string }) =>
    apiRequest<CashRegisterResult>("/api/admin/cash-registers", { method: "POST", body }),
  update: (registerId: string, body: { name?: string; isActive?: boolean; archived?: boolean }) =>
    apiRequest<CashRegisterResult>(`/api/admin/cash-registers/${registerId}`, {
      method: "PATCH",
      body,
    }),
};

export type PrinterRouteResult = Awaited<
  ReturnType<PrinterAdminService["listRoutes"]>
>[number];
export type PrintJobHistory = Awaited<ReturnType<PrintService["history"]>>;

/**
 * Printer administration. `createAgent` and the `ROTATE_TOKEN` action are the
 * only calls that ever return a raw token, and only in that one response.
 */
export const printerApi = {
  listAgents: (signal?: AbortSignal) =>
    apiRequest<{ agents: readonly AgentResult[] }>("/api/admin/printer-agents", { signal }),
  createAgent: (body: { name: string }) =>
    apiRequest<{ agent: AgentResult; rawToken: string }>("/api/admin/printer-agents", {
      method: "POST",
      body,
    }),
  updateAgent: (
    agentId: string,
    body: { name?: string; isActive?: boolean; action?: "ROTATE_TOKEN" | "REVOKE" },
  ) =>
    apiRequest<{ agent: AgentResult; rawToken?: string }>(
      `/api/admin/printer-agents/${agentId}`,
      { method: "PATCH", body },
    ),
  listPrinters: (signal?: AbortSignal) =>
    apiRequest<{ printers: readonly PrinterResult[] }>("/api/admin/printers", { signal }),
  createPrinter: (body: Record<string, unknown>) =>
    apiRequest<PrinterResult>("/api/admin/printers", { method: "POST", body }),
  updatePrinter: (printerId: string, body: Record<string, unknown>) =>
    apiRequest<PrinterResult>(`/api/admin/printers/${printerId}`, { method: "PATCH", body }),
  listRoutes: (signal?: AbortSignal) =>
    apiRequest<{ routes: readonly PrinterRouteResult[] }>("/api/admin/printer-routes", {
      signal,
    }),
  createRoute: (body: Record<string, unknown>) =>
    apiRequest<{ id: string }>("/api/admin/printer-routes", { method: "POST", body }),
  updateRoute: (routeId: string, body: { isActive?: boolean; copies?: number }) =>
    apiRequest<{ id: string }>(`/api/admin/printer-routes/${routeId}`, {
      method: "PATCH",
      body,
    }),
  listJobs: (query: string, signal?: AbortSignal) =>
    apiRequest<PrintJobHistory>(`/api/admin/print-jobs?${query}`, { signal }),
  retryJob: (jobId: string) =>
    apiRequest<{ jobId: string; status: string }>(`/api/admin/print-jobs/${jobId}`, {
      method: "POST",
      body: { action: "RETRY" },
    }),
  /** Returns the id of the new job; the original row is left untouched. */
  reprintJob: (jobId: string, reason: string) =>
    apiRequest<{ jobId: string }>(`/api/admin/print-jobs/${jobId}`, {
      method: "POST",
      body: { action: "REPRINT", reason },
    }),
  testPrint: (printerId: string) => printApi.send({ documentType: "TEST_PRINT", printerId }),
};

/**
 * Staff-initiated printing. The body names a document and its source; every
 * figure on the paper is read from the database by the server.
 */
export const printApi = {
  send: (
    body:
      | { documentType: "CUSTOMER_BILL"; orderId: string }
      | { documentType: "PAYMENT_RECEIPT"; paymentId: string }
      | { documentType: "X_REPORT"; shiftId: string }
      | { documentType: "Z_REPORT"; shiftId: string }
      | { documentType: "TEST_PRINT"; printerId: string },
  ) => apiRequest<EnqueueResult>("/api/print", { method: "POST", body }),
  /** Kitchen ticket status per order; absent means no ticket was ever queued. */
  kitchenStatus: (orderIds: readonly string[], signal?: AbortSignal) =>
    apiRequest<{ statuses: Record<string, "PENDING" | "PRINTED" | "FAILED"> }>(
      `/api/print/status?orderIds=${encodeURIComponent(orderIds.join(","))}`,
      { signal },
    ),
};

export interface DemoTableRow {
  readonly id: string;
  readonly name: string;
  readonly tableNumber: number;
  readonly seats: number;
  readonly status: string;
}

/** Prototype launcher only; the routes 404 unless the demo flag is on. */
export const demoApi = {
  tables: (signal?: AbortSignal) =>
    apiRequest<{
      restaurant: { name: string; slug: string };
      tables: readonly DemoTableRow[];
    }>("/api/demo/tables", { signal }),
  tableMenu: (tableId: string) =>
    apiRequest<{ path: string; table: { name: string; tableNumber: number } }>(
      "/api/demo/table-menu",
      { method: "POST", body: { tableId } },
    ),
};

export const ledgerApi = {
  get: (orderId: string, signal?: AbortSignal) =>
    apiRequest<OrderLedgerResult>(`/api/orders/${orderId}/ledger`, { signal }),
};

export const checkApi = {
  list: (orderId: string, signal?: AbortSignal) =>
    apiRequest<OrderChecksResult>(`/api/orders/${orderId}/checks`, { signal }),
  splitEqually: (orderId: string, shares: number) =>
    apiRequest<OrderChecksResult>(`/api/orders/${orderId}/checks`, {
      method: "POST",
      body: { mode: "EQUAL", shares },
    }),
  splitByItems: (
    orderId: string,
    checks: readonly {
      label?: string;
      items: readonly { orderItemId: string; quantity: number }[];
    }[],
  ) =>
    apiRequest<OrderChecksResult>(`/api/orders/${orderId}/checks`, {
      method: "POST",
      body: { mode: "ITEMS", checks },
    }),
  /**
   * Absolute state, not a delta: sending the same body twice leaves the check
   * in the same place, so a retried request cannot double-apply anything.
   */
  update: (
    orderId: string,
    checkId: string,
    body: {
      label?: string;
      allocations?: readonly { orderItemId: string; quantity: number }[];
    },
  ) =>
    apiRequest<OrderChecksResult>(`/api/orders/${orderId}/checks/${checkId}`, {
      method: "PATCH",
      body,
    }),
  cancel: (orderId: string, checkId: string) =>
    apiRequest<OrderChecksResult>(`/api/orders/${orderId}/checks/${checkId}`, {
      method: "DELETE",
    }),
};

export const orderItemApi = {
  void: (
    orderId: string,
    orderItemId: string,
    body: { reasonCode: string; note?: string },
  ) =>
    apiRequest<CancelOrderItemResult>(
      `/api/orders/${orderId}/items/${orderItemId}/void`,
      { method: "POST", body },
    ),
};
