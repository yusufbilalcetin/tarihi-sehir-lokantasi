import { z } from "zod";

import {
  FINANCIAL_NOTE_MAX_LENGTH,
  REFUND_REASON_CODES,
  VOID_REASON_CODES,
} from "../domain/financial-operations";
import {
  CANCELLATION_NOTE_MAX_LENGTH,
  CANCELLATION_REASONS,
} from "../domain/order-mutations";
import { entityIdSchema, moneyDecimalSchema } from "./common";
import { createOrderItemInputSchema } from "./order";

/** Appending a later round; prices are never part of the request. */
export const addOrderItemsBodySchema = z
  .object({
    items: z.array(createOrderItemInputSchema).min(1).max(50),
  })
  .strict()
  .superRefine((body, refinement) => {
    const lines = new Set<string>();
    body.items.forEach((item, index) => {
      const key = JSON.stringify([item.productId, item.note ?? ""]);
      if (lines.has(key)) {
        refinement.addIssue({
          code: "custom",
          path: ["items", index],
          message: "Aynı ürün ve not kombinasyonu tekrar edemez.",
        });
      }
      lines.add(key);
    });
  });

export const cancellationBodySchema = z
  .object({
    reason: z.enum(CANCELLATION_REASONS),
    reasonNote: z.string().trim().max(CANCELLATION_NOTE_MAX_LENGTH).optional(),
  })
  .strict();

/** Void and refund share one reason shape; only the code list differs. */
export const voidBodySchema = z
  .object({
    reasonCode: z.enum(VOID_REASON_CODES),
    note: z.string().trim().max(FINANCIAL_NOTE_MAX_LENGTH).optional(),
  })
  .strict();

export const refundBodySchema = z
  .object({
    amount: moneyDecimalSchema,
    reasonCode: z.enum(REFUND_REASON_CODES),
    note: z.string().trim().max(FINANCIAL_NOTE_MAX_LENGTH).optional(),
  })
  .strict();

export const paymentIdParamsSchema = z.object({ paymentId: entityIdSchema }).strict();

export const checkIdParamsSchema = z
  .object({ orderId: entityIdSchema, checkId: entityIdSchema })
  .strict();

const checkDraftSchema = z
  .object({
    label: z.string().trim().max(80).optional(),
    items: z
      .array(
        z
          .object({ orderItemId: entityIdSchema, quantity: z.number().int().min(1).max(99) })
          .strict(),
      )
      .min(1)
      .max(50),
  })
  .strict();

/** Two split modes; the server derives every amount either way. */
export const createChecksBodySchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("ITEMS"), checks: z.array(checkDraftSchema).min(1).max(20) }).strict(),
  z.object({ mode: z.literal("EQUAL"), shares: z.number().int().min(2).max(20) }).strict(),
]);

export type CreateChecksBody = z.infer<typeof createChecksBodySchema>;

/** Editing an untouched check: label, allocations, or both. */
export const updateCheckBodySchema = z
  .object({
    label: z.string().trim().min(1).max(80).optional(),
    allocations: z
      .array(
        z
          .object({ orderItemId: entityIdSchema, quantity: z.number().int().min(1).max(99) })
          .strict(),
      )
      .min(1)
      .max(50)
      .optional(),
  })
  .strict()
  .refine(
    (body) => body.label !== undefined || body.allocations !== undefined,
    "Değiştirilecek bir alan gereklidir.",
  );

export type UpdateCheckBody = z.infer<typeof updateCheckBodySchema>;

export const orderItemParamsSchema = z
  .object({ orderId: entityIdSchema, orderItemId: entityIdSchema })
  .strict();

export const tableIdParamsSchema = z.object({ tableId: entityIdSchema }).strict();

export const tableMoveBodySchema = z
  .object({ targetTableId: entityIdSchema })
  .strict();

export const tableMergeBodySchema = z
  .object({ sourceTableId: entityIdSchema, targetTableId: entityIdSchema })
  .strict();

export type AddOrderItemsBody = z.infer<typeof addOrderItemsBodySchema>;
export type CancellationBody = z.infer<typeof cancellationBodySchema>;
export type TableMoveBody = z.infer<typeof tableMoveBodySchema>;
export type TableMergeBody = z.infer<typeof tableMergeBodySchema>;
