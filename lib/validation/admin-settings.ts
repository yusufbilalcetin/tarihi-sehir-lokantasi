import { z } from "zod";

import { CURRENCY_CODES } from "../domain/money";

/**
 * A rate the restaurant charges, as a percentage: `10.00` is ten per cent, not
 * a tenth. The column is `numeric(5,2)` checked `between 0 and 100`, and these
 * bounds say the same thing so an out-of-range value is refused as a bad
 * request rather than as a constraint violation.
 */
const percentageSchema = z
  .string()
  .trim()
  .regex(/^\d{1,3}(\.\d{1,2})?$/, "Oran en fazla iki ondalık basamak içerebilir.")
  .refine((value) => Number(value) >= 0 && Number(value) <= 100, "Oran 0 ile 100 arasında olmalıdır.");

/** Trimmed, and an empty box means "cleared", not an empty string in the column. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value.length === 0 ? null : value))
    .nullable();

/**
 * An IANA zone name. Not an offset: the day-end and the reports it drives have
 * to survive a clock change, which a fixed `+03:00` cannot.
 */
const timezoneSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, "Saat dilimi tanınmadı.");

const localeSchema = z
  .string()
  .trim()
  .min(2)
  .max(16)
  .regex(/^[a-z]{2}(-[A-Za-z0-9]{2,8})*$/, "Dil kodu geçersiz.");

export const updateSettingsBodySchema = z
  .object({
    // -------------------------------------------------- the restaurant itself
    name: z.string().trim().min(1, "İşletme adı gereklidir.").max(160).optional(),
    phone: optionalText(40).optional(),
    address: optionalText(500).optional(),
    currency: z.enum(CURRENCY_CODES).optional(),
    timezone: timezoneSchema.optional(),
    defaultLocale: localeSchema.optional(),

    // ------------------------------------------------------- menu and orders
    menuEnabled: z.boolean().optional(),
    orderingEnabled: z.boolean().optional(),
    introEnabled: z.boolean().optional(),
    waiterApprovalRequired: z.boolean().optional(),
    customerNotesEnabled: z.boolean().optional(),
    menuImagesEnabled: z.boolean().optional(),
    maxItemQuantity: z.number().int().min(1).max(99).optional(),
    orderNotesMaxLength: z.number().int().min(0).max(1000).optional(),

    // ------------------------------------------------------- guest requests
    waiterCallEnabled: z.boolean().optional(),
    billRequestEnabled: z.boolean().optional(),
    /**
     * Matches `restaurant_settings_call_cooldown_check` exactly. It used to
     * start at 0, so 0-4 passed here and then violated the constraint — the
     * operator got a server error instead of being told the value was too low.
     */
    waiterCallCooldownSeconds: z.number().int().min(5).max(3600).optional(),

    // -------------------------------------------------------- tax and service
    serviceFeeRate: percentageSchema.optional(),
    taxRate: percentageSchema.optional(),

    /**
     * The version the screen was showing. The settings row is already written
     * under a version guard; sending back the one that was loaded turns a
     * second administrator's save into a refusal instead of a silent overwrite.
     */
    expectedVersion: z.number().int().min(1).optional(),
  })
  .strict()
  .refine(
    (value) => Object.keys(value).filter((key) => key !== "expectedVersion").length > 0,
    "Güncellenecek alan gönderin.",
  );

export type UpdateSettingsBody = z.infer<typeof updateSettingsBodySchema>;
