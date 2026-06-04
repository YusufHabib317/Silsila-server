import { afterEach, describe, expect, it } from "bun:test";
import { readdir, readFile } from "node:fs/promises";

import { PGlite } from "@electric-sql/pglite";
import { and, count, eq } from "drizzle-orm";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import type { FastifyInstance } from "fastify";

import type { AppDatabase } from "../src/db/client.ts";
import * as schema from "../src/db/schema.ts";
import { hashSessionToken } from "../src/modules/auth/passwords.ts";

process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = "silent";

const sessionCookieName = "wa_commerce_session";
const csrfCookieName = "wa_commerce_csrf";
const csrfHeaderName = "x-csrf-token";
const sessionToken = "test-session-token";
const csrfToken = "test-csrf-token";
const apiTestTimeoutMs = 15_000;

const ids = {
  user: uuid(1),
  tenantA: uuid(2),
  tenantB: uuid(3),
  session: uuid(4),
  tenantUserA: uuid(5),
  tenantUserB: uuid(6),
  accountA1: uuid(10),
  accountA2: uuid(11),
  accountB1: uuid(12),
  chatA1: uuid(20),
  chatA2: uuid(21),
  chatA3: uuid(22),
  chatB1: uuid(23),
  trackedA1: uuid(30),
  contactA1: uuid(40),
  contactB1: uuid(41),
  messageA1: uuid(50),
  messageA2: uuid(51),
  messageA3: uuid(52),
  messageB1: uuid(53),
} as const;

type TestDatabase = PgliteDatabase<typeof schema> & {
  $client: PGlite;
};

type ApiTestContext = {
  app: FastifyInstance;
  client: PGlite;
  db: TestDatabase;
  get: <TBody>(url: string, tenantId?: string) => Promise<InjectedJson<TBody>>;
  post: <TBody>(
    url: string,
    payload: unknown,
    tenantId?: string,
  ) => Promise<InjectedJson<TBody>>;
  put: <TBody>(
    url: string,
    payload: unknown,
    tenantId?: string,
  ) => Promise<InjectedJson<TBody>>;
  setDatabaseForTesting: (database: AppDatabase | null) => void;
};

type InjectedJson<TBody> = {
  statusCode: number;
  body: TBody;
};

type ErrorResponse = {
  error: {
    code: string;
    message: string;
    requestId: string;
    details?: unknown;
  };
};

type WhatsappAccountDto = {
  id: string;
  status: string;
  displayName: string | null;
};

type WhatsappAccountDetailDto = WhatsappAccountDto & {
  qrAvailable: boolean;
  qrCode: string | null;
  qrExpiresAt: string | null;
};

type TrackedSourceDto = {
  id: string;
  status: string;
  sourceType: string;
};

type WhatsappChatDto = {
  id: string;
  externalChatId: string;
  displayName: string | null;
  sourceType: string;
  tracking: TrackedSourceDto | null;
};

type WhatsappMessageDto = {
  id: string;
  externalMessageId: string;
  messageType: string;
  bodyText: string | null;
  isArchived: boolean;
  chat: {
    externalChatId: string;
    displayName: string | null;
  } | null;
  sender: {
    externalContactId: string;
    phoneNumber: string | null;
    displayName: string | null;
  } | null;
};

type ListResponse<TItem> = {
  items: TItem[];
  pageInfo: {
    limit: number;
    nextCursor: string | null;
    hasMore: boolean;
  };
};

let currentContext: ApiTestContext | null = null;

afterEach(async () => {
  if (!currentContext) {
    return;
  }

  await currentContext.app.close();
  currentContext.setDatabaseForTesting(null);
  await currentContext.client.close();
  currentContext = null;
});

describe("whatsapp source and inbox APIs", () => {
  it(
    "keeps GET /whatsapp/accounts tenant-scoped and cursor paginated",
    async () => {
      const context = await setupApiTest();
      await seedWhatsappGraph(context.db);

      const firstPage = await context.get<ListResponse<WhatsappAccountDto>>(
        "/whatsapp/accounts?limit=1",
      );
      expect(firstPage.statusCode).toBe(200);
      expect(firstPage.body.items.map((account) => account.id)).toEqual([
        ids.accountA1,
      ]);
      expect(firstPage.body.items.map((account) => account.id)).not.toContain(
        ids.accountB1,
      );
      expect(firstPage.body.pageInfo.hasMore).toBe(true);
      expect(typeof firstPage.body.pageInfo.nextCursor).toBe("string");

      const nextCursor = firstPage.body.pageInfo.nextCursor;
      if (!nextCursor) {
        throw new Error("Expected accounts nextCursor to be set.");
      }

      const secondPage = await context.get<ListResponse<WhatsappAccountDto>>(
        `/whatsapp/accounts?limit=1&cursor=${encodeURIComponent(nextCursor)}`,
      );
      expect(secondPage.statusCode).toBe(200);
      expect(secondPage.body.items.map((account) => account.id)).toEqual([
        ids.accountA2,
      ]);
      expect(secondPage.body.pageInfo.hasMore).toBe(false);

      const disconnected = await context.get<ListResponse<WhatsappAccountDto>>(
        "/whatsapp/accounts?status=disconnected",
      );
      expect(disconnected.statusCode).toBe(200);
      expect(disconnected.body.items.map((account) => account.id)).toEqual([
        ids.accountA2,
      ]);
    },
    apiTestTimeoutMs,
  );

  it(
    "creates WhatsApp accounts and exposes QR only on account detail",
    async () => {
      const context = await setupApiTest();

      const created = await context.post<WhatsappAccountDetailDto>(
        "/whatsapp/accounts",
        {
          displayName: "Main WhatsApp",
          phoneNumber: "+963900000010",
        },
      );
      expect(created.statusCode).toBe(200);
      expect(created.body.status).toBe("pending_qr");
      expect(created.body.displayName).toBe("Main WhatsApp");
      expect(created.body.qrAvailable).toBe(false);
      expect(created.body.qrCode).toBeNull();

      await context.db
        .update(schema.whatsappAccounts)
        .set({
          status: "qr_ready",
          qrCode: "qr-secret-value",
          qrExpiresAt: date("2099-01-01T00:00:00.000Z"),
        })
        .where(eq(schema.whatsappAccounts.id, created.body.id));

      const detail = await context.get<WhatsappAccountDetailDto>(
        `/whatsapp/accounts/${created.body.id}`,
      );
      expect(detail.statusCode).toBe(200);
      expect(detail.body.qrAvailable).toBe(true);
      expect(detail.body.qrCode).toBe("qr-secret-value");
      expect(detail.body.qrExpiresAt).toBe("2099-01-01T00:00:00.000Z");

      const list = await context.get<ListResponse<Record<string, unknown>>>(
        "/whatsapp/accounts",
      );
      expect(list.statusCode).toBe(200);
      expect("qrCode" in list.body.items[0]!).toBe(false);
      expect("qrExpiresAt" in list.body.items[0]!).toBe(false);

      const connectRequested = await context.post<WhatsappAccountDetailDto>(
        `/whatsapp/accounts/${created.body.id}/connect`,
        {},
      );
      expect(connectRequested.statusCode).toBe(200);
      expect(connectRequested.body.status).toBe("pending_qr");
      expect(connectRequested.body.qrAvailable).toBe(false);
      expect(connectRequested.body.qrCode).toBeNull();

      await context.db
        .update(schema.whatsappAccounts)
        .set({
          status: "qr_ready",
          qrCode: "expired-qr-secret",
          qrExpiresAt: date("2026-01-01T00:00:00.000Z"),
        })
        .where(eq(schema.whatsappAccounts.id, created.body.id));

      const expiredQrDetail = await context.get<WhatsappAccountDetailDto>(
        `/whatsapp/accounts/${created.body.id}`,
      );
      expect(expiredQrDetail.statusCode).toBe(200);
      expect(expiredQrDetail.body.qrAvailable).toBe(false);
      expect(expiredQrDetail.body.qrCode).toBeNull();

      await context.db.insert(schema.whatsappAuthStates).values({
        tenantId: ids.tenantA,
        whatsappAccountId: created.body.id,
        keyType: "creds",
        keyId: "creds",
        encryptedPayload: "encrypted-test-payload",
      });

      const disconnectRequested = await context.post<WhatsappAccountDetailDto>(
        `/whatsapp/accounts/${created.body.id}/disconnect`,
        {},
      );
      expect(disconnectRequested.statusCode).toBe(200);
      expect(disconnectRequested.body.status).toBe("disconnected");
      expect(disconnectRequested.body.qrCode).toBeNull();

      const authStateCounts = await context.db
        .select({ value: count() })
        .from(schema.whatsappAuthStates)
        .where(
          and(
            eq(schema.whatsappAuthStates.tenantId, ids.tenantA),
            eq(schema.whatsappAuthStates.whatsappAccountId, created.body.id),
          ),
        );
      expect(authStateCounts[0]?.value).toBe(0);

      const auditRows = await context.db
        .select({
          action: schema.auditLogs.action,
          entityId: schema.auditLogs.entityId,
        })
        .from(schema.auditLogs)
        .where(
          and(
            eq(schema.auditLogs.tenantId, ids.tenantA),
            eq(schema.auditLogs.entityId, created.body.id),
          ),
        );
      expect(auditRows.map((row) => row.action).sort()).toEqual([
        "whatsapp_account.connect_requested",
        "whatsapp_account.created",
        "whatsapp_account.disconnect_requested",
      ]);
    },
    apiTestTimeoutMs,
  );

  it(
    "keeps GET /whatsapp/accounts/:id tenant-scoped",
    async () => {
      const context = await setupApiTest();
      await seedWhatsappGraph(context.db);

      const ownAccount = await context.get<WhatsappAccountDetailDto>(
        `/whatsapp/accounts/${ids.accountA1}`,
      );
      expect(ownAccount.statusCode).toBe(200);
      expect(ownAccount.body.id).toBe(ids.accountA1);

      const foreignAccount = await context.get<ErrorResponse>(
        `/whatsapp/accounts/${ids.accountB1}`,
      );
      expect(foreignAccount.statusCode).toBe(404);
      expect(foreignAccount.body.error.code).toBe("WHATSAPP_ACCOUNT_NOT_FOUND");

      const tenantBOwnAccount = await context.get<WhatsappAccountDetailDto>(
        `/whatsapp/accounts/${ids.accountB1}`,
        ids.tenantB,
      );
      expect(tenantBOwnAccount.statusCode).toBe(200);
      expect(tenantBOwnAccount.body.id).toBe(ids.accountB1);
    },
    apiTestTimeoutMs,
  );

  it(
    "lists chats with tracked-source state and filters by tracking status",
    async () => {
      const context = await setupApiTest();
      await seedWhatsappGraph(context.db);

      const tracked = await context.get<ListResponse<WhatsappChatDto>>(
        "/whatsapp/chats?trackingStatus=tracked",
      );
      expect(tracked.statusCode).toBe(200);
      expect(tracked.body.items.map((chat) => chat.id)).toEqual([ids.chatA1]);
      expect(tracked.body.items[0]?.tracking?.status).toBe("tracked");

      const searched = await context.get<ListResponse<WhatsappChatDto>>(
        "/whatsapp/chats?search=Retail",
      );
      expect(searched.statusCode).toBe(200);
      expect(searched.body.items.map((chat) => chat.id)).toEqual([ids.chatA1]);
      expect(searched.body.items.map((chat) => chat.id)).not.toContain(
        ids.chatB1,
      );
    },
    apiTestTimeoutMs,
  );

  it(
    "upserts tracked source settings for tenant-owned chats only",
    async () => {
      const context = await setupApiTest();
      await seedWhatsappGraph(context.db);

      const foreignChat = await context.put<ErrorResponse>(
        `/tracked-sources/${ids.chatB1}`,
        {
          status: "tracked",
          sourceType: "merchant_group",
        },
      );
      expect(foreignChat.statusCode).toBe(404);
      expect(foreignChat.body.error.code).toBe("WHATSAPP_CHAT_NOT_FOUND");

      const created = await context.put<WhatsappChatDto>(
        `/tracked-sources/${ids.chatA2}`,
        {
          status: "personal",
          sourceType: "customer_chat",
        },
      );
      expect(created.statusCode).toBe(200);
      expect(created.body.id).toBe(ids.chatA2);
      expect(created.body.sourceType).toBe("customer_chat");
      expect(created.body.tracking?.status).toBe("personal");

      const updated = await context.put<WhatsappChatDto>(
        `/tracked-sources/${ids.chatA2}`,
        {
          status: "ignored",
          sourceType: "internal_team",
        },
      );
      expect(updated.statusCode).toBe(200);
      expect(updated.body.tracking?.status).toBe("ignored");
      expect(updated.body.tracking?.sourceType).toBe("internal_team");

      const trackedSourceCounts = await context.db
        .select({ value: count() })
        .from(schema.trackedSources)
        .where(
          and(
            eq(schema.trackedSources.tenantId, ids.tenantA),
            eq(schema.trackedSources.chatId, ids.chatA2),
          ),
        );
      expect(trackedSourceCounts[0]?.value).toBe(1);

      const auditRows = await context.db
        .select()
        .from(schema.auditLogs)
        .where(
          and(
            eq(schema.auditLogs.tenantId, ids.tenantA),
            eq(schema.auditLogs.action, "tracked_source.updated"),
          ),
        );
      expect(auditRows).toHaveLength(2);
      expect(auditRows[0]?.actorUserId).toBe(ids.user);
    },
    apiTestTimeoutMs,
  );

  it(
    "keeps GET /whatsapp/messages tenant-scoped, filtered, and free of raw payloads",
    async () => {
      const context = await setupApiTest();
      await seedWhatsappGraph(context.db);

      const firstPage = await context.get<ListResponse<WhatsappMessageDto>>(
        "/whatsapp/messages?limit=2",
      );
      expect(firstPage.statusCode).toBe(200);
      expect(firstPage.body.items.map((message) => message.id)).toEqual([
        ids.messageA1,
        ids.messageA2,
      ]);
      expect(firstPage.body.items.map((message) => message.id)).not.toContain(
        ids.messageB1,
      );
      expect(firstPage.body.pageInfo.hasMore).toBe(true);
      expect("rawPayloadJson" in firstPage.body.items[0]!).toBe(false);
      expect(firstPage.body.items[0]?.chat?.displayName).toBe("Retail Group");
      expect(firstPage.body.items[0]?.sender?.phoneNumber).toBe("+963111111111");

      const nextCursor = firstPage.body.pageInfo.nextCursor;
      if (!nextCursor) {
        throw new Error("Expected messages nextCursor to be set.");
      }

      const secondPage = await context.get<ListResponse<WhatsappMessageDto>>(
        `/whatsapp/messages?limit=2&cursor=${encodeURIComponent(nextCursor)}`,
      );
      expect(secondPage.statusCode).toBe(200);
      expect(secondPage.body.items.map((message) => message.id)).toEqual([
        ids.messageA3,
      ]);

      const archivedImages = await context.get<ListResponse<WhatsappMessageDto>>(
        "/whatsapp/messages?messageType=image&isArchived=true",
      );
      expect(archivedImages.statusCode).toBe(200);
      expect(archivedImages.body.items.map((message) => message.id)).toEqual([
        ids.messageA2,
      ]);

      const searched = await context.get<ListResponse<WhatsappMessageDto>>(
        "/whatsapp/messages?search=shoes",
      );
      expect(searched.statusCode).toBe(200);
      expect(searched.body.items.map((message) => message.id)).toEqual([
        ids.messageA1,
      ]);
    },
    apiTestTimeoutMs,
  );

  it(
    "keeps GET /whatsapp/messages/:id tenant-scoped",
    async () => {
      const context = await setupApiTest();
      await seedWhatsappGraph(context.db);

      const ownMessage = await context.get<WhatsappMessageDto>(
        `/whatsapp/messages/${ids.messageA1}`,
      );
      expect(ownMessage.statusCode).toBe(200);
      expect(ownMessage.body.id).toBe(ids.messageA1);

      const foreignMessage = await context.get<ErrorResponse>(
        `/whatsapp/messages/${ids.messageB1}`,
      );
      expect(foreignMessage.statusCode).toBe(404);
      expect(foreignMessage.body.error.code).toBe("WHATSAPP_MESSAGE_NOT_FOUND");

      const tenantBOwnMessage = await context.get<WhatsappMessageDto>(
        `/whatsapp/messages/${ids.messageB1}`,
        ids.tenantB,
      );
      expect(tenantBOwnMessage.statusCode).toBe(200);
      expect(tenantBOwnMessage.body.id).toBe(ids.messageB1);
    },
    apiTestTimeoutMs,
  );
});

function uuid(value: number): string {
  return `00000000-0000-4000-8000-${value.toString(16).padStart(12, "0")}`;
}

function date(value: string): Date {
  return new Date(value);
}

async function setupApiTest(): Promise<ApiTestContext> {
  const client = new PGlite();
  await applyMigrations(client);

  const db = drizzle(client, { schema });
  const dbClient = await import("../src/db/client.ts");
  dbClient.setDatabaseForTesting(db as unknown as AppDatabase);

  await seedAuthenticatedUser(db);

  const { buildServer } = await import("../src/server.ts");
  const app = await buildServer();
  await app.ready();

  function headersFor(
    tenantId: string,
    options: { unsafe?: boolean } = {},
  ): Record<string, string> {
    const cookies = [`${sessionCookieName}=${sessionToken}`];
    const headers: Record<string, string> = {
      cookie: cookies.join("; "),
      "x-tenant-id": tenantId,
    };

    if (options.unsafe) {
      cookies.push(`${csrfCookieName}=${csrfToken}`);
      headers.cookie = cookies.join("; ");
      headers[csrfHeaderName] = csrfToken;
      headers["content-type"] = "application/json";
    }

    return headers;
  }

  async function get<TBody>(
    url: string,
    tenantId = ids.tenantA,
  ): Promise<InjectedJson<TBody>> {
    const response = await app.inject({
      method: "GET",
      url,
      headers: headersFor(tenantId),
    });

    return {
      statusCode: response.statusCode,
      body: response.json() as TBody,
    };
  }

  async function post<TBody>(
    url: string,
    payload: unknown,
    tenantId = ids.tenantA,
  ): Promise<InjectedJson<TBody>> {
    const response = await app.inject({
      method: "POST",
      url,
      headers: headersFor(tenantId, { unsafe: true }),
      payload: JSON.stringify(payload),
    });

    return {
      statusCode: response.statusCode,
      body: response.json() as TBody,
    };
  }

  async function put<TBody>(
    url: string,
    payload: unknown,
    tenantId = ids.tenantA,
  ): Promise<InjectedJson<TBody>> {
    const response = await app.inject({
      method: "PUT",
      url,
      headers: headersFor(tenantId, { unsafe: true }),
      payload: JSON.stringify(payload),
    });

    return {
      statusCode: response.statusCode,
      body: response.json() as TBody,
    };
  }

  currentContext = {
    app,
    client,
    db,
    get,
    post,
    put,
    setDatabaseForTesting: dbClient.setDatabaseForTesting,
  };

  return currentContext;
}

async function applyMigrations(client: PGlite): Promise<void> {
  const migrationDirectory = new URL("../drizzle/", import.meta.url);
  const migrationFiles = (await readdir(migrationDirectory))
    .filter((fileName) => fileName.endsWith(".sql"))
    .sort();

  for (const migrationFile of migrationFiles) {
    const migration = await readFile(
      new URL(migrationFile, migrationDirectory),
      "utf8",
    );
    const statements = migration
      .split("--> statement-breakpoint")
      .map((statement) => statement.trim())
      .filter(Boolean);

    for (const statement of statements) {
      await client.exec(statement);
    }
  }
}

async function seedAuthenticatedUser(db: TestDatabase): Promise<void> {
  await db.insert(schema.users).values({
    id: ids.user,
    email: "api-test@example.com",
    passwordHash: "unused",
    displayName: "API Test User",
    status: "active",
  });

  await db.insert(schema.tenants).values([
    {
      id: ids.tenantA,
      name: "Tenant A",
      slug: "tenant-a",
      status: "active",
    },
    {
      id: ids.tenantB,
      name: "Tenant B",
      slug: "tenant-b",
      status: "active",
    },
  ]);

  await db.insert(schema.tenantUsers).values([
    {
      id: ids.tenantUserA,
      tenantId: ids.tenantA,
      userId: ids.user,
      role: "owner",
      status: "active",
    },
    {
      id: ids.tenantUserB,
      tenantId: ids.tenantB,
      userId: ids.user,
      role: "owner",
      status: "active",
    },
  ]);

  await db.insert(schema.sessions).values({
    id: ids.session,
    userId: ids.user,
    tokenHash: hashSessionToken(sessionToken),
    expiresAt: date("2099-01-01T00:00:00.000Z"),
  });
}

async function seedWhatsappGraph(db: TestDatabase): Promise<void> {
  await db.insert(schema.whatsappAccounts).values([
    {
      id: ids.accountA1,
      tenantId: ids.tenantA,
      phoneNumber: "+963900000001",
      displayName: "Tenant A Primary",
      status: "connected",
      createdAt: date("2026-01-03T00:00:00.000Z"),
      updatedAt: date("2026-01-03T00:00:00.000Z"),
    },
    {
      id: ids.accountA2,
      tenantId: ids.tenantA,
      phoneNumber: "+963900000002",
      displayName: "Tenant A Backup",
      status: "disconnected",
      createdAt: date("2026-01-02T00:00:00.000Z"),
      updatedAt: date("2026-01-02T00:00:00.000Z"),
    },
    {
      id: ids.accountB1,
      tenantId: ids.tenantB,
      phoneNumber: "+963900000003",
      displayName: "Tenant B Primary",
      status: "connected",
      createdAt: date("2026-01-04T00:00:00.000Z"),
      updatedAt: date("2026-01-04T00:00:00.000Z"),
    },
  ]);

  await db.insert(schema.whatsappChats).values([
    {
      id: ids.chatA1,
      tenantId: ids.tenantA,
      whatsappAccountId: ids.accountA1,
      externalChatId: "retail-group@g.us",
      displayName: "Retail Group",
      sourceType: "merchant_group",
      createdAt: date("2026-01-04T00:00:00.000Z"),
      updatedAt: date("2026-01-04T00:00:00.000Z"),
    },
    {
      id: ids.chatA2,
      tenantId: ids.tenantA,
      whatsappAccountId: ids.accountA1,
      externalChatId: "customer-1@s.whatsapp.net",
      displayName: "Customer One",
      sourceType: "unknown",
      createdAt: date("2026-01-03T00:00:00.000Z"),
      updatedAt: date("2026-01-03T00:00:00.000Z"),
    },
    {
      id: ids.chatA3,
      tenantId: ids.tenantA,
      whatsappAccountId: ids.accountA2,
      externalChatId: "agent-group@g.us",
      displayName: "Agent Group",
      sourceType: "agent_group",
      createdAt: date("2026-01-02T00:00:00.000Z"),
      updatedAt: date("2026-01-02T00:00:00.000Z"),
    },
    {
      id: ids.chatB1,
      tenantId: ids.tenantB,
      whatsappAccountId: ids.accountB1,
      externalChatId: "tenant-b-group@g.us",
      displayName: "Tenant B Group",
      sourceType: "merchant_group",
      createdAt: date("2026-01-05T00:00:00.000Z"),
      updatedAt: date("2026-01-05T00:00:00.000Z"),
    },
  ]);

  await db.insert(schema.trackedSources).values({
    id: ids.trackedA1,
    tenantId: ids.tenantA,
    whatsappAccountId: ids.accountA1,
    chatId: ids.chatA1,
    status: "tracked",
    sourceType: "merchant_group",
    createdByUserId: ids.user,
    createdAt: date("2026-01-04T01:00:00.000Z"),
    updatedAt: date("2026-01-04T01:00:00.000Z"),
  });

  await db.insert(schema.whatsappContacts).values([
    {
      id: ids.contactA1,
      tenantId: ids.tenantA,
      whatsappAccountId: ids.accountA1,
      externalContactId: "963111111111@s.whatsapp.net",
      phoneNumber: "+963111111111",
      displayName: "Sender A",
    },
    {
      id: ids.contactB1,
      tenantId: ids.tenantB,
      whatsappAccountId: ids.accountB1,
      externalContactId: "963222222222@s.whatsapp.net",
      phoneNumber: "+963222222222",
      displayName: "Sender B",
    },
  ]);

  await db.insert(schema.whatsappMessages).values([
    {
      id: ids.messageA1,
      tenantId: ids.tenantA,
      whatsappAccountId: ids.accountA1,
      chatId: ids.chatA1,
      senderContactId: ids.contactA1,
      externalMessageId: "a-msg-1",
      messageType: "text",
      bodyText: "Red shoes price 100",
      rawPayloadJson: { test: true },
      isTracked: false,
      isLinked: false,
      isArchived: false,
      isPersonal: false,
      isTemporary: true,
      expiresAt: date("2026-01-05T00:00:00.000Z"),
      receivedAt: date("2026-01-04T10:00:00.000Z"),
      createdAt: date("2026-01-04T10:00:00.000Z"),
      updatedAt: date("2026-01-04T10:00:00.000Z"),
    },
    {
      id: ids.messageA2,
      tenantId: ids.tenantA,
      whatsappAccountId: ids.accountA1,
      chatId: ids.chatA1,
      senderContactId: ids.contactA1,
      externalMessageId: "a-msg-2",
      messageType: "image",
      bodyText: "Blue bag photo",
      rawPayloadJson: { test: true },
      isTracked: false,
      isLinked: false,
      isArchived: true,
      isPersonal: false,
      isTemporary: true,
      expiresAt: date("2026-01-05T00:01:00.000Z"),
      receivedAt: date("2026-01-04T09:00:00.000Z"),
      createdAt: date("2026-01-04T09:00:00.000Z"),
      updatedAt: date("2026-01-04T09:00:00.000Z"),
    },
    {
      id: ids.messageA3,
      tenantId: ids.tenantA,
      whatsappAccountId: ids.accountA2,
      chatId: ids.chatA3,
      senderContactId: null,
      externalMessageId: "a-msg-3",
      messageType: "text",
      bodyText: "Agent stock update",
      rawPayloadJson: { test: true },
      isTracked: true,
      isLinked: false,
      isArchived: false,
      isPersonal: false,
      isTemporary: false,
      expiresAt: date("2099-01-01T00:00:00.000Z"),
      receivedAt: date("2026-01-04T08:00:00.000Z"),
      createdAt: date("2026-01-04T08:00:00.000Z"),
      updatedAt: date("2026-01-04T08:00:00.000Z"),
    },
    {
      id: ids.messageB1,
      tenantId: ids.tenantB,
      whatsappAccountId: ids.accountB1,
      chatId: ids.chatB1,
      senderContactId: ids.contactB1,
      externalMessageId: "b-msg-1",
      messageType: "text",
      bodyText: "Tenant B private message",
      rawPayloadJson: { test: true },
      isTracked: false,
      isLinked: false,
      isArchived: false,
      isPersonal: false,
      isTemporary: true,
      expiresAt: date("2026-01-05T00:00:00.000Z"),
      receivedAt: date("2026-01-04T11:00:00.000Z"),
      createdAt: date("2026-01-04T11:00:00.000Z"),
      updatedAt: date("2026-01-04T11:00:00.000Z"),
    },
  ]);
}
