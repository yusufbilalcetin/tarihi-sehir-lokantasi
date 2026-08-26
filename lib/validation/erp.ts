import { z } from "zod";

const decimal = z.string().trim().regex(/^[+-]?\d+(?:[.,]\d{1,6})?$/, "En fazla 6 ondalık basamaklı miktar girin.");
const nonNegativeDecimal = decimal.refine((value) => !value.startsWith("-"), "Miktar negatif olamaz.");
const positiveDecimal = nonNegativeDecimal.refine((value) => !/^0+(?:[.,]0+)?$/.test(value), "Miktar sıfırdan büyük olmalıdır.");
const money = z.string().trim().regex(/^\d+(?:[.,]\d{1,2})?$/, "Para tutarı en fazla 2 ondalık basamak içermelidir.");
const optionalText = (max: number) => z.string().trim().max(max).optional().nullable().transform((value) => value || null);
const isoDate = z.iso.datetime({ offset: true }).transform((value) => new Date(value));

export const erpCommandSchema = z.discriminatedUnion("command", [
  z.object({ command: z.literal("CREATE_WAREHOUSE"), name: z.string().trim().min(2).max(120), code: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9_-]{0,39}$/) }),
  z.object({ command: z.literal("CREATE_INVENTORY_ITEM"), name: z.string().trim().min(2).max(160), category: optionalText(80), baseUnit: z.enum(["MG", "G", "KG", "ML", "L", "UNIT", "PACKAGE", "CASE"]), reorderLevel: nonNegativeDecimal.default("0"), negativeStockPolicy: z.enum(["WARN", "BLOCK"]).default("WARN") }),
  z.object({ command: z.literal("POST_STOCK_MOVEMENT"), inventoryItemId: z.uuid(), warehouseId: z.uuid(), movementType: z.enum(["PURCHASE_RECEIPT", "PRODUCTION_CONSUMPTION", "MANUAL_ADJUSTMENT", "WASTE", "STAFF_MEAL", "COMPLIMENTARY", "TRANSFER_IN", "TRANSFER_OUT", "COUNT_CORRECTION", "RETURN_TO_SUPPLIER"]), quantityDelta: decimal.refine((value) => !/^[-+]?0+(?:[.,]0+)?$/.test(value), "Hareket miktarı sıfır olamaz."), unitCost: optionalText(30).refine((value) => value === null || /^\d+(?:[.,]\d{1,6})?$/.test(value), "Birim maliyet geçersiz."), sourceType: z.string().trim().min(2).max(50), sourceId: z.uuid().optional().nullable().transform((value) => value ?? null), idempotencyKey: z.string().trim().min(8).max(160), reason: z.string().trim().min(3).max(300) }),
  z.object({ command: z.literal("CREATE_RECIPE"), productId: z.uuid(), yieldPortions: positiveDecimal, ingredients: z.array(z.object({ inventoryItemId: z.uuid(), quantity: positiveDecimal, unit: z.enum(["MG", "G", "KG", "ML", "L", "UNIT", "PACKAGE", "CASE"]) })).min(1).max(100) }),
  z.object({ command: z.literal("CREATE_SUPPLIER"), name: z.string().trim().min(2).max(180), contactPerson: optionalText(160), phone: optionalText(40), email: z.string().trim().email().max(254).optional().nullable().transform((value) => value || null), notes: optionalText(1000) }),
  z.object({ command: z.literal("CREATE_SCHEDULE"), staffId: z.uuid(), startsAt: isoDate, endsAt: isoDate, roleLabel: optionalText(80), locationLabel: optionalText(120), notes: optionalText(300) }),
  z.object({ command: z.literal("CREATE_RESERVATION"), tableId: z.uuid().optional().nullable().transform((value) => value ?? null), customerName: z.string().trim().min(2).max(160), phone: z.string().trim().min(7).max(40), partySize: z.number().int().min(1).max(100), startsAt: isoDate, endsAt: isoDate, notes: optionalText(500) }),
  z.object({
    command: z.literal("CREATE_FULFILLMENT_REQUEST"),
    channel: z.enum(["TAKEAWAY", "DELIVERY"]),
    customerName: z.string().trim().min(2).max(160),
    contact: z.string().trim().min(7).max(80),
    address: optionalText(2000),
    deliveryNotes: optionalText(500),
    requestedAt: z.iso.datetime({ offset: true }).transform((value) => new Date(value)).optional().nullable().transform((value) => value ?? null),
    deliveryFee: money.default("0"),
    idempotencyKey: z.string().trim().min(8).max(160),
    // No unit price: the client names the products, the server prices them.
    items: z.array(z.object({ productId: z.uuid(), quantity: z.number().int().min(1).max(99), notes: optionalText(500) })).min(1).max(50),
  }).superRefine((command, ctx) => {
    // Mirrors fulfillment_requests_channel_check so the person gets a written
    // reason instead of a constraint violation.
    if (command.channel === "DELIVERY" && !command.address) {
      ctx.addIssue({ code: "custom", path: ["address"], message: "Kurye siparişi için teslimat adresi zorunludur." });
    }
    if (command.channel === "TAKEAWAY" && command.address) {
      ctx.addIssue({ code: "custom", path: ["address"], message: "Gel-al siparişinde teslimat adresi bulunmaz." });
    }
  }),
  z.object({ command: z.literal("CREATE_CUSTOMER_ACCOUNT"), name: z.string().trim().min(2).max(160), email: z.string().trim().email().max(254).optional().nullable().transform((value) => value || null), phone: optionalText(40), marketingConsent: z.boolean().default(false) }),
  z.object({ command: z.literal("REFRESH_POPULAR"), windowDays: z.number().int().min(1).max(366).default(30) }),
  z.object({ command: z.literal("CREATE_PRODUCTION_BATCH"), productId: z.uuid(), recipeVersionId: z.uuid(), warehouseId: z.uuid(), businessDate: z.iso.date(), plannedPortions: positiveDecimal, idempotencyKey: z.string().trim().min(8).max(160) }),
  z.object({ command: z.literal("COMPLETE_PRODUCTION_BATCH"), batchId: z.uuid(), actualPortions: positiveDecimal }),
  z.object({ command: z.literal("RECORD_WASTE"), warehouseId: z.uuid(), inventoryItemId: z.uuid(), wasteType: z.enum(["SPOILAGE", "SPILL", "PREPARATION_WASTE", "STAFF_MEAL", "COMPLIMENTARY", "OTHER"]), quantity: positiveDecimal, unit: z.enum(["MG", "G", "KG", "ML", "L", "UNIT", "PACKAGE", "CASE"]), estimatedCost: money.default("0"), reason: z.string().trim().min(3).max(300), idempotencyKey: z.string().trim().min(8).max(160) }),
  z.object({ command: z.literal("CREATE_PURCHASE_ORDER"), supplierId: z.uuid(), orderNumber: z.string().trim().min(2).max(40), expectedAt: z.iso.datetime({ offset: true }).transform((value) => new Date(value)).optional().nullable().transform((value) => value ?? null), notes: optionalText(1000), items: z.array(z.object({ inventoryItemId: z.uuid(), orderedQuantity: positiveDecimal, unit: z.enum(["MG", "G", "KG", "ML", "L", "UNIT", "PACKAGE", "CASE"]), unitPrice: money })).min(1).max(100) }),
  z.object({ command: z.literal("RECEIVE_GOODS"), purchaseOrderId: z.uuid(), supplierId: z.uuid(), warehouseId: z.uuid(), receiptNumber: z.string().trim().min(2).max(60), idempotencyKey: z.string().trim().min(8).max(160), items: z.array(z.object({ purchaseOrderItemId: z.uuid(), inventoryItemId: z.uuid(), receivedQuantity: positiveDecimal, unit: z.enum(["MG", "G", "KG", "ML", "L", "UNIT", "PACKAGE", "CASE"]), unitPrice: money })).min(1).max(100) }),
  z.object({ command: z.literal("CREATE_SUPPLIER_INVOICE"), supplierId: z.uuid(), goodsReceiptId: z.uuid().optional().nullable().transform((value) => value ?? null), invoiceNumber: z.string().trim().min(2).max(80), total: money.refine((value) => !/^0+(?:[.,]0+)?$/.test(value), "Fatura toplamı sıfırdan büyük olmalıdır."), dueDate: z.iso.date().optional().nullable().transform((value) => value ?? null) }),
  z.object({ command: z.literal("RECORD_SUPPLIER_PAYMENT"), supplierId: z.uuid(), supplierInvoiceId: z.uuid(), amount: money.refine((value) => !/^0+(?:[.,]0+)?$/.test(value), "Ödeme sıfırdan büyük olmalıdır."), method: z.enum(["BANK", "CASH", "OTHER"]), reference: optionalText(100), idempotencyKey: z.string().trim().min(8).max(160) }),
]);

export type ErpCommand = z.infer<typeof erpCommandSchema>;
