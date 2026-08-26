import { z } from "zod";

import { PAYMENT_METHODS } from "@/lib/domain/status";
import { entityIdSchema, moneyDecimalSchema } from "./common";

/**
 * A split or part payment may name the share being collected, but the server
 * still rejects anything above the balance it derives itself. Omitting `amount`
 * keeps the Phase 4 behaviour of settling the whole remaining bill.
 */
export const createPaymentBodySchema = z
  .object({
    orderId: entityIdSchema,
    method: z.enum(PAYMENT_METHODS),
    amount: moneyDecimalSchema.optional(),
    checkId: entityIdSchema.optional(),
  })
  .strict();

export type CreatePaymentBody = z.infer<typeof createPaymentBodySchema>;
