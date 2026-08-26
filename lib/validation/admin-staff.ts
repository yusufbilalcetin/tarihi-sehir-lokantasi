import { z } from "zod";

import { USER_ROLES } from "@/lib/domain/status";
import { entityIdSchema } from "./common";

/**
 * Staff account shapes.
 *
 * No schema here accepts a password, a PIN, a token or a `restaurantId`. The
 * password belongs to Supabase Auth and never crosses this boundary; the tenant
 * comes from the session. Both are enforced by `.strict()`, so sending either
 * is a validation error rather than something quietly ignored.
 */

const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .refine((value) => /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(value), "Geçerli bir e-posta girin.");

export const createStaffBodySchema = z
  .object({
    name: z.string().trim().min(1, "Ad soyad gereklidir.").max(160),
    email: emailSchema,
    role: z.enum(USER_ROLES),
    phone: z.string().trim().max(40).optional(),
    loginIdentifier: z.string().trim().min(3).max(80).optional(),
  })
  .strict();

export const updateStaffBodySchema = z
  .object({
    name: z.string().trim().min(1).max(160).optional(),
    phone: z.string().trim().max(40).nullish(),
    role: z.enum(USER_ROLES).optional(),
    isActive: z.boolean().optional(),
    archived: z.boolean().optional(),
    /** Sensitive: changes the address the account signs in with. */
    email: emailSchema.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, "Güncellenecek alan gönderin.");

export const staffIdParamsSchema = z.object({ staffId: entityIdSchema }).strict();

export const staffListQuerySchema = z
  .object({
    role: z.enum(USER_ROLES).optional(),
    status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
    search: z.string().trim().max(120).optional(),
    page: z.coerce.number().int().min(1).max(10_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();

export type CreateStaffBody = z.infer<typeof createStaffBodySchema>;
export type UpdateStaffBody = z.infer<typeof updateStaffBodySchema>;
export type StaffListQuery = z.infer<typeof staffListQuerySchema>;
