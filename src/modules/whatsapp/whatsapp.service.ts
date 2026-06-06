import {
  and,
  desc,
  eq,
  ilike,
  inArray,
  isNull,
  lt,
  or,
  type AnyColumn,
  type SQL,
} from "drizzle-orm";

import { getDatabase } from "../../db/client.ts";
import {
  auditLogs,
  contacts,
  contactWhatsappIdentities,
  trackedSources,
  whatsappAccounts,
  whatsappAuthStates,
  whatsappChats,
  whatsappContacts,
  whatsappMessages,
} from "../../db/schema.ts";
import { AppError } from "../../lib/app-error.ts";
import {
  decodeDateIdCursor,
  encodeDateIdCursor,
} from "../../lib/pagination.ts";
import type {
  CreateWhatsappAccountInput,
  TrackedSourceStatusInput,
  UpsertTrackedSourceInput,
  WhatsappAccountListQuery,
  WhatsappAccountStatusInput,
  WhatsappChatListQuery,
  WhatsappMessageListQuery,
  WhatsappMessageTypeInput,
  WhatsappSourceTypeInput,
} from "./whatsapp.schemas.ts";

type WhatsappAccountRecord = typeof whatsappAccounts.$inferSelect;
type WhatsappChatRecord = typeof whatsappChats.$inferSelect;
type TrackedSourceRecord = typeof trackedSources.$inferSelect;
type WhatsappMessageRecord = typeof whatsappMessages.$inferSelect;

type PageInfo = {
  limit: number;
  nextCursor: string | null;
  hasMore: boolean;
};

type WhatsappAccountDto = {
  id: string;
  phoneNumber: string | null;
  displayName: string | null;
  status: WhatsappAccountStatusInput;
  lastConnectedAt: string | null;
  lastDisconnectedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type WhatsappAccountDetailDto = WhatsappAccountDto & {
  qrAvailable: boolean;
  qrCode: string | null;
  qrExpiresAt: string | null;
};

type TrackedSourceDto = {
  id: string;
  status: TrackedSourceStatusInput;
  sourceType: WhatsappSourceTypeInput;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
};

type WhatsappChatDto = {
  id: string;
  whatsappAccountId: string;
  externalChatId: string;
  displayName: string | null;
  sourceType: WhatsappSourceTypeInput;
  tracking: TrackedSourceDto | null;
  createdAt: string;
  updatedAt: string;
};

type WhatsappMessageDto = {
  id: string;
  whatsappAccountId: string;
  chatId: string;
  senderContactId: string | null;
  externalMessageId: string;
  messageType: WhatsappMessageTypeInput;
  bodyText: string | null;
  isFromMe: boolean;
  isTracked: boolean;
  isLinked: boolean;
  isArchived: boolean;
  isPersonal: boolean;
  isTemporary: boolean;
  expiresAt: string;
  receivedAt: string;
  createdAt: string;
  updatedAt: string;
  chat: {
    externalChatId: string;
    displayName: string | null;
  } | null;
  sender: {
    externalContactId: string;
    phoneNumber: string | null;
    displayName: string | null;
  } | null;
  linkedContact: {
    id: string;
    displayName: string;
    phoneNumber: string | null;
  } | null;
};

type PaginatedResult<TItem> = {
  items: TItem[];
  pageInfo: PageInfo;
};

type MessageWithContext = {
  message: WhatsappMessageRecord;
  chatExternalChatId: string | null;
  chatDisplayName: string | null;
  senderExternalContactId: string | null;
  senderPhoneNumber: string | null;
  senderDisplayName: string | null;
  linkedContactId: string | null;
  linkedContactDisplayName: string | null;
  linkedContactPhoneNumber: string | null;
};

function combineConditions(conditions: SQL[]): SQL | undefined {
  if (conditions.length === 0) {
    return undefined;
  }

  if (conditions.length === 1) {
    return conditions[0];
  }

  return and(...conditions);
}

function toIsoDate(value: Date): string {
  return value.toISOString();
}

function toNullableIsoDate(value: Date | null): string | null {
  return value ? toIsoDate(value) : null;
}

function normalizePhoneNumber(phoneNumber: string | null | undefined): string {
  return phoneNumber?.replace(/\D/g, "") ?? "";
}

function phoneNumberToWhatsappJids(phoneNumber: string | null): string[] {
  const normalizedPhoneNumber = normalizePhoneNumber(phoneNumber);

  if (!normalizedPhoneNumber) {
    return [];
  }

  return [`${normalizedPhoneNumber}@s.whatsapp.net`];
}

function buildPageInfo<TRecord extends { id: string; createdAt: Date }>(
  rows: TRecord[],
  limit: number,
): { pageRows: TRecord[]; pageInfo: PageInfo } {
  const pageRows = rows.slice(0, limit);
  const nextRow = rows[limit];
  const cursorRow = pageRows[pageRows.length - 1];

  return {
    pageRows,
    pageInfo: {
      limit,
      nextCursor: nextRow && cursorRow
        ? encodeDateIdCursor({
            createdAt: cursorRow.createdAt,
            id: cursorRow.id,
          })
        : null,
      hasMore: nextRow !== undefined,
    },
  };
}

function addCursorCondition(
  conditions: SQL[],
  columns: { createdAt: AnyColumn; id: AnyColumn },
  cursorValue: string | undefined,
): void {
  if (!cursorValue) {
    return;
  }

  const cursor = decodeDateIdCursor(cursorValue);
  const cursorCondition = or(
    lt(columns.createdAt, cursor.createdAt),
    and(
      eq(columns.createdAt, cursor.createdAt),
      lt(columns.id, cursor.id),
    ),
  );

  if (cursorCondition) {
    conditions.push(cursorCondition);
  }
}

function toWhatsappAccountDto(
  account: WhatsappAccountRecord,
): WhatsappAccountDto {
  return {
    id: account.id,
    phoneNumber: account.phoneNumber,
    displayName: account.displayName,
    status: account.status,
    lastConnectedAt: toNullableIsoDate(account.lastConnectedAt),
    lastDisconnectedAt: toNullableIsoDate(account.lastDisconnectedAt),
    createdAt: toIsoDate(account.createdAt),
    updatedAt: toIsoDate(account.updatedAt),
  };
}

function isQrAvailable(account: WhatsappAccountRecord): boolean {
  return Boolean(
    account.status === "qr_ready" &&
      account.qrCode &&
      account.qrExpiresAt &&
      account.qrExpiresAt > new Date(),
  );
}

function toWhatsappAccountDetailDto(
  account: WhatsappAccountRecord,
): WhatsappAccountDetailDto {
  const qrAvailable = isQrAvailable(account);

  return {
    ...toWhatsappAccountDto(account),
    qrAvailable,
    qrCode: qrAvailable ? account.qrCode : null,
    qrExpiresAt: qrAvailable ? toNullableIsoDate(account.qrExpiresAt) : null,
  };
}

function toTrackedSourceDto(
  trackedSource: TrackedSourceRecord,
): TrackedSourceDto {
  return {
    id: trackedSource.id,
    status: trackedSource.status,
    sourceType: trackedSource.sourceType,
    createdByUserId: trackedSource.createdByUserId,
    createdAt: toIsoDate(trackedSource.createdAt),
    updatedAt: toIsoDate(trackedSource.updatedAt),
  };
}

function toWhatsappChatDto(
  chat: WhatsappChatRecord,
  trackedSource: TrackedSourceRecord | null,
): WhatsappChatDto {
  return {
    id: chat.id,
    whatsappAccountId: chat.whatsappAccountId,
    externalChatId: chat.externalChatId,
    displayName: chat.displayName,
    sourceType: chat.sourceType,
    tracking: trackedSource ? toTrackedSourceDto(trackedSource) : null,
    createdAt: toIsoDate(chat.createdAt),
    updatedAt: toIsoDate(chat.updatedAt),
  };
}

function toWhatsappMessageDto(row: MessageWithContext): WhatsappMessageDto {
  return {
    id: row.message.id,
    whatsappAccountId: row.message.whatsappAccountId,
    chatId: row.message.chatId,
    senderContactId: row.message.senderContactId,
    externalMessageId: row.message.externalMessageId,
    messageType: row.message.messageType,
    bodyText: row.message.bodyText,
    isFromMe: row.message.isFromMe,
    isTracked: row.message.isTracked,
    isLinked: row.message.isLinked,
    isArchived: row.message.isArchived,
    isPersonal: row.message.isPersonal,
    isTemporary: row.message.isTemporary,
    expiresAt: toIsoDate(row.message.expiresAt),
    receivedAt: toIsoDate(row.message.receivedAt),
    createdAt: toIsoDate(row.message.createdAt),
    updatedAt: toIsoDate(row.message.updatedAt),
    chat: row.chatExternalChatId
      ? {
          externalChatId: row.chatExternalChatId,
          displayName: row.chatDisplayName,
        }
      : null,
    sender: row.senderExternalContactId
      ? {
          externalContactId: row.senderExternalContactId,
          phoneNumber: row.senderPhoneNumber,
          displayName: row.senderDisplayName,
        }
      : null,
    linkedContact: row.linkedContactId
      ? {
          id: row.linkedContactId,
          displayName: row.linkedContactDisplayName ?? "",
          phoneNumber: row.linkedContactPhoneNumber,
        }
      : null,
  };
}

async function findChatForTenant(
  tenantId: string,
  chatId: string,
): Promise<WhatsappChatRecord> {
  const db = getDatabase();
  const rows = await db
    .select()
    .from(whatsappChats)
    .where(and(eq(whatsappChats.tenantId, tenantId), eq(whatsappChats.id, chatId)))
    .limit(1);

  const chat = rows[0];

  if (!chat) {
    throw new AppError({
      code: "WHATSAPP_CHAT_NOT_FOUND",
      message: "WhatsApp chat was not found.",
      statusCode: 404,
    });
  }

  return chat;
}

async function findWhatsappAccountForTenant(
  tenantId: string,
  whatsappAccountId: string,
): Promise<WhatsappAccountRecord> {
  const db = getDatabase();
  const rows = await db
    .select()
    .from(whatsappAccounts)
    .where(
      and(
        eq(whatsappAccounts.tenantId, tenantId),
        eq(whatsappAccounts.id, whatsappAccountId),
        isNull(whatsappAccounts.deletedAt),
      ),
    )
    .limit(1);
  const account = rows[0];

  if (!account) {
    throw new AppError({
      code: "WHATSAPP_ACCOUNT_NOT_FOUND",
      message: "WhatsApp account was not found.",
      statusCode: 404,
    });
  }

  return account;
}

async function resolveMessageContactIdentityFilters(
  tenantId: string,
  contactId: string,
): Promise<SQL | null> {
  const db = getDatabase();
  const contactRows = await db
    .select({
      phoneNumber: contacts.phoneNumber,
    })
    .from(contacts)
    .where(
      and(
        eq(contacts.tenantId, tenantId),
        eq(contacts.id, contactId),
        isNull(contacts.deletedAt),
      ),
    )
    .limit(1);
  const contact = contactRows[0];

  if (!contact) {
    return null;
  }

  const rows = await db
    .select({
      whatsappContactId: whatsappContacts.id,
      whatsappAccountId: whatsappContacts.whatsappAccountId,
      externalContactId: whatsappContacts.externalContactId,
    })
    .from(contactWhatsappIdentities)
    .innerJoin(
      whatsappContacts,
      and(
        eq(whatsappContacts.tenantId, tenantId),
        eq(whatsappContacts.id, contactWhatsappIdentities.whatsappContactId),
      ),
    )
    .innerJoin(
      contacts,
      and(
        eq(contacts.tenantId, tenantId),
        eq(contacts.id, contactWhatsappIdentities.contactId),
        isNull(contacts.deletedAt),
      ),
    )
    .where(
      and(
        eq(contactWhatsappIdentities.tenantId, tenantId),
        eq(contactWhatsappIdentities.contactId, contactId),
      ),
    );

  const whatsappContactIds = new Set(
    rows.map((row) => row.whatsappContactId),
  );
  const externalContactIds = new Set([
    ...rows.map((row) => row.externalContactId),
    ...phoneNumberToWhatsappJids(contact.phoneNumber),
  ]);
  const normalizedContactPhoneNumber = normalizePhoneNumber(contact.phoneNumber);

  if (normalizedContactPhoneNumber) {
    const phoneMatchedRows = await db
      .select({
        id: whatsappContacts.id,
        externalContactId: whatsappContacts.externalContactId,
        phoneNumber: whatsappContacts.phoneNumber,
      })
      .from(whatsappContacts)
      .where(eq(whatsappContacts.tenantId, tenantId));

    for (const row of phoneMatchedRows) {
      if (normalizePhoneNumber(row.phoneNumber) !== normalizedContactPhoneNumber) {
        continue;
      }

      whatsappContactIds.add(row.id);
      externalContactIds.add(row.externalContactId);
    }
  }

  const conditions: SQL[] = [];

  if (whatsappContactIds.size > 0) {
    conditions.push(
      inArray(whatsappMessages.senderContactId, Array.from(whatsappContactIds)),
    );
  }

  if (externalContactIds.size > 0) {
    conditions.push(
      inArray(whatsappChats.externalChatId, Array.from(externalContactIds)),
    );
  }

  if (conditions.length === 0) {
    return null;
  }

  return or(...conditions) ?? null;
}

export async function listWhatsappAccounts(
  tenantId: string,
  query: WhatsappAccountListQuery,
): Promise<PaginatedResult<WhatsappAccountDto>> {
  const db = getDatabase();
  const conditions: SQL[] = [
    eq(whatsappAccounts.tenantId, tenantId),
    isNull(whatsappAccounts.deletedAt),
  ];

  if (query.status) {
    conditions.push(eq(whatsappAccounts.status, query.status));
  }

  addCursorCondition(conditions, whatsappAccounts, query.cursor);

  const rows = await db
    .select()
    .from(whatsappAccounts)
    .where(combineConditions(conditions))
    .orderBy(desc(whatsappAccounts.createdAt), desc(whatsappAccounts.id))
    .limit(query.limit + 1);

  const { pageRows, pageInfo } = buildPageInfo(rows, query.limit);

  return {
    items: pageRows.map(toWhatsappAccountDto),
    pageInfo,
  };
}

export async function createWhatsappAccount(
  tenantId: string,
  actorUserId: string,
  input: CreateWhatsappAccountInput,
): Promise<WhatsappAccountDetailDto> {
  const db = getDatabase();

  const account = await db.transaction(async (transaction) => {
    const accountRows = await transaction
      .insert(whatsappAccounts)
      .values({
        tenantId,
        phoneNumber: input.phoneNumber ?? null,
        displayName: input.displayName ?? null,
        status: "pending_qr",
      })
      .returning();
    const nextAccount = accountRows[0];

    if (!nextAccount) {
      throw new AppError({
        code: "WHATSAPP_ACCOUNT_CREATE_FAILED",
        message: "WhatsApp account could not be created.",
        statusCode: 500,
      });
    }

    await transaction.insert(auditLogs).values({
      tenantId,
      actorUserId,
      action: "whatsapp_account.created",
      entityType: "whatsapp_account",
      entityId: nextAccount.id,
      metadata: {
        hasPhoneNumber: Boolean(input.phoneNumber),
        hasDisplayName: Boolean(input.displayName),
      },
    });

    return nextAccount;
  });

  return toWhatsappAccountDetailDto(account);
}

export async function getWhatsappAccount(
  tenantId: string,
  whatsappAccountId: string,
): Promise<WhatsappAccountDetailDto> {
  const account = await findWhatsappAccountForTenant(tenantId, whatsappAccountId);

  return toWhatsappAccountDetailDto(account);
}

export async function requestWhatsappAccountConnection(
  tenantId: string,
  actorUserId: string,
  whatsappAccountId: string,
): Promise<WhatsappAccountDetailDto> {
  const db = getDatabase();
  const updatedAt = new Date();

  const account = await db.transaction(async (transaction) => {
    const accountRows = await transaction
      .update(whatsappAccounts)
      .set({
        status: "pending_qr",
        qrCode: null,
        qrExpiresAt: null,
        updatedAt,
      })
      .where(
        and(
          eq(whatsappAccounts.tenantId, tenantId),
          eq(whatsappAccounts.id, whatsappAccountId),
          isNull(whatsappAccounts.deletedAt),
        ),
      )
      .returning();
    const nextAccount = accountRows[0];

    if (!nextAccount) {
      throw new AppError({
        code: "WHATSAPP_ACCOUNT_NOT_FOUND",
        message: "WhatsApp account was not found.",
        statusCode: 404,
      });
    }

    await transaction.insert(auditLogs).values({
      tenantId,
      actorUserId,
      action: "whatsapp_account.connect_requested",
      entityType: "whatsapp_account",
      entityId: whatsappAccountId,
      metadata: {},
    });

    return nextAccount;
  });

  return toWhatsappAccountDetailDto(account);
}

export async function requestWhatsappAccountDisconnect(
  tenantId: string,
  actorUserId: string,
  whatsappAccountId: string,
): Promise<WhatsappAccountDetailDto> {
  const db = getDatabase();
  const updatedAt = new Date();

  const account = await db.transaction(async (transaction) => {
    const accountRows = await transaction
      .update(whatsappAccounts)
      .set({
        status: "disconnected",
        lastDisconnectedAt: updatedAt,
        qrCode: null,
        qrExpiresAt: null,
        updatedAt,
      })
      .where(
        and(
          eq(whatsappAccounts.tenantId, tenantId),
          eq(whatsappAccounts.id, whatsappAccountId),
          isNull(whatsappAccounts.deletedAt),
        ),
      )
      .returning();
    const nextAccount = accountRows[0];

    if (!nextAccount) {
      throw new AppError({
        code: "WHATSAPP_ACCOUNT_NOT_FOUND",
        message: "WhatsApp account was not found.",
        statusCode: 404,
      });
    }

    await transaction.insert(auditLogs).values({
      tenantId,
      actorUserId,
      action: "whatsapp_account.disconnect_requested",
      entityType: "whatsapp_account",
      entityId: whatsappAccountId,
      metadata: {},
    });

    await transaction
      .delete(whatsappAuthStates)
      .where(
        and(
          eq(whatsappAuthStates.tenantId, tenantId),
          eq(whatsappAuthStates.whatsappAccountId, whatsappAccountId),
        ),
      );

    return nextAccount;
  });

  return toWhatsappAccountDetailDto(account);
}

export async function listWhatsappChats(
  tenantId: string,
  query: WhatsappChatListQuery,
): Promise<PaginatedResult<WhatsappChatDto>> {
  const db = getDatabase();
  const conditions: SQL[] = [eq(whatsappChats.tenantId, tenantId)];

  if (query.whatsappAccountId) {
    conditions.push(eq(whatsappChats.whatsappAccountId, query.whatsappAccountId));
  }

  if (query.sourceType) {
    conditions.push(eq(whatsappChats.sourceType, query.sourceType));
  }

  if (query.trackingStatus === "unconfigured") {
    conditions.push(isNull(trackedSources.id));
  } else if (query.trackingStatus) {
    conditions.push(eq(trackedSources.status, query.trackingStatus));
  }

  if (query.search) {
    const searchPattern = `%${query.search}%`;
    const searchCondition = or(
      ilike(whatsappChats.displayName, searchPattern),
      ilike(whatsappChats.externalChatId, searchPattern),
    );

    if (searchCondition) {
      conditions.push(searchCondition);
    }
  }

  addCursorCondition(conditions, whatsappChats, query.cursor);

  const rows = await db
    .select({
      chat: whatsappChats,
      trackedSource: trackedSources,
    })
    .from(whatsappChats)
    .leftJoin(
      trackedSources,
      and(
        eq(trackedSources.tenantId, tenantId),
        eq(trackedSources.chatId, whatsappChats.id),
      ),
    )
    .where(combineConditions(conditions))
    .orderBy(desc(whatsappChats.createdAt), desc(whatsappChats.id))
    .limit(query.limit + 1);

  const { pageRows, pageInfo } = buildPageInfo(
    rows.map((row) => ({
      ...row.chat,
      trackedSource: row.trackedSource,
    })),
    query.limit,
  );

  return {
    items: pageRows.map((row) => toWhatsappChatDto(row, row.trackedSource)),
    pageInfo,
  };
}

export async function upsertTrackedSource(
  tenantId: string,
  actorUserId: string,
  chatId: string,
  input: UpsertTrackedSourceInput,
): Promise<WhatsappChatDto> {
  const chat = await findChatForTenant(tenantId, chatId);
  const db = getDatabase();
  const updatedAt = new Date();

  const trackedSource = await db.transaction(async (transaction) => {
    await transaction
      .update(whatsappChats)
      .set({
        sourceType: input.sourceType,
        updatedAt,
      })
      .where(and(eq(whatsappChats.tenantId, tenantId), eq(whatsappChats.id, chatId)));

    const existingRows = await transaction
      .select()
      .from(trackedSources)
      .where(
        and(eq(trackedSources.tenantId, tenantId), eq(trackedSources.chatId, chatId)),
      )
      .limit(1);

    const existingTrackedSource = existingRows[0];

    const trackedSourceRows = existingTrackedSource
      ? await transaction
          .update(trackedSources)
          .set({
            status: input.status,
            sourceType: input.sourceType,
            updatedAt,
          })
          .where(
            and(
              eq(trackedSources.tenantId, tenantId),
              eq(trackedSources.id, existingTrackedSource.id),
            ),
          )
          .returning()
      : await transaction
          .insert(trackedSources)
          .values({
            tenantId,
            whatsappAccountId: chat.whatsappAccountId,
            chatId,
            status: input.status,
            sourceType: input.sourceType,
            createdByUserId: actorUserId,
          })
          .returning();

    const nextTrackedSource = trackedSourceRows[0];

    if (!nextTrackedSource) {
      throw new AppError({
        code: "TRACKED_SOURCE_UPDATE_FAILED",
        message: "Tracked source could not be updated.",
        statusCode: 500,
      });
    }

    await transaction.insert(auditLogs).values({
      tenantId,
      actorUserId,
      action: "tracked_source.updated",
      entityType: "tracked_source",
      entityId: nextTrackedSource.id,
      metadata: {
        chatId,
        whatsappAccountId: chat.whatsappAccountId,
        status: input.status,
        sourceType: input.sourceType,
      },
    });

    return nextTrackedSource;
  });

  return toWhatsappChatDto(
    {
      ...chat,
      sourceType: input.sourceType,
      updatedAt,
    },
    trackedSource,
  );
}

export async function listWhatsappMessages(
  tenantId: string,
  query: WhatsappMessageListQuery,
): Promise<PaginatedResult<WhatsappMessageDto>> {
  const db = getDatabase();
  const conditions: SQL[] = [
    eq(whatsappMessages.tenantId, tenantId),
    isNull(whatsappMessages.deletedAt),
  ];

  if (query.whatsappAccountId) {
    conditions.push(eq(whatsappMessages.whatsappAccountId, query.whatsappAccountId));
  }

  if (query.chatId) {
    conditions.push(eq(whatsappMessages.chatId, query.chatId));
  }

  if (query.senderContactId) {
    conditions.push(eq(whatsappMessages.senderContactId, query.senderContactId));
  }

  if (query.contactId) {
    const contactIdentityCondition = await resolveMessageContactIdentityFilters(
      tenantId,
      query.contactId,
    );

    if (!contactIdentityCondition) {
      return {
        items: [],
        pageInfo: {
          limit: query.limit,
          nextCursor: null,
          hasMore: false,
        },
      };
    }

    conditions.push(contactIdentityCondition);
  }

  if (query.messageType) {
    conditions.push(eq(whatsappMessages.messageType, query.messageType));
  }

  if (query.isTracked !== undefined) {
    conditions.push(eq(whatsappMessages.isTracked, query.isTracked));
  }

  if (query.isLinked !== undefined) {
    conditions.push(eq(whatsappMessages.isLinked, query.isLinked));
  }

  if (query.isArchived !== undefined) {
    conditions.push(eq(whatsappMessages.isArchived, query.isArchived));
  }

  if (query.isPersonal !== undefined) {
    conditions.push(eq(whatsappMessages.isPersonal, query.isPersonal));
  }

  if (query.search) {
    const searchPattern = `%${query.search}%`;
    conditions.push(ilike(whatsappMessages.bodyText, searchPattern));
  }

  addCursorCondition(conditions, whatsappMessages, query.cursor);

  const rows = await db
    .select({
      message: whatsappMessages,
      chatExternalChatId: whatsappChats.externalChatId,
      chatDisplayName: whatsappChats.displayName,
      senderExternalContactId: whatsappContacts.externalContactId,
      senderPhoneNumber: whatsappContacts.phoneNumber,
      senderDisplayName: whatsappContacts.displayName,
      linkedContactId: contacts.id,
      linkedContactDisplayName: contacts.displayName,
      linkedContactPhoneNumber: contacts.phoneNumber,
    })
    .from(whatsappMessages)
    .leftJoin(
      whatsappChats,
      and(
        eq(whatsappChats.tenantId, tenantId),
        eq(whatsappChats.id, whatsappMessages.chatId),
      ),
    )
    .leftJoin(
      whatsappContacts,
      and(
        eq(whatsappContacts.tenantId, tenantId),
        eq(whatsappContacts.id, whatsappMessages.senderContactId),
      ),
    )
    .leftJoin(
      contactWhatsappIdentities,
      and(
        eq(contactWhatsappIdentities.tenantId, tenantId),
        eq(
          contactWhatsappIdentities.whatsappContactId,
          whatsappMessages.senderContactId,
        ),
      ),
    )
    .leftJoin(
      contacts,
      and(
        eq(contacts.tenantId, tenantId),
        eq(contacts.id, contactWhatsappIdentities.contactId),
        isNull(contacts.deletedAt),
      ),
    )
    .where(combineConditions(conditions))
    .orderBy(desc(whatsappMessages.createdAt), desc(whatsappMessages.id))
    .limit(query.limit + 1);

  const { pageRows, pageInfo } = buildPageInfo(
    rows.map((row) => row.message),
    query.limit,
  );
  const rowsByMessageId = new Map(rows.map((row) => [row.message.id, row]));

  return {
    items: pageRows.map((message) => {
      const row = rowsByMessageId.get(message.id);

      if (!row) {
        throw new AppError({
          code: "WHATSAPP_MESSAGE_PAGE_INVALID",
          message: "Message page could not be built.",
          statusCode: 500,
        });
      }

      return toWhatsappMessageDto(row);
    }),
    pageInfo,
  };
}

export async function getWhatsappMessage(
  tenantId: string,
  messageId: string,
): Promise<WhatsappMessageDto> {
  const db = getDatabase();
  const rows = await db
    .select({
      message: whatsappMessages,
      chatExternalChatId: whatsappChats.externalChatId,
      chatDisplayName: whatsappChats.displayName,
      senderExternalContactId: whatsappContacts.externalContactId,
      senderPhoneNumber: whatsappContacts.phoneNumber,
      senderDisplayName: whatsappContacts.displayName,
      linkedContactId: contacts.id,
      linkedContactDisplayName: contacts.displayName,
      linkedContactPhoneNumber: contacts.phoneNumber,
    })
    .from(whatsappMessages)
    .leftJoin(
      whatsappChats,
      and(
        eq(whatsappChats.tenantId, tenantId),
        eq(whatsappChats.id, whatsappMessages.chatId),
      ),
    )
    .leftJoin(
      whatsappContacts,
      and(
        eq(whatsappContacts.tenantId, tenantId),
        eq(whatsappContacts.id, whatsappMessages.senderContactId),
      ),
    )
    .leftJoin(
      contactWhatsappIdentities,
      and(
        eq(contactWhatsappIdentities.tenantId, tenantId),
        eq(
          contactWhatsappIdentities.whatsappContactId,
          whatsappMessages.senderContactId,
        ),
      ),
    )
    .leftJoin(
      contacts,
      and(
        eq(contacts.tenantId, tenantId),
        eq(contacts.id, contactWhatsappIdentities.contactId),
        isNull(contacts.deletedAt),
      ),
    )
    .where(
      and(
        eq(whatsappMessages.tenantId, tenantId),
        eq(whatsappMessages.id, messageId),
        isNull(whatsappMessages.deletedAt),
      ),
    )
    .limit(1);

  const row = rows[0];

  if (!row) {
    throw new AppError({
      code: "WHATSAPP_MESSAGE_NOT_FOUND",
      message: "WhatsApp message was not found.",
      statusCode: 404,
    });
  }

  return toWhatsappMessageDto(row);
}
