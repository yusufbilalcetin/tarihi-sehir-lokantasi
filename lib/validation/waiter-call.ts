import { z } from "zod";
import { WAITER_CALL_STATUSES, WAITER_CALL_TYPES } from "../domain/status";
import {
  noteSchema,
  waiterCallIdSchema,
} from "./common";

export const createWaiterCallInputSchema = z
  .object({
    type: z.enum(WAITER_CALL_TYPES),
    notes: noteSchema,
  })
  .strict();

export const updateWaiterCallStatusInputSchema = z
  .object({
    waiterCallId: waiterCallIdSchema,
    status: z.enum(WAITER_CALL_STATUSES),
  })
  .strict();

export type CreateWaiterCallInput = z.infer<typeof createWaiterCallInputSchema>;
export type UpdateWaiterCallStatusInput = z.infer<typeof updateWaiterCallStatusInputSchema>;
