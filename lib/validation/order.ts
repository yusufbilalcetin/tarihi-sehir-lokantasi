import { z } from "zod";
import {
  ORDER_ITEM_STATUSES,
  ORDER_STATUSES,
} from "../domain/status";
import {
  idempotencyKeySchema,
  isoDateTimeSchema,
  noteSchema,
  orderIdSchema,
  orderItemIdSchema,
  productIdSchema,
  quantitySchema,
} from "./common";

export const createOrderItemInputSchema = z
  .object({
    productId: productIdSchema,
    quantity: quantitySchema,
    note: noteSchema,
  })
  .strict();

export const createOrderInputSchema = z
  .object({
    items: z
      .array(createOrderItemInputSchema)
      .min(1, "Sipariş en az bir ürün içermelidir.")
      .max(50, "Sipariş en fazla 50 farklı kalem içerebilir."),
    notes: noteSchema,
    idempotencyKey: idempotencyKeySchema,
  })
  .strict()
  .superRefine((order, context) => {
    const lineKeys = new Set<string>();
    order.items.forEach((item, index) => {
      const key = JSON.stringify([item.productId, item.note ?? ""]);
      if (lineKeys.has(key)) {
        context.addIssue({
          code: "custom",
          path: ["items", index],
          message: "Aynı ürün ve not kombinasyonu yalnızca bir sipariş kalemi olabilir.",
        });
      }
      lineKeys.add(key);
    });
  });

export const updateOrderStatusInputSchema = z
  .object({
    orderId: orderIdSchema,
    status: z.enum(ORDER_STATUSES),
    expectedUpdatedAt: isoDateTimeSchema.optional(),
  })
  .strict();

export const updateOrderItemStatusInputSchema = z
  .object({
    orderId: orderIdSchema,
    orderItemId: orderItemIdSchema,
    status: z.enum(ORDER_ITEM_STATUSES),
    expectedUpdatedAt: isoDateTimeSchema.optional(),
  })
  .strict();

export type CreateOrderItemInput = z.infer<typeof createOrderItemInputSchema>;
export type CreateOrderInput = z.infer<typeof createOrderInputSchema>;
export type UpdateOrderStatusInput = z.infer<typeof updateOrderStatusInputSchema>;
export type UpdateOrderItemStatusInput = z.infer<typeof updateOrderItemStatusInputSchema>;
