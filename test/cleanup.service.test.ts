import { afterEach, describe, expect, it } from "bun:test";
import { readdir, readFile } from "node:fs/promises";

import { PGlite } from "@electric-sql/pglite";
import { and, count, eq } from "drizzle-orm";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";

import type { AppDatabase } from "../src/db/client.ts";
import * as schema from "../src/db/schema.ts";
import type {
  ExpiredWhatsappCleanupResult,
  TemporaryMediaObjectForCleanup,
} from "../src/modules/cleanup/cleanup.service.ts";

process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = "silent";

const cleanupTestTimeoutMs = 15_000;

const ids = {
  tenant: uuid(1),
  account: uuid(10),
  chat: uuid(20),
  expiredMessage: uuid(30),
  freshMessage: uuid(31),
  trackedMessage: uuid(32),
  linkedMessage: uuid(33),
  durableMessage: uuid(34),
  expiredMedia: uuid(40),
  freshMedia: uuid(41),
} as const;

type TestDatabase = PgliteDatabase<typeof schema> & {
  $client: PGlite;
};

type CleanupExpiredWhatsappMessages = typeof import("../src/modules/cleanup/cleanup.service.ts")["cleanupExpiredWhatsappMessages"];

type CleanupTestContext = {
  client: PGlite;
  db: TestDatabase;
  cleanupExpiredWhatsappMessages: (
    options?: Parameters<CleanupExpiredWhatsappMessages>[0],
  ) => Promise<ExpiredWhatsappCleanupResult>;
  setDatabaseForTesting: (database: AppDatabase | null) => void;
};

let currentContext: CleanupTestContext | null = null;

afterEach(async () => {
  if (!currentContext) {
    return;
  }

  currentContext.setDatabaseForTesting(null);
  await currentContext.client.close();
  currentContext = null;
});

describe("expired WhatsApp cleanup", () => {
  it(
    "anonymizes only expired temporary untracked and unlinked messages",
    async () => {
      const context = await setupCleanupTest();
      await seedCleanupGraph(context.db);
      const deletedMediaObjects: TemporaryMediaObjectForCleanup[] = [];

      const result = await context.cleanupExpiredWhatsappMessages({
        now: date("2026-01-02T00:00:00.000Z"),
        deleteMediaObject: async (mediaObject) => {
          deletedMediaObjects.push(mediaObject);
        },
      });

      expect(result).toEqual({
        checkedAt: "2026-01-02T00:00:00.000Z",
        cleanedMessageCount: 1,
        cleanedMediaObjectCount: 1,
        auditLogCount: 1,
      });
      expect(deletedMediaObjects.map((mediaObject) => mediaObject.objectKey)).toEqual([
        "tmp/untracked/tenant/message/expired.jpg",
      ]);

      const messageRows = await context.db
        .select()
        .from(schema.whatsappMessages);
      const rowsById = new Map(messageRows.map((message) => [message.id, message]));

      const expiredMessage = rowsById.get(ids.expiredMessage);
      expect(expiredMessage?.deletedAt?.toISOString()).toBe(
        "2026-01-02T00:00:00.000Z",
      );
      expect(expiredMessage?.bodyText).toBeNull();
      expect(expiredMessage?.rawPayloadJson).toEqual({
        cleaned: true,
        reason: "expired_temporary_message",
        cleanedAt: "2026-01-02T00:00:00.000Z",
      });

      expect(rowsById.get(ids.freshMessage)?.deletedAt).toBeNull();
      expect(rowsById.get(ids.trackedMessage)?.deletedAt).toBeNull();
      expect(rowsById.get(ids.linkedMessage)?.deletedAt).toBeNull();
      expect(rowsById.get(ids.durableMessage)?.deletedAt).toBeNull();

      const mediaRows = await context.db.select().from(schema.mediaObjects);
      const mediaById = new Map(mediaRows.map((mediaObject) => [mediaObject.id, mediaObject]));
      expect(mediaById.get(ids.expiredMedia)?.deletedAt?.toISOString()).toBe(
        "2026-01-02T00:00:00.000Z",
      );
      expect(mediaById.get(ids.freshMedia)?.deletedAt).toBeNull();

      const auditRows = await context.db
        .select()
        .from(schema.auditLogs)
        .where(eq(schema.auditLogs.action, "cleanup.expired_whatsapp_messages"));
      expect(auditRows).toHaveLength(1);
      expect(auditRows[0]?.tenantId).toBe(ids.tenant);
      expect(auditRows[0]?.metadata).toEqual({
        messageCount: 1,
        mediaObjectCount: 1,
        cleanedAt: "2026-01-02T00:00:00.000Z",
      });
    },
    cleanupTestTimeoutMs,
  );

  it(
    "is idempotent across repeated runs",
    async () => {
      const context = await setupCleanupTest();
      await seedCleanupGraph(context.db);
      const now = date("2026-01-02T00:00:00.000Z");

      const firstRun = await context.cleanupExpiredWhatsappMessages({ now });
      const secondRun = await context.cleanupExpiredWhatsappMessages({ now });

      expect(firstRun.cleanedMessageCount).toBe(1);
      expect(secondRun).toEqual({
        checkedAt: "2026-01-02T00:00:00.000Z",
        cleanedMessageCount: 0,
        cleanedMediaObjectCount: 0,
        auditLogCount: 0,
      });

      const auditLogCounts = await context.db
        .select({ value: count() })
        .from(schema.auditLogs)
        .where(
          and(
            eq(schema.auditLogs.tenantId, ids.tenant),
            eq(schema.auditLogs.action, "cleanup.expired_whatsapp_messages"),
          ),
        );
      expect(auditLogCounts[0]?.value).toBe(1);
    },
    cleanupTestTimeoutMs,
  );
});

function uuid(value: number): string {
  return `00000000-0000-4000-8000-${value.toString(16).padStart(12, "0")}`;
}

function date(value: string): Date {
  return new Date(value);
}

async function setupCleanupTest(): Promise<CleanupTestContext> {
  const client = new PGlite();
  await applyMigrations(client);

  const db = drizzle(client, { schema });
  const dbClient = await import("../src/db/client.ts");
  dbClient.setDatabaseForTesting(db as unknown as AppDatabase);

  const { cleanupExpiredWhatsappMessages } = await import(
    "../src/modules/cleanup/cleanup.service.ts"
  );

  currentContext = {
    client,
    db,
    cleanupExpiredWhatsappMessages,
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

async function seedCleanupGraph(db: TestDatabase): Promise<void> {
  await db.insert(schema.tenants).values({
    id: ids.tenant,
    name: "Tenant",
    slug: "tenant",
    status: "active",
  });

  await db.insert(schema.whatsappAccounts).values({
    id: ids.account,
    tenantId: ids.tenant,
    phoneNumber: "+963900000001",
    displayName: "Tenant Primary",
    status: "connected",
  });

  await db.insert(schema.whatsappChats).values({
    id: ids.chat,
    tenantId: ids.tenant,
    whatsappAccountId: ids.account,
    externalChatId: "retail-group@g.us",
    displayName: "Retail Group",
    sourceType: "merchant_group",
  });

  await db.insert(schema.whatsappMessages).values([
    {
      id: ids.expiredMessage,
      tenantId: ids.tenant,
      whatsappAccountId: ids.account,
      chatId: ids.chat,
      externalMessageId: "expired-message",
      messageType: "image",
      bodyText: "Expired image caption",
      rawPayloadJson: {
        sensitive: true,
      },
      isTracked: false,
      isLinked: false,
      isTemporary: true,
      expiresAt: date("2026-01-01T23:59:59.000Z"),
      receivedAt: date("2026-01-01T00:00:00.000Z"),
    },
    {
      id: ids.freshMessage,
      tenantId: ids.tenant,
      whatsappAccountId: ids.account,
      chatId: ids.chat,
      externalMessageId: "fresh-message",
      messageType: "text",
      bodyText: "Fresh message",
      rawPayloadJson: {
        fresh: true,
      },
      isTracked: false,
      isLinked: false,
      isTemporary: true,
      expiresAt: date("2026-01-02T00:00:01.000Z"),
      receivedAt: date("2026-01-01T00:00:00.000Z"),
    },
    {
      id: ids.trackedMessage,
      tenantId: ids.tenant,
      whatsappAccountId: ids.account,
      chatId: ids.chat,
      externalMessageId: "tracked-message",
      messageType: "text",
      bodyText: "Tracked message",
      rawPayloadJson: {
        tracked: true,
      },
      isTracked: true,
      isLinked: false,
      isTemporary: true,
      expiresAt: date("2026-01-01T23:00:00.000Z"),
      receivedAt: date("2026-01-01T00:00:00.000Z"),
    },
    {
      id: ids.linkedMessage,
      tenantId: ids.tenant,
      whatsappAccountId: ids.account,
      chatId: ids.chat,
      externalMessageId: "linked-message",
      messageType: "text",
      bodyText: "Linked message",
      rawPayloadJson: {
        linked: true,
      },
      isTracked: false,
      isLinked: true,
      isTemporary: true,
      expiresAt: date("2026-01-01T23:00:00.000Z"),
      receivedAt: date("2026-01-01T00:00:00.000Z"),
    },
    {
      id: ids.durableMessage,
      tenantId: ids.tenant,
      whatsappAccountId: ids.account,
      chatId: ids.chat,
      externalMessageId: "durable-message",
      messageType: "text",
      bodyText: "Durable message",
      rawPayloadJson: {
        durable: true,
      },
      isTracked: false,
      isLinked: false,
      isTemporary: false,
      expiresAt: date("2026-01-01T23:00:00.000Z"),
      receivedAt: date("2026-01-01T00:00:00.000Z"),
    },
  ]);

  await db.insert(schema.mediaObjects).values([
    {
      id: ids.expiredMedia,
      tenantId: ids.tenant,
      whatsappMessageId: ids.expiredMessage,
      ownerType: "whatsapp_message",
      ownerId: ids.expiredMessage,
      bucket: "tenant-media",
      objectKey: "tmp/untracked/tenant/message/expired.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 1234,
      storageClass: "temporary",
      isTemporary: true,
      expiresAt: date("2026-01-01T23:59:59.000Z"),
    },
    {
      id: ids.freshMedia,
      tenantId: ids.tenant,
      whatsappMessageId: ids.freshMessage,
      ownerType: "whatsapp_message",
      ownerId: ids.freshMessage,
      bucket: "tenant-media",
      objectKey: "tmp/untracked/tenant/message/fresh.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 5678,
      storageClass: "temporary",
      isTemporary: true,
      expiresAt: date("2026-01-02T00:00:01.000Z"),
    },
  ]);
}
