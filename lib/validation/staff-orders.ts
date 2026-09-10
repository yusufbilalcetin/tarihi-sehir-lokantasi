import { z } from "zod";

import { ORDER_STATUSES } from "../domain/status";
import { entityIdSchema, noteSchema, orderIdSchema, orderItemIdSchema } from "./common";
import { createOrderItemInputSchema } from "./order";

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Tarih YYYY-AA-GG biçiminde olmalıdır.")
  .refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, "Geçerli bir tarih girin.");

export const staffOrderListQuerySchema = z
  .object({
    status: z.enum(ORDER_STATUSES).optional(),
    tableId: z.string().trim().min(1).max(128).optional(),
    date: dateSchema.optional(),
    /**
     * Live-service screens ask for the orders still owed to a table. Without it
     * the newest `limit` rows are returned whatever their status, so a busy day
     * lets settled orders push a ticket that is still cooking off the end of
     * the list — and off the kitchen screen.
     */
    open: z.enum(["true", "false"]).optional(),
    /**
     * The till asks for each order's money position. Opt-in, because the pass
     * and the floor have no use for it and should not be made to carry it —
     * nor should a kitchen screen be handed the restaurant's takings.
     */
    withBalance: z.enum(["true", "false"]).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();

export const staffOrderStatusBodySchema = z
  .object({
    status: z.enum([
      "CONFIRMED",
      "PREPARING",
      "READY",
      "SERVED",
      "COMPLETED",
      "CANCELLED",
    ]),
  })
  .strict();

/** Kitchen reasons for undoing a preparation step. Free text stays optional. */
export const ORDER_ITEM_ROLLBACK_REASONS = [
  "UNDERCOOKED",
  "REHEAT",
  "MARKED_BY_MISTAKE",
  "OTHER",
] as const;

export const staffOrderItemStatusBodySchema = z
  .object({
    // PENDING and PREPARING are reachable backwards: the kitchen correcting its
    // own step. The role and stage rules decide who may actually do it.
    status: z.enum(["PENDING", "PREPARING", "READY", "SERVED"]),
    expectedOrderVersion: z.number().int().min(1),
    reasonCode: z.enum(ORDER_ITEM_ROLLBACK_REASONS).optional(),
    reasonNote: z.string().trim().max(200).optional(),
  })
  .strict();

/** A waiter opening an order at the table; prices are never client-supplied. */
export const staffOrderCreateBodySchema = z
  .object({
    tableId: entityIdSchema,
    items: z.array(createOrderItemInputSchema).min(1).max(50),
    notes: noteSchema,
  })
  .strict()
  .superRefine((order, refinement) => {
    const lines = new Set<string>();
    order.items.forEach((item, index) => {
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

export const staffOrderIdParamsSchema = z.object({ orderId: orderIdSchema }).strict();
export const staffOrderItemIdParamsSchema = z
  .object({ orderItemId: orderItemIdSchema })
  .strict();

export type StaffOrderCreateBody = z.infer<typeof staffOrderCreateBodySchema>;
export type StaffOrderListQuery = z.infer<typeof staffOrderListQuerySchema>;
export type StaffOrderStatusBody = z.infer<typeof staffOrderStatusBodySchema>;
export type StaffOrderItemStatusBody = z.infer<typeof staffOrderItemStatusBodySchema>;
