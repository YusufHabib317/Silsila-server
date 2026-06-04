import { z } from "zod";

export const commissionTypeValues = [
  "fixed_amount",
  "percentage",
  "manual",
] as const;

export const commissionRecordTypeValues = [
  ...commissionTypeValues,
  "unknown",
] as const;

export const commissionStatusValues = [
  "pending",
  "approved",
  "paid",
  "cancelled",
] as const;

const optionalUuidSchema = z.string().uuid().nullable().optional();
const amountMinorSchema = z.number().int().min(0).max(2_147_483_647);
const percentageSchema = z
  .number()
  .min(0)
  .max(999.99)
  .refine((percentage) => Number.isInteger(percentage * 100), {
    message: "Percentage can have at most two decimal places.",
  });
const currencySchema = z
  .string()
  .trim()
  .length(3)
  .regex(/^[A-Za-z]{3}$/)
  .transform((currency) => currency.toUpperCase());
const paidAtSchema = z.string().datetime().transform((value) => new Date(value));

export const commissionParamsSchema = z.object({
  id: z.string().uuid(),
});

export const commissionListQuerySchema = z.object({
  orderId: z.string().uuid().optional(),
  productId: z.string().uuid().optional(),
  contactId: z.string().uuid().optional(),
  commissionType: z.enum(commissionRecordTypeValues).optional(),
  status: z.enum(commissionStatusValues).optional(),
  currency: currencySchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().trim().min(1).optional(),
});

export const createCommissionSchema = z.object({
  orderId: optionalUuidSchema,
  productId: optionalUuidSchema,
  contactId: z.string().uuid(),
  commissionType: z.enum(commissionTypeValues).default("manual"),
  amountMinor: amountMinorSchema.nullable().optional(),
  percentage: percentageSchema.nullable().optional(),
  currency: currencySchema.default("SYP"),
  status: z.enum(commissionStatusValues).default("pending"),
  paidAt: paidAtSchema.nullable().optional(),
});

export const updateCommissionSchema = z
  .object({
    orderId: optionalUuidSchema,
    productId: optionalUuidSchema,
    contactId: z.string().uuid().optional(),
    commissionType: z.enum(commissionTypeValues).optional(),
    amountMinor: amountMinorSchema.nullable().optional(),
    percentage: percentageSchema.nullable().optional(),
    currency: currencySchema.optional(),
    status: z.enum(commissionStatusValues).optional(),
    paidAt: paidAtSchema.nullable().optional(),
  })
  .refine(
    (input) =>
      input.orderId !== undefined ||
      input.productId !== undefined ||
      input.contactId !== undefined ||
      input.commissionType !== undefined ||
      input.amountMinor !== undefined ||
      input.percentage !== undefined ||
      input.currency !== undefined ||
      input.status !== undefined ||
      input.paidAt !== undefined,
    {
      message: "At least one commission field must be provided.",
    },
  );

export type CommissionTypeInput = (typeof commissionTypeValues)[number];
export type CommissionRecordTypeInput =
  (typeof commissionRecordTypeValues)[number];
export type CommissionStatusInput = (typeof commissionStatusValues)[number];
export type CommissionListQuery = z.infer<typeof commissionListQuerySchema>;
export type CreateCommissionInput = z.infer<typeof createCommissionSchema>;
export type UpdateCommissionInput = z.infer<typeof updateCommissionSchema>;
