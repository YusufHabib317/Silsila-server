import { afterEach, describe, expect, it } from "bun:test";
import { readdir, readFile } from "node:fs/promises";

import { PGlite } from "@electric-sql/pglite";
import { and, count, eq } from "drizzle-orm";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";

import type { AppDatabase } from "../src/db/client.ts";
import * as schema from "../src/db/schema.ts";

process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = "silent";

const serviceTestTimeoutMs = 15_000;

const ids = {
  tenantA: uuid(1),
  tenantB: uuid(2),
  accountA: uuid(10),
  accountB: uuid(11),
  chatIgnored: uuid(20),
  trackedIgnored: uuid(30),
} as const;

type TestDatabase = PgliteDatabase<typeof schema> & {
  $client: PGlite;
};

type IngestWhatsappMessage = typeof import("../src/modules/whatsapp/whatsapp.ingestion.ts")["ingestWhatsappMessage"];

type ServiceTestContext = {
  client: PGlite;
  db: TestDatabase;
  ingestWhatsappMessage: IngestWhatsappMessage;
  setDatabaseForTesting: (database: AppDatabase | null) => void;
};

let currentContext: ServiceTestContext | null = null;

afterEach(async () => {
  if (!currentContext) {
    return;
  }

  currentContext.setDatabaseForTesting(null);
  await currentContext.client.close();
  currentContext = null;
});

describe("WhatsApp message ingestion", () => {
  it(
    "stores normalized incoming messages with temporary retention",
    async () => {
      const context = await setupServiceTest();
      const ingestedAt = date("2026-01-01T00:00:00.000Z");

      const result = await context.ingestWhatsappMessage(ids.tenantA, {
        whatsappAccountId: ids.accountA,
        externalMessageId: "a-msg-1",
        chat: {
          externalChatId: "retail-group@g.us",
          displayName: "Retail Group",
          sourceType: "merchant_group",
        },
        sender: {
          externalContactId: "963111111111@s.whatsapp.net",
          phoneNumber: "+963111111111",
          displayName: "Sender A",
        },
        messageType: "text",
        bodyText: "Red shoes price 100",
        rawPayloadJson: {
          storedForAuditOnly: true,
        },
        isFromMe: false,
        receivedAt: date("2026-01-01T00:00:10.000Z"),
        ingestedAt,
      });

      expect(result.wasCreated).toBe(true);
      expect(result.tenantId).toBe(ids.tenantA);
      expect(result.whatsappAccountId).toBe(ids.accountA);
      expect(result.expiresAt.toISOString()).toBe(
        "2026-01-02T00:00:00.000Z",
      );

      const chatRows = await context.db
        .select()
        .from(schema.whatsappChats)
        .where(eq(schema.whatsappChats.id, result.chatId));
      expect(chatRows[0]?.tenantId).toBe(ids.tenantA);
      expect(chatRows[0]?.externalChatId).toBe("retail-group@g.us");
      expect(chatRows[0]?.sourceType).toBe("merchant_group");

      const contactRows = await context.db
        .select()
        .from(schema.whatsappContacts)
        .where(eq(schema.whatsappContacts.id, result.senderContactId!));
      expect(contactRows[0]?.phoneNumber).toBe("+963111111111");

      const messageRows = await context.db
        .select()
        .from(schema.whatsappMessages)
        .where(eq(schema.whatsappMessages.id, result.messageId));
      expect(messageRows[0]?.tenantId).toBe(ids.tenantA);
      expect(messageRows[0]?.chatId).toBe(result.chatId);
      expect(messageRows[0]?.senderContactId).toBe(result.senderContactId);
      expect(messageRows[0]?.bodyText).toBe("Red shoes price 100");
      expect(messageRows[0]?.rawPayloadJson).toEqual({
        storedForAuditOnly: true,
      });
      expect(messageRows[0]?.isTracked).toBe(false);
      expect(messageRows[0]?.isLinked).toBe(false);
      expect(messageRows[0]?.isTemporary).toBe(true);
      expect(messageRows[0]?.expiresAt.toISOString()).toBe(
        "2026-01-02T00:00:00.000Z",
      );
    },
    serviceTestTimeoutMs,
  );

  it(
    "is idempotent by tenant, account, and external message id",
    async () => {
      const context = await setupServiceTest();

      const first = await context.ingestWhatsappMessage(ids.tenantA, {
        whatsappAccountId: ids.accountA,
        externalMessageId: "duplicate-msg",
        chat: {
          externalChatId: "customer-1@s.whatsapp.net",
          displayName: "Customer One",
        },
        messageType: "text",
        bodyText: "First copy wins",
        rawPayloadJson: {
          delivery: 1,
        },
        receivedAt: date("2026-01-01T01:00:00.000Z"),
        ingestedAt: date("2026-01-01T01:00:00.000Z"),
      });

      const second = await context.ingestWhatsappMessage(ids.tenantA, {
        whatsappAccountId: ids.accountA,
        externalMessageId: "duplicate-msg",
        chat: {
          externalChatId: "customer-1@s.whatsapp.net",
          displayName: "Customer One Updated",
        },
        messageType: "text",
        bodyText: "Duplicate should not rewrite message content",
        rawPayloadJson: {
          delivery: 2,
        },
        receivedAt: date("2026-01-01T01:01:00.000Z"),
        ingestedAt: date("2026-01-01T01:01:00.000Z"),
      });

      expect(first.wasCreated).toBe(true);
      expect(second.wasCreated).toBe(false);
      expect(second.messageId).toBe(first.messageId);

      const messageCounts = await context.db
        .select({ value: count() })
        .from(schema.whatsappMessages)
        .where(
          and(
            eq(schema.whatsappMessages.tenantId, ids.tenantA),
            eq(schema.whatsappMessages.whatsappAccountId, ids.accountA),
            eq(schema.whatsappMessages.externalMessageId, "duplicate-msg"),
          ),
        );
      expect(messageCounts[0]?.value).toBe(1);

      const messageRows = await context.db
        .select()
        .from(schema.whatsappMessages)
        .where(eq(schema.whatsappMessages.id, first.messageId));
      expect(messageRows[0]?.bodyText).toBe("First copy wins");
      expect(messageRows[0]?.expiresAt.toISOString()).toBe(
        "2026-01-02T01:00:00.000Z",
      );
    },
    serviceTestTimeoutMs,
  );

  it(
    "rejects accounts outside the current tenant",
    async () => {
      const context = await setupServiceTest();

      try {
        await context.ingestWhatsappMessage(ids.tenantA, {
          whatsappAccountId: ids.accountB,
          externalMessageId: "foreign-account-msg",
          chat: {
            externalChatId: "tenant-b-chat@g.us",
          },
          messageType: "text",
          bodyText: "Tenant B message",
          rawPayloadJson: {
            foreign: true,
          },
          receivedAt: date("2026-01-01T02:00:00.000Z"),
          ingestedAt: date("2026-01-01T02:00:00.000Z"),
        });
        throw new Error("Expected ingestion to reject a foreign account.");
      } catch (error) {
        expect((error as { code?: string }).code).toBe(
          "WHATSAPP_ACCOUNT_NOT_FOUND",
        );
      }

      const messageCounts = await context.db
        .select({ value: count() })
        .from(schema.whatsappMessages);
      expect(messageCounts[0]?.value).toBe(0);
    },
    serviceTestTimeoutMs,
  );

  it(
    "preserves source settings and keeps ignored-source messages temporary",
    async () => {
      const context = await setupServiceTest();

      await context.db.insert(schema.whatsappChats).values({
        id: ids.chatIgnored,
        tenantId: ids.tenantA,
        whatsappAccountId: ids.accountA,
        externalChatId: "ignored-team@g.us",
        displayName: "Ignored Team",
        sourceType: "internal_team",
      });

      await context.db.insert(schema.trackedSources).values({
        id: ids.trackedIgnored,
        tenantId: ids.tenantA,
        whatsappAccountId: ids.accountA,
        chatId: ids.chatIgnored,
        status: "ignored",
        sourceType: "internal_team",
      });

      const result = await context.ingestWhatsappMessage(ids.tenantA, {
        whatsappAccountId: ids.accountA,
        externalMessageId: "ignored-msg",
        chat: {
          externalChatId: "ignored-team@g.us",
          displayName: "Ignored Team Updated",
          sourceType: "merchant_group",
        },
        messageType: "text",
        bodyText: "This should stay out of review by default",
        rawPayloadJson: {
          ignored: true,
        },
        receivedAt: date("2026-01-01T03:00:00.000Z"),
        ingestedAt: date("2026-01-01T03:00:00.000Z"),
      });

      const chatRows = await context.db
        .select()
        .from(schema.whatsappChats)
        .where(eq(schema.whatsappChats.id, ids.chatIgnored));
      expect(chatRows[0]?.displayName).toBe("Ignored Team Updated");
      expect(chatRows[0]?.sourceType).toBe("internal_team");

      const messageRows = await context.db
        .select()
        .from(schema.whatsappMessages)
        .where(eq(schema.whatsappMessages.id, result.messageId));
      expect(messageRows[0]?.isArchived).toBe(true);
      expect(messageRows[0]?.isPersonal).toBe(false);
      expect(messageRows[0]?.isTracked).toBe(false);
      expect(messageRows[0]?.isTemporary).toBe(true);
      expect(messageRows[0]?.expiresAt.toISOString()).toBe(
        "2026-01-02T03:00:00.000Z",
      );
    },
    serviceTestTimeoutMs,
  );
});

function uuid(value: number): string {
  return `00000000-0000-4000-8000-${value.toString(16).padStart(12, "0")}`;
}

function date(value: string): Date {
  return new Date(value);
}

async function setupServiceTest(): Promise<ServiceTestContext> {
  const client = new PGlite();
  await applyMigrations(client);

  const db = drizzle(client, { schema });
  const dbClient = await import("../src/db/client.ts");
  dbClient.setDatabaseForTesting(db as unknown as AppDatabase);

  await seedTenantsAndAccounts(db);

  const { ingestWhatsappMessage } = await import(
    "../src/modules/whatsapp/whatsapp.ingestion.ts"
  );

  currentContext = {
    client,
    db,
    ingestWhatsappMessage,
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

async function seedTenantsAndAccounts(db: TestDatabase): Promise<void> {
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

  await db.insert(schema.whatsappAccounts).values([
    {
      id: ids.accountA,
      tenantId: ids.tenantA,
      phoneNumber: "+963900000001",
      displayName: "Tenant A Primary",
      status: "connected",
    },
    {
      id: ids.accountB,
      tenantId: ids.tenantB,
      phoneNumber: "+963900000002",
      displayName: "Tenant B Primary",
      status: "connected",
    },
  ]);
}
