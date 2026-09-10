import { z } from "zod";

import { entityIdSchema } from "./common";
import { supportedMenuLocale } from "@/lib/i18n/catalog-localization";

const categoryNameSchema = z.string().trim().min(1).max(120);
const productNameSchema = z.string().trim().min(1).max(180);
const descriptionSchema = z.string().trim().max(2000).nullish();
const labelListSchema = z.array(z.string().trim().min(1).max(80)).max(20);
const localeSchema = z.string().trim().refine(
  (locale) => supportedMenuLocale(locale) !== null,
  "Desteklenmeyen katalog dili.",
);
const categoryTranslationSchema = z.object({
  locale: localeSchema,
  name: categoryNameSchema,
  description: descriptionSchema,
}).strict();
const productTranslationSchema = z.object({
  locale: localeSchema,
  name: productNameSchema,
  description: descriptionSchema,
}).strict();
const categoryTranslationsSchema = z.array(categoryTranslationSchema).max(109).optional();
const productTranslationsSchema = z.array(productTranslationSchema).max(109).optional();

/** Server-formatted decimal string; the client never sends minor units. */
const priceSchema = z
  .string()
  .trim()
  .regex(/^\d{1,8}(\.\d{1,2})?$/, "Fiyat en fazla iki ondalık basamak içerebilir.")
  .refine((value) => Number(value) > 0, "Fiyat sıfırdan büyük olmalıdır.");

export const createCategoryBodySchema = z
  .object({
    name: categoryNameSchema,
    description: descriptionSchema,
    /** Categories carry a cover image, exactly as products do. */
    imageUrl: z.string().trim().max(2000).nullish(),
    sortOrder: z.number().int().min(0).max(10_000).optional(),
    isActive: z.boolean().optional(),
    translations: categoryTranslationsSchema,
  })
  .strict();

export const updateCategoryBodySchema = z
  .object({
    name: categoryNameSchema.optional(),
    description: descriptionSchema,
    imageUrl: z.string().trim().max(2000).nullish(),
    sortOrder: z.number().int().min(0).max(10_000).optional(),
    isActive: z.boolean().optional(),
    archived: z.boolean().optional(),
    translations: categoryTranslationsSchema,
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, "Güncellenecek alan gönderin.");

export const createProductBodySchema = z
  .object({
    categoryId: entityIdSchema,
    name: productNameSchema,
    description: descriptionSchema,
    price: priceSchema,
    imageUrl: z.string().trim().max(2000).nullish(),
    weightLabel: z.string().trim().max(60).nullish(),
    isActive: z.boolean().optional(),
    isAvailable: z.boolean().optional(),
    isFeatured: z.boolean().optional(),
    isSpicy: z.boolean().optional(),
    isVegetarian: z.boolean().optional(),
    allergens: labelListSchema.optional(),
    tags: labelListSchema.optional(),
    sortOrder: z.number().int().min(0).max(10_000).optional(),
    translations: productTranslationsSchema,
  })
  .strict();

export const updateProductBodySchema = z
  .object({
    categoryId: entityIdSchema.optional(),
    name: productNameSchema.optional(),
    description: descriptionSchema,
    price: priceSchema.optional(),
    imageUrl: z.string().trim().max(2000).nullish(),
    weightLabel: z.string().trim().max(60).nullish(),
    isActive: z.boolean().optional(),
    isAvailable: z.boolean().optional(),
    isFeatured: z.boolean().optional(),
    isSpicy: z.boolean().optional(),
    isVegetarian: z.boolean().optional(),
    allergens: labelListSchema.optional(),
    tags: labelListSchema.optional(),
    sortOrder: z.number().int().min(0).max(10_000).optional(),
    archived: z.boolean().optional(),
    translations: productTranslationsSchema,
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, "Güncellenecek alan gönderin.");

/**
 * A request to fill in the other languages for one already-saved row.
 *
 * `targetLocales` is an allow-list checked here and again in the service: an
 * unknown code is a rejected request, never a quietly dropped language.
 * `overwrite` stays off by default so a bulk run cannot erase a translation an
 * administrator typed by hand.
 */
export const autoTranslateBodySchema = z
  .object({
    entityType: z.enum(["CATEGORY", "PRODUCT"]),
    entityId: entityIdSchema,
    sourceLocale: localeSchema.optional(),
    targetLocales: z.array(localeSchema).min(1).max(109).optional(),
    overwrite: z.boolean().optional(),
  })
  .strict();

export const categoryIdParamsSchema = z.object({ categoryId: entityIdSchema }).strict();
export const productIdParamsSchema = z.object({ productId: entityIdSchema }).strict();

/** A new running order for the menu: ids paired with their new place. */
const menuOrderEntrySchema = z
  .object({ id: entityIdSchema, sortOrder: z.number().int().min(0).max(10_000) })
  .strict();

export const reorderMenuBodySchema = z
  .object({
    categories: z.array(menuOrderEntrySchema).max(500).optional(),
    products: z.array(menuOrderEntrySchema).max(500).optional(),
  })
  .strict()
  .refine(
    (value) => (value.categories?.length ?? 0) + (value.products?.length ?? 0) > 0,
    "Sıralanacak öğe gönderin.",
  );
