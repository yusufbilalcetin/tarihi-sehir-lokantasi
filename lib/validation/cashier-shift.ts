import { z } from "zod";

import {
  CASH_MOVEMENT_REASON_MAX_LENGTH,
  CASH_MOVEMENT_TYPES,
  CASHIER_SHIFT_STATUSES,
  SHIFT_NOTE_MAX_LENGTH,
} from "@/lib/domain/cashier-shift";
import {
  CASH_COUNT_CURRENCIES,
  MAX_DENOMINATION_COUNT,
} from "@/lib/domain/cash-denominations";
import { entityIdSchema, moneyDecimalSchema } from "./common";

/**
 * `cashierShiftId` is deliberately absent from every body below. The shift a
 * payment, refund or movement belongs to is resolved server-side from the
 * authenticated principal, so a client cannot attribute money to a drawer that
 * is not its own.
 */


/**
 * One counted denomination as it arrives from the browser.
 *
 * Only the currency, the face value and how many pieces were counted are
 * accepted. A subtotal is deliberately *not* part of the shape: the server
 * recomputes every amount from its own denomination table, so a client has
 * nothing to claim. `.strict()` makes an extra field a rejection rather than
 * something quietly ignored.
 */
export const cashCountEntrySchema = z
  .object({
    currency: z.enum(CASH_COUNT_CURRENCIES),
    denominationMinor: z
      .number()
      .int("Kupür değeri tam sayı olmalıdır.")
      .positive("Kupür değeri pozitif olmalıdır."),
    count: z
      .number()
      .int("Adet tam sayı olmalıdır.")
      .min(0, "Adet negatif olamaz.")
      .max(MAX_DENOMINATION_COUNT, "Adet çok yüksek."),
  })
  .strict();

/** The whole drawer. The domain rejects unknown or duplicated denominations. */
export const cashCountSchema = z
  .array(cashCountEntrySchema)
  .max(
    CASH_COUNT_CURRENCIES.length * 40,
    "Kupür listesi beklenenden uzun.",
  );

export const openShiftBodySchema = z
  .object({
    cashRegisterId: entityIdSchema,
    /** `0.00` is a legitimate opening float; a negative one is not expressible. */
    openingCash: moneyDecimalSchema,
    /**
     * Optional: a drawer counted denomination by denomination. When present the
     * server recomputes the TRY subtotal from it and that becomes the opening
     * cash, so the typed figure and the counted drawer cannot disagree. When
     * absent the shift opens exactly as it always has.
     */
    cashCounts: cashCountSchema.optional(),
  })
  .strict();

export const closeShiftBodySchema = z
  .object({
    countedCash: moneyDecimalSchema,
    note: z
      .string()
      .trim()
      .max(SHIFT_NOTE_MAX_LENGTH, "Açıklama çok uzun.")
      .optional(),
  })
  .strict();

export const cashMovementBodySchema = z
  .object({
    type: z.enum(CASH_MOVEMENT_TYPES),
    amount: moneyDecimalSchema,
    // Required by design: an unexplained drawer movement is not auditable.
    reason: z
      .string()
      .trim()
      .min(1, "Gerekçe zorunludur.")
      .max(CASH_MOVEMENT_REASON_MAX_LENGTH, "Gerekçe çok uzun."),
    note: z.string().trim().max(SHIFT_NOTE_MAX_LENGTH).optional(),
  })
  .strict();

export const shiftHistoryQuerySchema = z
  .object({
    status: z.enum(CASHIER_SHIFT_STATUSES).optional(),
    cashRegisterId: entityIdSchema.optional(),
    /** Ignored for cashiers; the service pins them to their own shifts. */
    openedByStaffId: entityIdSchema.optional(),
    dateFrom: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    dateTo: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    page: z.coerce.number().int().min(1).max(10_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

export const createCashRegisterBodySchema = z
  .object({
    name: z.string().trim().min(1, "Kasa adı gereklidir.").max(80),
    code: z
      .string()
      .trim()
      .min(1)
      .max(40)
      .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, "Kasa kodu biçimi geçersiz."),
  })
  .strict();

export const updateCashRegisterBodySchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    isActive: z.boolean().optional(),
    archived: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "Güncellenecek bir alan gönderin.",
  });

export type OpenShiftBody = z.infer<typeof openShiftBodySchema>;
export type CashCountEntry = z.infer<typeof cashCountEntrySchema>;
export type CloseShiftBody = z.infer<typeof closeShiftBodySchema>;
export type CashMovementBody = z.infer<typeof cashMovementBodySchema>;
export type ShiftHistoryQuery = z.infer<typeof shiftHistoryQuerySchema>;
