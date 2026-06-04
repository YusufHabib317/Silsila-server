import { and, eq, isNull } from "drizzle-orm";

import { getDatabase } from "../../db/client.ts";
import {
  trackedSources,
  whatsappAccounts,
  whatsappChats,
  whatsappContacts,
  whatsappMessages,
} from "../../db/schema.ts";
import { AppError } from "../../lib/app-error.ts";
import {
  ingestWhatsappMessageSchema,
  type IngestWhatsappMessageInput,
} from "./whatsapp.schemas.ts";

const temporaryMessageTtlMs = 1000 * 60 * 60 * 24;

type IngestedWhatsappMessageResult = {
  tenantId: string;
  whatsappAccountId: string;
  chatId: string;
  senderContactId: string | null;
  messageId: string;
  externalMessageId: string;
  expiresAt: Date;
  wasCreated: boolean;
};

function addTemporaryMessageTtl(ingestedAt: Date): Date {
  return new Date(ingestedAt.getTime() + temporaryMessageTtlMs);
}

function requiredRow<TRecord>(
  row: TRecord | undefined,
  code: string,
  message: string,
): TRecord {
  if (!row) {
    throw new AppError({
      code,
      message,
      statusCode: 500,
    });
  }

  return row;
}

export async function ingestWhatsappMessage(
  tenantId: string,
  input: IngestWhatsappMessageInput,
): Promise<IngestedWhatsappMessageResult> {
  const normalizedInput = ingestWhatsappMessageSchema.parse(input);
  const db = getDatabase();
  const ingestedAt = normalizedInput.ingestedAt ?? new Date();
  const expiresAt = addTemporaryMessageTtl(ingestedAt);

  return db.transaction(async (transaction) => {
    const accountRows = await transaction
      .select()
      .from(whatsappAccounts)
      .where(
        and(
          eq(whatsappAccounts.tenantId, tenantId),
          eq(whatsappAccounts.id, normalizedInput.whatsappAccountId),
          isNull(whatsappAccounts.deletedAt),
        ),
      )
      .limit(1);
    const account = accountRows[0];

    if (!account) {
      throw new AppError({
        code: "WHATSAPP_ACCOUNT_NOT_FOUND",
        message: "WhatsApp account was not found.",
        statusCode: 404,
      });
    }

    const chatUpdateValues: Partial<typeof whatsappChats.$inferInsert> = {
      updatedAt: ingestedAt,
    };

    if (normalizedInput.chat.displayName !== undefined) {
      chatUpdateValues.displayName = normalizedInput.chat.displayName;
    }

    const chatRows = await transaction
      .insert(whatsappChats)
      .values({
        tenantId,
        whatsappAccountId: account.id,
        externalChatId: normalizedInput.chat.externalChatId,
        displayName: normalizedInput.chat.displayName ?? null,
        sourceType: normalizedInput.chat.sourceType,
        createdAt: ingestedAt,
        updatedAt: ingestedAt,
      })
      .onConflictDoUpdate({
        target: [
          whatsappChats.tenantId,
          whatsappChats.whatsappAccountId,
          whatsappChats.externalChatId,
        ],
        set: chatUpdateValues,
      })
      .returning();
    const chat = requiredRow(
      chatRows[0],
      "WHATSAPP_CHAT_INGEST_FAILED",
      "WhatsApp chat could not be stored.",
    );

    let senderContactId: string | null = null;

    if (normalizedInput.sender) {
      const contactUpdateValues: Partial<
        typeof whatsappContacts.$inferInsert
      > = {
        updatedAt: ingestedAt,
      };

      if (normalizedInput.sender.phoneNumber !== undefined) {
        contactUpdateValues.phoneNumber = normalizedInput.sender.phoneNumber;
      }

      if (normalizedInput.sender.displayName !== undefined) {
        contactUpdateValues.displayName = normalizedInput.sender.displayName;
      }

      const contactRows = await transaction
        .insert(whatsappContacts)
        .values({
          tenantId,
          whatsappAccountId: account.id,
          externalContactId: normalizedInput.sender.externalContactId,
          phoneNumber: normalizedInput.sender.phoneNumber ?? null,
          displayName: normalizedInput.sender.displayName ?? null,
          createdAt: ingestedAt,
          updatedAt: ingestedAt,
        })
        .onConflictDoUpdate({
          target: [
            whatsappContacts.tenantId,
            whatsappContacts.whatsappAccountId,
            whatsappContacts.externalContactId,
          ],
          set: contactUpdateValues,
        })
        .returning();
      const contact = requiredRow(
        contactRows[0],
        "WHATSAPP_CONTACT_INGEST_FAILED",
        "WhatsApp contact could not be stored.",
      );
      senderContactId = contact.id;
    }

    const trackedSourceRows = await transaction
      .select({
        status: trackedSources.status,
      })
      .from(trackedSources)
      .where(
        and(
          eq(trackedSources.tenantId, tenantId),
          eq(trackedSources.chatId, chat.id),
        ),
      )
      .limit(1);
    const sourceStatus = trackedSourceRows[0]?.status ?? null;

    const insertedMessageRows = await transaction
      .insert(whatsappMessages)
      .values({
        tenantId,
        whatsappAccountId: account.id,
        chatId: chat.id,
        senderContactId,
        externalMessageId: normalizedInput.externalMessageId,
        messageType: normalizedInput.messageType,
        bodyText: normalizedInput.bodyText ?? null,
        rawPayloadJson: normalizedInput.rawPayloadJson,
        isFromMe: normalizedInput.isFromMe,
        isTracked: false,
        isLinked: false,
        isArchived: sourceStatus === "ignored",
        isPersonal: sourceStatus === "personal",
        isTemporary: true,
        expiresAt,
        receivedAt: normalizedInput.receivedAt,
        createdAt: ingestedAt,
        updatedAt: ingestedAt,
      })
      .onConflictDoNothing({
        target: [
          whatsappMessages.tenantId,
          whatsappMessages.whatsappAccountId,
          whatsappMessages.externalMessageId,
        ],
      })
      .returning();

    const insertedMessage = insertedMessageRows[0];

    if (insertedMessage) {
      return {
        tenantId,
        whatsappAccountId: account.id,
        chatId: chat.id,
        senderContactId,
        messageId: insertedMessage.id,
        externalMessageId: insertedMessage.externalMessageId,
        expiresAt: insertedMessage.expiresAt,
        wasCreated: true,
      };
    }

    const existingMessageRows = await transaction
      .select()
      .from(whatsappMessages)
      .where(
        and(
          eq(whatsappMessages.tenantId, tenantId),
          eq(whatsappMessages.whatsappAccountId, account.id),
          eq(
            whatsappMessages.externalMessageId,
            normalizedInput.externalMessageId,
          ),
        ),
      )
      .limit(1);
    const existingMessage = requiredRow(
      existingMessageRows[0],
      "WHATSAPP_MESSAGE_INGEST_CONFLICT",
      "WhatsApp message conflict could not be resolved.",
    );

    return {
      tenantId,
      whatsappAccountId: account.id,
      chatId: existingMessage.chatId,
      senderContactId: existingMessage.senderContactId,
      messageId: existingMessage.id,
      externalMessageId: existingMessage.externalMessageId,
      expiresAt: existingMessage.expiresAt,
      wasCreated: false,
    };
  });
}
