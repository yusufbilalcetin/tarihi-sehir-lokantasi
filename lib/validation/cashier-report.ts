import { z } from "zod";

import {
  UnsupportedSnapshotVersionError,
  Z_SNAPSHOT_VERSION,
  type ZReportSnapshot,
} from "@/lib/domain/cashier-report";
import { PAYMENT_METHODS } from "@/lib/domain/status";
import { entityIdSchema } from "./common";

/**
 * A stored Z snapshot is parsed, never trusted.
 *
 * It is written by this application, but it lives in a `jsonb` column that will
 * outlive several versions of this code. A corrupt or unreadable snapshot must
 * surface as an explicit error rather than render as a report with silently
 * missing figures.
 */

/** Exact decimal money, optionally negative — a variance can be either way. */
const signedMoney = z
  .string()
  .regex(/^-?(?:0|[1-9]\d{0,12})(?:\.\d{1,2})?$/, "Tutar biçimi geçersiz.");
const money = z
  .string()
  .regex(/^(?:0|[1-9]\d{0,12})(?:\.\d{1,2})?$/, "Tutar biçimi geçersiz.");

const breakdownRow = z
  .object({
    method: z.enum(PAYMENT_METHODS),
    amount: money,
    count: z.number().int().min(0),
  })
  .strict();

export const zSnapshotSchema = z
  .object({
    reportType: z.literal("Z"),
    version: z.number().int().min(1),
    restaurantId: entityIdSchema,
    restaurantNameSnapshot: z.string(),
    registerId: entityIdSchema,
    registerNameSnapshot: z.string(),
    shiftId: entityIdSchema,
    openedByStaffId: entityIdSchema,
    openedByNameSnapshot: z.string().nullable(),
    openedAt: z.string(),
    closedByStaffId: entityIdSchema,
    closedByNameSnapshot: z.string().nullable(),
    closedAt: z.string(),
    generatedAt: z.string(),
    openingCash: money,
    paymentMethodBreakdown: z.array(breakdownRow),
    grossCollected: money,
    paymentCount: z.number().int().min(0),
    refundMethodBreakdown: z.array(breakdownRow),
    totalRefunds: money,
    refundCount: z.number().int().min(0),
    netCollected: signedMoney,
    cashIn: money,
    cashOut: money,
    movementCount: z.number().int().min(0),
    expectedCash: signedMoney,
    countedCash: money,
    cashVariance: signedMoney,
    managerOverride: z.boolean(),
    closeNote: z.string().nullable(),
    nonFiscalNotice: z.string(),
  })
  .strict();

export class CorruptSnapshotError extends Error {
  constructor(readonly issues: readonly string[]) {
    super(`Z report snapshot failed validation: ${issues.join("; ")}`);
    this.name = "CorruptSnapshotError";
  }
}

/**
 * A snapshot written by a *newer* version of the application is refused
 * outright rather than parsed against today's field list, which would quietly
 * drop or misread values.
 */
export function parseZSnapshot(value: unknown): ZReportSnapshot {
  const version = (value as { version?: unknown } | null)?.version;
  if (version !== Z_SNAPSHOT_VERSION) {
    throw new UnsupportedSnapshotVersionError(version);
  }
  const parsed = zSnapshotSchema.safeParse(value);
  if (!parsed.success) {
    throw new CorruptSnapshotError(
      parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
    );
  }
  return parsed.data as ZReportSnapshot;
}

export const dailyCashReportQuerySchema = z
  .object({
    /** A restaurant-local calendar date. */
    date: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Tarih YYYY-AA-GG olmalıdır."),
    registerId: entityIdSchema.optional(),
    cashierId: entityIdSchema.optional(),
    format: z.enum(["json", "csv"]).default("json"),
  })
  .strict();

export const shiftReportQuerySchema = z
  .object({ format: z.enum(["json", "csv"]).default("json") })
  .strict();

export type DailyCashReportQuery = z.infer<typeof dailyCashReportQuerySchema>;
