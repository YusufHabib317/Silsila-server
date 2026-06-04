import { z } from "zod";

import { AppError } from "../../lib/app-error.ts";
import {
  ingestWhatsappMessage,
  type IngestedWhatsappMessageResult,
} from "./whatsapp.ingestion.ts";
import type {
  IngestWhatsappMessageInput,
  WhatsappMessageTypeInput,
  WhatsappSourceTypeInput,
} from "./whatsapp.schemas.ts";

type JsonSafeValue =
  | null
  | string
  | number
  | boolean
  | JsonSafeValue[]
  | { [key: string]: JsonSafeValue };

type BaileysHandlerInput = {
  tenantId: string;
  whatsappAccountId: string;
  message: unknown;
  chatDisplayName?: string | null;
  senderDisplayName?: string | null;
  senderPhoneNumber?: string | null;
  chatSourceType?: WhatsappSourceTypeInput;
  ingestedAt?: Date;
};

type BaileysHandlerDependencies = {
  ingestMessage?: (
    tenantId: string,
    input: IngestWhatsappMessageInput,
  ) => Promise<IngestedWhatsappMessageResult>;
};

const baileysWebMessageSchema = z
  .object({
    key: z
      .object({
        id: z.string().trim().min(1).optional(),
        remoteJid: z.string().trim().min(1).optional(),
        fromMe: z.boolean().optional(),
        participant: z.string().trim().min(1).optional(),
      })
      .optional(),
    message: z.record(z.string(), z.unknown()).nullable().optional(),
    messageTimestamp: z.unknown().optional(),
    pushName: z.string().trim().min(1).optional(),
  })
  .passthrough();

function toJsonSafeValue(
  value: unknown,
  seen = new WeakSet<object>(),
): JsonSafeValue {
  if (value === null) {
    return null;
  }

  if (typeof value === "string" || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value instanceof Uint8Array) {
    return {
      type: "binary",
      byteLength: value.byteLength,
    };
  }

  if (Array.isArray(value)) {
    return value.map((entry) => toJsonSafeValue(entry, seen));
  }

  if (typeof value === "object") {
    if (seen.has(value)) {
      return "[Circular]";
    }

    seen.add(value);
    const record: Record<string, JsonSafeValue> = {};

    for (const [key, nestedValue] of Object.entries(
      value as Record<string, unknown>,
    )) {
      if (
        nestedValue === undefined ||
        typeof nestedValue === "function" ||
        typeof nestedValue === "symbol"
      ) {
        continue;
      }

      record[key] = toJsonSafeValue(nestedValue, seen);
    }

    return record;
  }

  return String(value);
}

function unwrapMessageContainer(
  message: Record<string, unknown>,
): Record<string, unknown> {
  const wrapperKeys = [
    "ephemeralMessage",
    "viewOnceMessage",
    "viewOnceMessageV2",
    "documentWithCaptionMessage",
  ];

  for (const wrapperKey of wrapperKeys) {
    const wrappedValue = message[wrapperKey];

    if (
      wrappedValue &&
      typeof wrappedValue === "object" &&
      "message" in wrappedValue
    ) {
      const nestedMessage = (wrappedValue as { message?: unknown }).message;

      if (nestedMessage && typeof nestedMessage === "object") {
        return unwrapMessageContainer(nestedMessage as Record<string, unknown>);
      }
    }
  }

  return message;
}

function readNestedString(
  value: unknown,
  fieldName: string,
): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const fieldValue = (value as Record<string, unknown>)[fieldName];
  return typeof fieldValue === "string" && fieldValue.trim()
    ? fieldValue.trim()
    : undefined;
}

function inferMessageContent(message: Record<string, unknown>): {
  messageType: WhatsappMessageTypeInput;
  bodyText: string | null;
} {
  const unwrappedMessage = unwrapMessageContainer(message);

  if (typeof unwrappedMessage.conversation === "string") {
    return {
      messageType: "text",
      bodyText: unwrappedMessage.conversation,
    };
  }

  if (unwrappedMessage.extendedTextMessage) {
    return {
      messageType: "text",
      bodyText:
        readNestedString(unwrappedMessage.extendedTextMessage, "text") ?? null,
    };
  }

  if (unwrappedMessage.imageMessage) {
    return {
      messageType: "image",
      bodyText:
        readNestedString(unwrappedMessage.imageMessage, "caption") ?? null,
    };
  }

  if (unwrappedMessage.videoMessage) {
    return {
      messageType: "video",
      bodyText:
        readNestedString(unwrappedMessage.videoMessage, "caption") ?? null,
    };
  }

  if (unwrappedMessage.audioMessage) {
    const isVoice =
      typeof unwrappedMessage.audioMessage === "object" &&
      (unwrappedMessage.audioMessage as Record<string, unknown>).ptt === true;

    return {
      messageType: isVoice ? "voice" : "audio",
      bodyText: null,
    };
  }

  if (unwrappedMessage.documentMessage) {
    return {
      messageType: "document",
      bodyText:
        readNestedString(unwrappedMessage.documentMessage, "caption") ??
        readNestedString(unwrappedMessage.documentMessage, "fileName") ??
        null,
    };
  }

  if (unwrappedMessage.stickerMessage) {
    return {
      messageType: "sticker",
      bodyText: null,
    };
  }

  if (unwrappedMessage.locationMessage) {
    return {
      messageType: "location",
      bodyText:
        readNestedString(unwrappedMessage.locationMessage, "name") ??
        readNestedString(unwrappedMessage.locationMessage, "address") ??
        null,
    };
  }

  if (unwrappedMessage.contactMessage || unwrappedMessage.contactsArrayMessage) {
    return {
      messageType: "contact",
      bodyText:
        readNestedString(unwrappedMessage.contactMessage, "displayName") ??
        null,
    };
  }

  return {
    messageType: "unknown",
    bodyText: null,
  };
}

function parseBaileysTimestamp(value: unknown, fallback: Date): Date {
  if (value instanceof Date) {
    return value;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value < 10_000_000_000 ? value * 1000 : value);
  }

  if (typeof value === "string") {
    const parsed = Number(value);

    if (Number.isFinite(parsed)) {
      return new Date(parsed < 10_000_000_000 ? parsed * 1000 : parsed);
    }

    const parsedDate = new Date(value);

    if (!Number.isNaN(parsedDate.getTime())) {
      return parsedDate;
    }
  }

  if (value && typeof value === "object") {
    const lowValue = (value as Record<string, unknown>).low;

    if (typeof lowValue === "number" && Number.isFinite(lowValue)) {
      return new Date(lowValue * 1000);
    }
  }

  return fallback;
}

function jidToPhoneNumber(jid: string): string | null {
  const [rawUser] = jid.split("@");

  if (!rawUser || !/^\d+$/.test(rawUser)) {
    return null;
  }

  return `+${rawUser}`;
}

export function normalizeBaileysIncomingMessage(
  input: BaileysHandlerInput,
): IngestWhatsappMessageInput | null {
  const parsedMessage = baileysWebMessageSchema.safeParse(input.message);

  if (!parsedMessage.success) {
    throw new AppError({
      code: "BAILEYS_MESSAGE_INVALID",
      message: "Incoming WhatsApp message payload is invalid.",
      statusCode: 400,
    });
  }

  const baileysMessage = parsedMessage.data;
  const externalMessageId = baileysMessage.key?.id;
  const externalChatId = baileysMessage.key?.remoteJid;

  if (!externalMessageId || !externalChatId || !baileysMessage.message) {
    return null;
  }

  if (externalChatId === "status@broadcast") {
    return null;
  }

  const isFromMe = baileysMessage.key?.fromMe ?? false;
  const senderJid = isFromMe
    ? null
    : baileysMessage.key?.participant ?? externalChatId;
  const messageContent = inferMessageContent(baileysMessage.message);
  const ingestedAt = input.ingestedAt ?? new Date();

  return {
    whatsappAccountId: input.whatsappAccountId,
    externalMessageId,
    chat: {
      externalChatId,
      displayName: input.chatDisplayName,
      sourceType: input.chatSourceType ?? "unknown",
    },
    sender: senderJid
      ? {
          externalContactId: senderJid,
          phoneNumber: input.senderPhoneNumber ?? jidToPhoneNumber(senderJid),
          displayName: input.senderDisplayName ?? baileysMessage.pushName,
        }
      : null,
    messageType: messageContent.messageType,
    bodyText: messageContent.bodyText,
    rawPayloadJson: toJsonSafeValue(input.message),
    isFromMe,
    receivedAt: parseBaileysTimestamp(
      baileysMessage.messageTimestamp,
      ingestedAt,
    ),
    ingestedAt,
  };
}

export async function handleBaileysIncomingMessage(
  input: BaileysHandlerInput,
  dependencies: BaileysHandlerDependencies = {},
): Promise<IngestedWhatsappMessageResult | null> {
  const normalizedMessage = normalizeBaileysIncomingMessage(input);

  if (!normalizedMessage) {
    return null;
  }

  const ingestMessage = dependencies.ingestMessage ?? ingestWhatsappMessage;
  return ingestMessage(input.tenantId, normalizedMessage);
}
