import { z } from "zod";

export const whatsappAccountStatusValues = [
  "pending_qr",
  "qr_ready",
  "connecting",
  "connected",
  "disconnected",
  "reconnecting",
  "expired",
  "failed",
  "disabled",
] as const;

export const whatsappSourceTypeValues = [
  "merchant_group",
  "agent_group",
  "customer_chat",
  "supplier_chat",
  "internal_team",
  "unknown",
] as const;

export const trackedSourceStatusValues = [
  "tracked",
  "ignored",
  "personal",
] as const;

export const whatsappMessageTypeValues = [
  "text",
  "image",
  "video",
  "audio",
  "voice",
  "document",
  "sticker",
  "location",
  "contact",
  "unknown",
] as const;

const queryBooleanSchema = z
  .enum(["true", "false"])
  .transform((value) => value === "true");

export const whatsappAccountListQuerySchema = z.object({
  status: z.enum(whatsappAccountStatusValues).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().trim().min(1).optional(),
});

export const whatsappChatListQuerySchema = z.object({
  whatsappAccountId: z.string().uuid().optional(),
  sourceType: z.enum(whatsappSourceTypeValues).optional(),
  trackingStatus: z.enum(trackedSourceStatusValues).optional(),
  search: z.string().trim().min(1).max(120).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().trim().min(1).optional(),
});

export const trackedSourceParamsSchema = z.object({
  chatId: z.string().uuid(),
});

export const upsertTrackedSourceSchema = z.object({
  status: z.enum(trackedSourceStatusValues),
  sourceType: z.enum(whatsappSourceTypeValues).default("unknown"),
});

export const whatsappMessageParamsSchema = z.object({
  id: z.string().uuid(),
});

export const whatsappMessageListQuerySchema = z.object({
  whatsappAccountId: z.string().uuid().optional(),
  chatId: z.string().uuid().optional(),
  senderContactId: z.string().uuid().optional(),
  messageType: z.enum(whatsappMessageTypeValues).optional(),
  isTracked: queryBooleanSchema.optional(),
  isLinked: queryBooleanSchema.optional(),
  isArchived: queryBooleanSchema.optional(),
  isPersonal: queryBooleanSchema.optional(),
  search: z.string().trim().min(1).max(120).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().trim().min(1).optional(),
});

export type WhatsappAccountStatusInput =
  (typeof whatsappAccountStatusValues)[number];
export type WhatsappSourceTypeInput = (typeof whatsappSourceTypeValues)[number];
export type TrackedSourceStatusInput =
  (typeof trackedSourceStatusValues)[number];
export type WhatsappMessageTypeInput = (typeof whatsappMessageTypeValues)[number];
export type WhatsappAccountListQuery = z.infer<
  typeof whatsappAccountListQuerySchema
>;
export type WhatsappChatListQuery = z.infer<typeof whatsappChatListQuerySchema>;
export type UpsertTrackedSourceInput = z.infer<
  typeof upsertTrackedSourceSchema
>;
export type WhatsappMessageListQuery = z.infer<
  typeof whatsappMessageListQuerySchema
>;
