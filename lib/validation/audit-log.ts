import { z } from "zod";

import { entityIdSchema } from "./common";

const daySchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Tarih YYYY-AA-GG olmalıdır.");

/** Bounded on purpose: a page size is a cost, not a preference. */
export const auditLogQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(1000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
    search: z.string().trim().min(1).max(120).optional(),
    actorId: entityIdSchema.optional(),
    action: z.string().trim().min(1).max(100).optional(),
    dateFrom: daySchema.optional(),
    dateTo: daySchema.optional(),
  })
  .strict();

export type AuditLogQueryInput = z.infer<typeof auditLogQuerySchema>;
