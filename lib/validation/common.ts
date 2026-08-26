import { z } from "zod";

export const entityIdSchema = z
  .string()
  .trim()
  .min(1, "Kimlik boş olamaz.")
  .max(128, "Kimlik en fazla 128 karakter olabilir.")
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/, "Kimlik biçimi geçersiz.");

export const uuidSchema = z.uuid("Geçerli bir UUID girin.");
export const productIdSchema = entityIdSchema;
export const orderIdSchema = entityIdSchema;
export const orderItemIdSchema = entityIdSchema;
export const waiterCallIdSchema = entityIdSchema;

/** QR tokens are opaque base64url values; sequential table ids are rejected. */
export const tableTokenSchema = z
  .string()
  .trim()
  .length(43, "Masa bağlantısı geçersiz.")
  .regex(/^[A-Za-z0-9_-]{43}$/, "Masa bağlantısı geçersiz.");

export const idempotencyKeySchema = z
  .string()
  .trim()
  .min(8, "Idempotency anahtarı en az 8 karakter olmalıdır.")
  .max(128, "Idempotency anahtarı en fazla 128 karakter olabilir.")
  .regex(/^[A-Za-z0-9._:-]+$/, "Idempotency anahtarı geçersiz karakter içeriyor.");

export const quantitySchema = z
  .number()
  .int("Adet tam sayı olmalıdır.")
  .min(1, "Adet en az 1 olmalıdır.")
  .max(99, "Bir kalem için en fazla 99 adet seçilebilir.");

export const noteSchema = z
  .string()
  .trim()
  .max(500, "Not en fazla 500 karakter olabilir.")
  .transform((value) => value || undefined)
  .optional();

/** Decimal strings keep prices exact across JSON and database boundaries. */
export const moneyDecimalSchema = z
  .string()
  .trim()
  .regex(/^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/, "Fiyat en fazla iki ondalık basamak içermelidir.");

export const slugSchema = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug biçimi geçersiz.");

export const sortOrderSchema = z.number().int().min(0).max(1_000_000);
export const isoDateTimeSchema = z.iso.datetime({ offset: true });

export interface ValidationIssue {
  readonly path: string;
  readonly code: string;
  readonly message: string;
}

export function validationIssues(error: z.ZodError): ValidationIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.map(String).join("."),
    code: issue.code,
    message: issue.message,
  }));
}

export type SchemaValidationResult<T> =
  | { readonly success: true; readonly data: T }
  | { readonly success: false; readonly issues: readonly ValidationIssue[] };

export function validateSchema<TOutput>(
  schema: z.ZodType<TOutput>,
  input: unknown,
): SchemaValidationResult<TOutput> {
  const result = schema.safeParse(input);
  return result.success
    ? { success: true, data: result.data }
    : { success: false, issues: validationIssues(result.error) };
}
