import { z } from "zod";
import {
  entityIdSchema,
  moneyDecimalSchema,
  noteSchema,
  slugSchema,
  sortOrderSchema,
} from "./common";

const productNameSchema = z.string().trim().min(1).max(160);
const productDescriptionSchema = z.string().trim().max(2_000).nullable().optional();

const productFieldsSchema = z.object({
  categoryId: entityIdSchema,
  name: productNameSchema,
  slug: slugSchema,
  description: productDescriptionSchema,
  /** Never accept a binary float for price. */
  price: moneyDecimalSchema,
  imageUrl: z.url().max(2_048).nullable().optional(),
  isAvailable: z.boolean(),
  isFeatured: z.boolean(),
  isSpicy: z.boolean(),
  isVegetarian: z.boolean(),
  allergens: z.array(z.string().trim().min(1).max(80)).max(50),
  sortOrder: sortOrderSchema,
});

export const createCategoryInputSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    slug: slugSchema,
    description: z.string().trim().max(1_000).nullable().optional(),
    imageUrl: z.url().max(2_048).nullable().optional(),
    sortOrder: sortOrderSchema.default(0),
    isActive: z.boolean().default(true),
  })
  .strict();

export const createProductInputSchema = z
  .object({
    ...productFieldsSchema.shape,
    isAvailable: z.boolean().default(true),
    isFeatured: z.boolean().default(false),
    isSpicy: z.boolean().default(false),
    isVegetarian: z.boolean().default(false),
    allergens: z.array(z.string().trim().min(1).max(80)).max(50).default([]),
    sortOrder: sortOrderSchema.default(0),
  })
  .strict();

export const updateProductInputSchema = productFieldsSchema
  .partial()
  .extend({ productId: entityIdSchema })
  .strict();

export const productAvailabilityInputSchema = z
  .object({
    productId: entityIdSchema,
    isAvailable: z.boolean(),
    reason: noteSchema,
  })
  .strict();

export type CreateCategoryInput = z.infer<typeof createCategoryInputSchema>;
export type CreateProductInput = z.infer<typeof createProductInputSchema>;
export type UpdateProductInput = z.infer<typeof updateProductInputSchema>;
export type ProductAvailabilityInput = z.infer<typeof productAvailabilityInputSchema>;
