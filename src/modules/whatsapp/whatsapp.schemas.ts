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

// Filter-only sentinel: chats that have no tracked-source row yet (never
// classified). Not a real `tracked_sources.status`, so it lives apart from
// `trackedSourceStatusValues`.
export const trackingStatusFilterValues = [
  ...trackedSourceStatusValues,
  "unconfigured",
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

export const createWhatsappAccountSchema = z.object({
  phoneNumber: z.string().trim().min(1).max(40).nullable().optional(),
  displayName: z.string().trim().min(1).max(160).nullable().optional(),
});

export const whatsappAccountParamsSchema = z.object({
  id: z.string().uuid(),
});

export const whatsappChatListQuerySchema = z.object({
  whatsappAccountId: z.string().uuid().optional(),
  sourceType: z.enum(whatsappSourceTypeValues).optional(),
  trackingStatus: z.enum(trackingStatusFilterValues).optional(),
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
  contactId: z.string().uuid().optional(),
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

const optionalNullableTrimmedString = (maxLength: number) =>
  z.string().trim().min(1).max(maxLength).nullable().optional();

export const ingestWhatsappMessageSchema = z.object({
  whatsappAccountId: z.string().uuid(),
  externalMessageId: z.string().trim().min(1).max(240),
  chat: z.object({
    externalChatId: z.string().trim().min(1).max(240),
    displayName: optionalNullableTrimmedString(240),
    sourceType: z.enum(whatsappSourceTypeValues).default("unknown"),
    counterpartyPhoneNumber: optionalNullableTrimmedString(40),
  }),
  sender: z
    .object({
      externalContactId: z.string().trim().min(1).max(240),
      phoneNumber: optionalNullableTrimmedString(40),
      displayName: optionalNullableTrimmedString(180),
    })
    .nullable()
    .optional(),
  messageType: z.enum(whatsappMessageTypeValues).default("unknown"),
  bodyText: optionalNullableTrimmedString(20_000),
  rawPayloadJson: z
    .unknown()
    .refine((value) => value !== undefined, "Raw payload is required."),
  isFromMe: z.boolean().default(false),
  receivedAt: z.date(),
  ingestedAt: z.date().optional(),
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
export type CreateWhatsappAccountInput = z.infer<
  typeof createWhatsappAccountSchema
>;
export type WhatsappChatListQuery = z.infer<typeof whatsappChatListQuerySchema>;
export type UpsertTrackedSourceInput = z.infer<
  typeof upsertTrackedSourceSchema
>;
export type WhatsappMessageListQuery = z.infer<
  typeof whatsappMessageListQuerySchema
>;
export type IngestWhatsappMessageInput = z.input<
  typeof ingestWhatsappMessageSchema
>;
