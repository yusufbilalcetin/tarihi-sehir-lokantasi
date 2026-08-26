import { z } from "zod";

const percentageSchema = z
  .string()
  .trim()
  .regex(/^\d{1,3}(\.\d{1,2})?$/, "Oran en fazla iki ondalık basamak içerebilir.")
  .refine((value) => Number(value) >= 0 && Number(value) <= 100, "Oran 0 ile 100 arasında olmalıdır.");

export const updateSettingsBodySchema = z
  .object({
    menuEnabled: z.boolean().optional(),
    orderingEnabled: z.boolean().optional(),
    waiterCallEnabled: z.boolean().optional(),
    billRequestEnabled: z.boolean().optional(),
    introEnabled: z.boolean().optional(),
    waiterApprovalRequired: z.boolean().optional(),
    customerNotesEnabled: z.boolean().optional(),
    menuImagesEnabled: z.boolean().optional(),
    serviceFeeRate: percentageSchema.optional(),
    taxRate: percentageSchema.optional(),
    maxItemQuantity: z.number().int().min(1).max(99).optional(),
    orderNotesMaxLength: z.number().int().min(0).max(1000).optional(),
    waiterCallCooldownSeconds: z.number().int().min(0).max(3600).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, "Güncellenecek alan gönderin.");
