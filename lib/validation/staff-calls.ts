import { z } from "zod";

import {
  WAITER_CALL_STATUSES,
  WAITER_CALL_TYPES,
} from "@/lib/domain/status";
import { entityIdSchema } from "./common";

export const staffCallListQuerySchema = z
  .object({
    type: z.enum(WAITER_CALL_TYPES).optional(),
    status: z.enum(WAITER_CALL_STATUSES).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();

export const staffCallIdParamsSchema = z.object({ callId: entityIdSchema }).strict();

/** Staff-opened service request; the table is the only client-supplied target. */
export const staffCallCreateBodySchema = z
  .object({
    tableId: entityIdSchema,
    type: z.enum(WAITER_CALL_TYPES),
    requestLabel: z.string().trim().max(120).optional(),
    notes: z.string().trim().max(500).optional(),
  })
  .strict();

export type StaffCallCreateBody = z.infer<typeof staffCallCreateBodySchema>;

/** Staff may only move a call forward; cancellation stays a customer/domain concern. */
export const staffCallStatusBodySchema = z
  .object({ status: z.enum(["ACKNOWLEDGED", "RESOLVED"]) })
  .strict();

export type StaffCallStatusBody = z.infer<typeof staffCallStatusBodySchema>;
