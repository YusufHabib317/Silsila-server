import { z } from "zod";

export const productOwnerTypeValues = [
  "own_stock",
  "merchant_product",
  "factory_product",
  "agent_product",
  "unknown",
] as const;

export const productStatusValues = [
  "draft",
  "active",
  "out_of_stock",
  "price_changed",
  "paused",
  "archived",
  "deleted",
] as const;

export const stockStatusValues = [
  "in_stock",
  "low_stock",
  "out_of_stock",
  "unknown",
] as const;

const optionalTextSchema = z.string().trim().min(1).max(5000);
const optionalUuidSchema = z.string().uuid().nullable().optional();
const amountMinorSchema = z.number().int().min(0).max(2_147_483_647);
const currencySchema = z
  .string()
  .trim()
  .length(3)
  .regex(/^[A-Za-z]{3}$/)
  .transform((currency) => currency.toUpperCase());

export const productParamsSchema = z.object({
  id: z.string().uuid(),
});

export const productListQuerySchema = z.object({
  productStatus: z.enum(productStatusValues).optional(),
  stockStatus: z.enum(stockStatusValues).optional(),
  ownerType: z.enum(productOwnerTypeValues).optional(),
  ownerContactId: z.string().uuid().optional(),
  merchantContactId: z.string().uuid().optional(),
  sourceBundleId: z.string().uuid().optional(),
  categoryId: z.string().uuid().optional(),
  currency: currencySchema.optional(),
  search: z.string().trim().min(1).max(120).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().trim().min(1).optional(),
});

export const createProductSchema = z.object({
  name: z.string().trim().min(1).max(220),
  description: optionalTextSchema.nullable().optional(),
  categoryId: optionalUuidSchema,
  ownerType: z.enum(productOwnerTypeValues).default("unknown"),
  ownerContactId: optionalUuidSchema,
  merchantContactId: optionalUuidSchema,
  sourceBundleId: optionalUuidSchema,
  costAmountMinor: amountMinorSchema.nullable().optional(),
  saleAmountMinor: amountMinorSchema.nullable().optional(),
  agentAmountMinor: amountMinorSchema.nullable().optional(),
  currency: currencySchema.default("SYP"),
  stockStatus: z.enum(stockStatusValues).default("unknown"),
  productStatus: z.enum(productStatusValues).default("draft"),
  notes: optionalTextSchema.nullable().optional(),
});

export const updateProductSchema = z
  .object({
    name: z.string().trim().min(1).max(220).optional(),
    description: optionalTextSchema.nullable().optional(),
    categoryId: optionalUuidSchema,
    ownerType: z.enum(productOwnerTypeValues).optional(),
    ownerContactId: optionalUuidSchema,
    merchantContactId: optionalUuidSchema,
    sourceBundleId: optionalUuidSchema,
    costAmountMinor: amountMinorSchema.nullable().optional(),
    saleAmountMinor: amountMinorSchema.nullable().optional(),
    agentAmountMinor: amountMinorSchema.nullable().optional(),
    currency: currencySchema.optional(),
    stockStatus: z.enum(stockStatusValues).optional(),
    productStatus: z.enum(productStatusValues).optional(),
    notes: optionalTextSchema.nullable().optional(),
  })
  .refine(
    (input) =>
      input.name !== undefined ||
      input.description !== undefined ||
      input.categoryId !== undefined ||
      input.ownerType !== undefined ||
      input.ownerContactId !== undefined ||
      input.merchantContactId !== undefined ||
      input.sourceBundleId !== undefined ||
      input.costAmountMinor !== undefined ||
      input.saleAmountMinor !== undefined ||
      input.agentAmountMinor !== undefined ||
      input.currency !== undefined ||
      input.stockStatus !== undefined ||
      input.productStatus !== undefined ||
      input.notes !== undefined,
    {
      message: "At least one product field must be provided.",
    },
  );

export type ProductOwnerTypeInput = (typeof productOwnerTypeValues)[number];
export type ProductStatusInput = (typeof productStatusValues)[number];
export type StockStatusInput = (typeof stockStatusValues)[number];
export type ProductListQuery = z.infer<typeof productListQuerySchema>;
export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
