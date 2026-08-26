import { z } from "zod";

import { SUPPORTED_ENCODINGS } from "@/lib/domain/escpos";
import {
  PRINT_DOCUMENT_TYPES,
  PRINTER_STATION_TYPES,
} from "@/lib/domain/print-document";
import { PRINT_ERROR_CODES } from "@/lib/domain/print-routing";
import { entityIdSchema } from "./common";

/**
 * Print request shapes.
 *
 * No schema here accepts a payload, a byte string or a printer command. A
 * caller names a document and its source; the server reads the source and
 * composes the snapshot itself. That is the boundary that makes printer
 * command injection impossible from the API side.
 */

export const createAgentBodySchema = z
  .object({ name: z.string().trim().min(1, "Agent adı gereklidir.").max(80) })
  .strict();

export const updateAgentBodySchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    isActive: z.boolean().optional(),
    action: z.enum(["ROTATE_TOKEN", "REVOKE"]).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "Güncellenecek bir alan gönderin.",
  });

export const createPrinterBodySchema = z
  .object({
    agentId: entityIdSchema,
    name: z.string().trim().min(1).max(80),
    code: z
      .string()
      .trim()
      .min(1)
      .max(40)
      .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, "Yazıcı kodu biçimi geçersiz."),
    stationType: z.enum(PRINTER_STATION_TYPES).default("GENERAL"),
    /** Resolved to a LAN address by the agent's own config, never by us. */
    deviceKey: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, "Cihaz anahtarı biçimi geçersiz."),
    charactersPerLine: z.coerce.number().int().min(24).max(96).default(48),
    encoding: z.enum(SUPPORTED_ENCODINGS).default("CP857"),
    autoCut: z.boolean().default(true),
    defaultCopies: z.coerce.number().int().min(1).max(5).default(1),
  })
  .strict();

export const updatePrinterBodySchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    deviceKey: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/)
      .optional(),
    charactersPerLine: z.coerce.number().int().min(24).max(96).optional(),
    encoding: z.enum(SUPPORTED_ENCODINGS).optional(),
    autoCut: z.boolean().optional(),
    defaultCopies: z.coerce.number().int().min(1).max(5).optional(),
    isActive: z.boolean().optional(),
    archived: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "Güncellenecek bir alan gönderin.",
  });

export const createRouteBodySchema = z
  .object({
    documentType: z.enum(PRINT_DOCUMENT_TYPES),
    categoryId: entityIdSchema.nullable().optional(),
    printerId: entityIdSchema,
    // Bounded on purpose: nobody meant to ask for 999 copies.
    copies: z.coerce.number().int().min(1).max(5).default(1),
  })
  .strict();

export const updateRouteBodySchema = z
  .object({
    isActive: z.boolean().optional(),
    copies: z.coerce.number().int().min(1).max(5).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "Güncellenecek bir alan gönderin.",
  });

/**
 * What a staff member may ask to be printed. The body names a document and a
 * source id — never its contents.
 */
export const printRequestBodySchema = z
  .discriminatedUnion("documentType", [
    z.object({ documentType: z.literal("CUSTOMER_BILL"), orderId: entityIdSchema }).strict(),
    z.object({ documentType: z.literal("PAYMENT_RECEIPT"), paymentId: entityIdSchema }).strict(),
    z.object({ documentType: z.literal("X_REPORT"), shiftId: entityIdSchema }).strict(),
    z.object({ documentType: z.literal("Z_REPORT"), shiftId: entityIdSchema }).strict(),
    z.object({ documentType: z.literal("TEST_PRINT"), printerId: entityIdSchema }).strict(),
  ]);

export const printJobQuerySchema = z
  .object({
    status: z
      .enum(["PENDING", "PROCESSING", "PRINTED", "FAILED", "CANCELLED"])
      .optional(),
    printerId: entityIdSchema.optional(),
    documentType: z.enum(PRINT_DOCUMENT_TYPES).optional(),
    dateFrom: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    dateTo: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    page: z.coerce.number().int().min(1).max(10_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

export const printJobActionBodySchema = z
  .discriminatedUnion("action", [
    z.object({ action: z.literal("RETRY") }).strict(),
    z
      .object({
        action: z.literal("REPRINT"),
        // A reprint always says why: an unexplained duplicate ticket at the
        // pass is indistinguishable from a bug.
        reason: z.string().trim().min(1, "Gerekçe zorunludur.").max(300),
      })
      .strict(),
  ]);

// ------------------------------------------------------------- agent surface

export const agentHeartbeatBodySchema = z
  .object({ softwareVersion: z.string().trim().max(40).optional() })
  .strict();

export const agentClaimBodySchema = z
  .object({ limit: z.coerce.number().int().min(1).max(20).default(5) })
  .strict();

export const agentCompleteBodySchema = z
  .object({
    jobId: entityIdSchema,
    bytesWritten: z.coerce.number().int().min(0).max(10_000_000).optional(),
  })
  .strict();

export const agentFailBodySchema = z
  .object({
    jobId: entityIdSchema,
    errorCode: z.enum(PRINT_ERROR_CODES),
    /** A short, already-sanitised summary; never a stack trace. */
    errorSummary: z.string().trim().max(300).default(""),
  })
  .strict();

export type PrintRequestBody = z.infer<typeof printRequestBodySchema>;
export type PrintJobQuery = z.infer<typeof printJobQuerySchema>;
