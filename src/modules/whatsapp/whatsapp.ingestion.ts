import { and, eq, isNull } from "drizzle-orm";

import { getDatabase, type AppDatabase } from "../../db/client.ts";
import {
  contacts,
  contactWhatsappIdentities,
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

export type IngestedWhatsappMessageResult = {
  tenantId: string;
  whatsappAccountId: string;
  chatId: string;
  senderContactId: string | null;
  messageId: string;
  externalMessageId: string;
  expiresAt: Date;
  wasCreated: boolean;
};

type DatabaseExecutor = Pick<AppDatabase, "insert" | "select">;

type WhatsappContactInput = {
  externalContactId: string;
  phoneNumber?: string | null | undefined;
  displayName?: string | null | undefined;
};

function addTemporaryMessageTtl(ingestedAt: Date): Date {
  return new Date(ingestedAt.getTime() + temporaryMessageTtlMs);
}

function normalizePhoneNumber(phoneNumber: string | null | undefined): string {
  return phoneNumber?.replace(/\D/g, "") ?? "";
}

function jidToPhoneNumber(jid: string): string | null {
  const [rawUser, domain] = jid.split("@");
  const user = rawUser?.split(":")[0] ?? "";

  // Only phone-number addressed JIDs encode a real phone number. LID
  // (`@lid`) and group (`@g.us`) JIDs contain opaque identifiers, not
  // phone numbers, so they must not be coerced into a `+digits` value.
  if (!/^\d+$/.test(user) || (domain !== "s.whatsapp.net" && domain !== "c.us")) {
    return null;
  }

  return `+${user}`;
}

function isDirectChatExternalId(externalChatId: string): boolean {
  return (
    externalChatId.endsWith("@s.whatsapp.net") ||
    externalChatId.endsWith("@lid")
  );
}

function toOutgoingCounterpartyContactInput(input: {
  externalChatId: string;
  displayName?: string | null | undefined;
  counterpartyPhoneNumber?: string | null | undefined;
}): WhatsappContactInput | null {
  if (!isDirectChatExternalId(input.externalChatId)) {
    return null;
  }

  return {
    externalContactId: input.externalChatId,
    phoneNumber:
      input.counterpartyPhoneNumber ?? jidToPhoneNumber(input.externalChatId),
    displayName: input.displayName,
  };
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

async function upsertWhatsappContact(
  executor: DatabaseExecutor,
  tenantId: string,
  whatsappAccountId: string,
  input: WhatsappContactInput,
  updatedAt: Date,
): Promise<typeof whatsappContacts.$inferSelect> {
  const contactUpdateValues: Partial<typeof whatsappContacts.$inferInsert> = {
    updatedAt,
  };

  if (input.phoneNumber !== undefined) {
    contactUpdateValues.phoneNumber = input.phoneNumber;
  }

  if (input.displayName !== undefined) {
    contactUpdateValues.displayName = input.displayName;
  }

  const contactRows = await executor
    .insert(whatsappContacts)
    .values({
      tenantId,
      whatsappAccountId,
      externalContactId: input.externalContactId,
      phoneNumber: input.phoneNumber ?? null,
      displayName: input.displayName ?? null,
      createdAt: updatedAt,
      updatedAt,
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

  return requiredRow(
    contactRows[0],
    "WHATSAPP_CONTACT_INGEST_FAILED",
    "WhatsApp contact could not be stored.",
  );
}

async function linkWhatsappContactToMatchingSavedContact(
  executor: DatabaseExecutor,
  tenantId: string,
  whatsappContactId: string,
  phoneNumber: string | null,
): Promise<void> {
  const normalizedPhoneNumber = normalizePhoneNumber(phoneNumber);

  if (!normalizedPhoneNumber) {
    return;
  }

  const contactRows = await executor
    .select({
      id: contacts.id,
      phoneNumber: contacts.phoneNumber,
    })
    .from(contacts)
    .where(and(eq(contacts.tenantId, tenantId), isNull(contacts.deletedAt)));
  const matchingContactIds = contactRows
    .filter(
      (contact) =>
        normalizePhoneNumber(contact.phoneNumber) === normalizedPhoneNumber,
    )
    .map((contact) => contact.id);

  const matchingContactId = matchingContactIds[0];

  if (matchingContactIds.length !== 1 || !matchingContactId) {
    return;
  }

  await executor
    .insert(contactWhatsappIdentities)
    .values({
      tenantId,
      contactId: matchingContactId,
      whatsappContactId,
    })
    .onConflictDoNothing({
      target: [
        contactWhatsappIdentities.tenantId,
        contactWhatsappIdentities.whatsappContactId,
      ],
    });
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
      const contact = await upsertWhatsappContact(
        transaction,
        tenantId,
        account.id,
        normalizedInput.sender,
        ingestedAt,
      );
      senderContactId = contact.id;
      await linkWhatsappContactToMatchingSavedContact(
        transaction,
        tenantId,
        contact.id,
        contact.phoneNumber,
      );
    } else if (normalizedInput.isFromMe) {
      const counterpartyContactInput = toOutgoingCounterpartyContactInput(
        normalizedInput.chat,
      );

      if (counterpartyContactInput) {
        const contact = await upsertWhatsappContact(
          transaction,
          tenantId,
          account.id,
          counterpartyContactInput,
          ingestedAt,
        );

        await linkWhatsappContactToMatchingSavedContact(
          transaction,
          tenantId,
          contact.id,
          contact.phoneNumber,
        );
      }
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
