import { z } from "zod";

export const orderStatusValues = [
  "new",
  "needs_review",
  "confirmed",
  "preparing",
  "shipped",
  "delivered",
  "paid",
  "cancelled",
  "returned",
  "failed",
] as const;

export const paymentStatusValues = [
  "unpaid",
  "partial",
  "paid",
  "refunded",
  "unknown",
] as const;

export const deliveryStatusValues = [
  "not_started",
  "preparing",
  "with_delivery",
  "delivered",
  "returned",
  "failed",
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

const orderItemInputSchema = z.object({
  productId: optionalUuidSchema,
  title: z.string().trim().min(1).max(220),
  quantity: z.number().int().min(1).max(100_000).default(1),
  unitAmountMinor: amountMinorSchema.nullable().optional(),
  currency: currencySchema.optional(),
});

export const orderParamsSchema = z.object({
  id: z.string().uuid(),
});

export const orderListQuerySchema = z.object({
  status: z.enum(orderStatusValues).optional(),
  paymentStatus: z.enum(paymentStatusValues).optional(),
  deliveryStatus: z.enum(deliveryStatusValues).optional(),
  customerContactId: z.string().uuid().optional(),
  merchantContactId: z.string().uuid().optional(),
  agentContactId: z.string().uuid().optional(),
  sourceBundleId: z.string().uuid().optional(),
  productId: z.string().uuid().optional(),
  currency: currencySchema.optional(),
  search: z.string().trim().min(1).max(120).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().trim().min(1).optional(),
});

export const createOrderSchema = z.object({
  orderNumber: z.string().trim().min(1).max(80),
  customerContactId: optionalUuidSchema,
  merchantContactId: optionalUuidSchema,
  agentContactId: optionalUuidSchema,
  sourceBundleId: optionalUuidSchema,
  status: z.enum(orderStatusValues).default("new"),
  paymentStatus: z.enum(paymentStatusValues).default("unknown"),
  deliveryStatus: z.enum(deliveryStatusValues).default("unknown"),
  currency: currencySchema.default("SYP"),
  notes: optionalTextSchema.nullable().optional(),
  items: z.array(orderItemInputSchema).min(1).max(200),
});

export const updateOrderSchema = z
  .object({
    orderNumber: z.string().trim().min(1).max(80).optional(),
    customerContactId: optionalUuidSchema,
    merchantContactId: optionalUuidSchema,
    agentContactId: optionalUuidSchema,
    sourceBundleId: optionalUuidSchema,
    status: z.enum(orderStatusValues).optional(),
    paymentStatus: z.enum(paymentStatusValues).optional(),
    deliveryStatus: z.enum(deliveryStatusValues).optional(),
    currency: currencySchema.optional(),
    notes: optionalTextSchema.nullable().optional(),
    items: z.array(orderItemInputSchema).min(1).max(200).optional(),
  })
  .refine(
    (input) =>
      input.orderNumber !== undefined ||
      input.customerContactId !== undefined ||
      input.merchantContactId !== undefined ||
      input.agentContactId !== undefined ||
      input.sourceBundleId !== undefined ||
      input.status !== undefined ||
      input.paymentStatus !== undefined ||
      input.deliveryStatus !== undefined ||
      input.currency !== undefined ||
      input.notes !== undefined ||
      input.items !== undefined,
    {
      message: "At least one order field must be provided.",
    },
  );

export type OrderStatusInput = (typeof orderStatusValues)[number];
export type PaymentStatusInput = (typeof paymentStatusValues)[number];
export type DeliveryStatusInput = (typeof deliveryStatusValues)[number];
export type OrderItemInput = z.infer<typeof orderItemInputSchema>;
export type OrderListQuery = z.infer<typeof orderListQuerySchema>;
export type CreateOrderInput = z.infer<typeof createOrderSchema>;
export type UpdateOrderInput = z.infer<typeof updateOrderSchema>;
