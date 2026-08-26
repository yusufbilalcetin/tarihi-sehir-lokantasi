import { z } from "zod";

import { ERP_WORKSPACE_MODULES } from "@/lib/domain/erp-workspaces";

const uuid = z.uuid();
const decimal = z.string().trim().regex(/^\d+(?:[.,]\d{1,6})?$/, "En fazla 6 ondalık basamaklı pozitif miktar girin.");
const positiveDecimal = decimal.refine((value) => !/^0+(?:[.,]0+)?$/.test(value), "Miktar sıfırdan büyük olmalıdır.");
const money = z.string().trim().regex(/^\d+(?:[.,]\d{1,2})?$/, "Para tutarı en fazla 2 ondalık basamak içermelidir.");
const optionalText = (max: number) => z.string().trim().max(max).optional().nullable().transform((value) => value || null);
const isoDateTime = z.iso.datetime({ offset: true }).transform((value) => new Date(value));
const unit = z.enum(["MG", "G", "KG", "ML", "L", "UNIT", "PACKAGE", "CASE"]);

export const erpWorkspaceModuleSchema = z.enum(ERP_WORKSPACE_MODULES);

export const erpWorkspaceQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(10).max(100).default(25),
  search: z.string().trim().max(120).default(""),
  status: z.string().trim().max(40).default(""),
  category: z.string().trim().max(80).default(""),
  warehouseId: uuid.optional().nullable().default(null),
  dateFrom: z.iso.date().optional().nullable().default(null),
  dateTo: z.iso.date().optional().nullable().default(null),
});

export const erpWorkspaceCommandSchema = z.discriminatedUnion("command", [
  z.object({
    command: z.literal("TRANSFER_STOCK"),
    sourceWarehouseId: uuid,
    destinationWarehouseId: uuid,
    inventoryItemId: uuid,
    quantity: positiveDecimal,
    note: z.string().trim().min(3).max(300),
    idempotencyKey: z.string().trim().min(8).max(120),
  }),
  z.object({
    command: z.literal("CONFIRM_STOCK_COUNT"),
    warehouseId: uuid,
    idempotencyKey: z.string().trim().min(8).max(120),
    lines: z.array(z.object({ inventoryItemId: uuid, expectedQuantity: decimal, countedQuantity: decimal })).min(1).max(500),
  }),
  z.object({
    command: z.literal("UPDATE_INVENTORY_ITEM"),
    inventoryItemId: uuid,
    category: optionalText(80),
    reorderLevel: decimal,
    negativeStockPolicy: z.enum(["WARN", "BLOCK"]),
    isActive: z.boolean(),
  }),
  z.object({
    command: z.literal("UPDATE_DRAFT_RECIPE"),
    recipeVersionId: uuid,
    yieldPortions: positiveDecimal,
    ingredients: z.array(z.object({ inventoryItemId: uuid, quantity: positiveDecimal, unit })).min(1).max(100),
  }),
  z.object({ command: z.literal("SET_RECIPE_STATUS"), recipeVersionId: uuid, status: z.enum(["ACTIVE", "RETIRED"]) }),
  z.object({
    command: z.literal("UPDATE_SUPPLIER"), supplierId: uuid, name: z.string().trim().min(2).max(180),
    contactPerson: optionalText(160), phone: optionalText(40), email: z.string().trim().email().max(254).optional().nullable().transform((value) => value || null),
    notes: optionalText(1000), isActive: z.boolean(),
  }),
  z.object({
    command: z.literal("UPSERT_SUPPLIER_ITEM"), supplierId: uuid, inventoryItemId: uuid,
    supplierItemCode: optionalText(80), packQuantity: positiveDecimal, packUnit: unit,
    lastUnitPrice: money, leadTimeDays: z.number().int().min(0).max(365).optional().nullable().transform((value) => value ?? null), isActive: z.boolean(),
  }),
  z.object({ command: z.literal("SET_PURCHASE_ORDER_STATUS"), purchaseOrderId: uuid, status: z.enum(["SENT", "CANCELLED"]) }),
  z.object({
    command: z.literal("CORRECT_ATTENDANCE"), attendanceRecordId: uuid,
    clockInAt: isoDateTime, clockOutAt: isoDateTime.optional().nullable().transform((value) => value ?? null),
    breakMinutes: z.number().int().min(0).max(1440), reason: z.string().trim().min(5).max(300),
  }),
  z.object({ command: z.literal("SET_SCHEDULE_STATUS"), scheduleId: uuid, status: z.enum(["CONFIRMED", "COMPLETED", "CANCELLED"]) }),
  z.object({
    command: z.literal("UPSERT_PAYROLL"), staffId: uuid, periodStart: z.iso.date(), periodEnd: z.iso.date(),
    workedMinutes: z.number().int().min(0), overtimeMinutes: z.number().int().min(0), grossSalary: money,
    allowances: money, deductions: money, status: z.enum(["DRAFT", "APPROVED", "PAID"]), correctionReason: optionalText(300),
  }),
  z.object({ command: z.literal("SET_FEEDBACK_STATUS"), feedbackId: uuid, status: z.enum(["REVIEWED", "HIDDEN"]) }),
  z.object({
    command: z.literal("UPDATE_RESERVATION"), reservationId: uuid, tableId: uuid.optional().nullable().transform((value) => value ?? null),
    customerName: z.string().trim().min(2).max(160), phone: z.string().trim().min(7).max(40), partySize: z.number().int().min(1).max(100),
    startsAt: isoDateTime, endsAt: isoDateTime, notes: optionalText(500),
  }),
  z.object({ command: z.literal("SET_RESERVATION_STATUS"), reservationId: uuid, status: z.enum(["CONFIRMED", "SEATED", "COMPLETED", "CANCELLED", "NO_SHOW"]) }),
  z.object({ command: z.literal("LINK_FULFILLMENT_ORDER"), fulfillmentId: uuid, orderId: uuid }),
  z.object({ command: z.literal("SET_FULFILLMENT_STATUS"), fulfillmentId: uuid, status: z.enum(["PLACED", "WAITING_FOR_COURIER", "OUT_FOR_DELIVERY", "DELIVERED", "CANCELLED"]) }),
]);

export type ErpWorkspaceCommand = z.infer<typeof erpWorkspaceCommandSchema>;
