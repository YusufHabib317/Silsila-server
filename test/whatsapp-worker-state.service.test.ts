import { afterEach, describe, expect, it } from "bun:test";
import { readdir, readFile } from "node:fs/promises";

import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";

import type { AppDatabase } from "../src/db/client.ts";
import * as schema from "../src/db/schema.ts";

process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = "silent";

const serviceTestTimeoutMs = 15_000;

const ids = {
  tenant: uuid(1),
  pendingAccount: uuid(10),
  qrReadyAccount: uuid(11),
  connectingAccount: uuid(12),
  connectedAccount: uuid(13),
  reconnectingAccount: uuid(14),
  disconnectedAccount: uuid(15),
  disabledAccount: uuid(16),
  expiredAccount: uuid(17),
  failedAccount: uuid(18),
  deletedAccount: uuid(19),
} as const;

type TestDatabase = PgliteDatabase<typeof schema> & {
  $client: PGlite;
};

type WorkerStateModule = typeof import("../src/modules/whatsapp/whatsapp.worker-state.ts");

type ServiceTestContext = {
  client: PGlite;
  db: TestDatabase;
  workerState: WorkerStateModule;
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

describe("WhatsApp worker state helpers", () => {
  it(
    "lists only accounts that should have worker sockets running",
    async () => {
      const context = await setupServiceTest();
      await seedWorkerAccounts(context.db);

      const runnableAccounts =
        await context.workerState.listRunnableWhatsappAccountsForWorker();

      const expectedAccountIds = [
        ids.connectedAccount,
        ids.connectingAccount,
        ids.pendingAccount,
        ids.qrReadyAccount,
        ids.reconnectingAccount,
      ].sort();

      expect(
        runnableAccounts.map((account) => account.whatsappAccountId).sort(),
      ).toEqual(expectedAccountIds);
    },
    serviceTestTimeoutMs,
  );

  it(
    "stores QR codes briefly without writing the QR value into audit metadata",
    async () => {
      const context = await setupServiceTest();
      await seedWorkerAccounts(context.db);

      const expiresAt = await context.workerState.setWhatsappAccountQrCode(
        ids.tenant,
        ids.pendingAccount,
        "qr-secret",
        date("2026-01-01T00:00:00.000Z"),
      );

      expect(expiresAt.toISOString()).toBe("2026-01-01T00:01:00.000Z");

      const accountRows = await context.db
        .select()
        .from(schema.whatsappAccounts)
        .where(eq(schema.whatsappAccounts.id, ids.pendingAccount));
      expect(accountRows[0]?.status).toBe("qr_ready");
      expect(accountRows[0]?.qrCode).toBe("qr-secret");
      expect(accountRows[0]?.qrExpiresAt?.toISOString()).toBe(
        "2026-01-01T00:01:00.000Z",
      );

      const auditRows = await context.db
        .select()
        .from(schema.auditLogs)
        .where(eq(schema.auditLogs.action, "whatsapp_account.qr_ready"));
      expect(auditRows).toHaveLength(1);
      expect(JSON.stringify(auditRows[0]?.metadata)).not.toContain("qr-secret");
      expect(auditRows[0]?.metadata).toEqual({
        qrExpiresAt: "2026-01-01T00:01:00.000Z",
      });
    },
    serviceTestTimeoutMs,
  );

  it(
    "clears stale QR data when connection status changes",
    async () => {
      const context = await setupServiceTest();
      await seedWorkerAccounts(context.db);

      await context.workerState.setWhatsappAccountQrCode(
        ids.tenant,
        ids.pendingAccount,
        "qr-secret",
        date("2026-01-01T00:00:00.000Z"),
      );
      await context.workerState.updateWhatsappAccountConnectionStatus(
        ids.tenant,
        ids.pendingAccount,
        "connected",
        {
          isNewLogin: true,
        },
      );

      const accountRows = await context.db
        .select()
        .from(schema.whatsappAccounts)
        .where(eq(schema.whatsappAccounts.id, ids.pendingAccount));
      expect(accountRows[0]?.status).toBe("connected");
      expect(accountRows[0]?.qrCode).toBeNull();
      expect(accountRows[0]?.qrExpiresAt).toBeNull();
      expect(accountRows[0]?.lastConnectedAt).toBeInstanceOf(Date);
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

  const workerState = await import(
    "../src/modules/whatsapp/whatsapp.worker-state.ts"
  );

  currentContext = {
    client,
    db,
    workerState,
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

async function seedWorkerAccounts(db: TestDatabase): Promise<void> {
  await db.insert(schema.tenants).values({
    id: ids.tenant,
    name: "Tenant",
    slug: "tenant",
    status: "active",
  });

  await db.insert(schema.whatsappAccounts).values([
    {
      id: ids.pendingAccount,
      tenantId: ids.tenant,
      status: "pending_qr",
    },
    {
      id: ids.qrReadyAccount,
      tenantId: ids.tenant,
      status: "qr_ready",
    },
    {
      id: ids.connectingAccount,
      tenantId: ids.tenant,
      status: "connecting",
    },
    {
      id: ids.connectedAccount,
      tenantId: ids.tenant,
      status: "connected",
    },
    {
      id: ids.reconnectingAccount,
      tenantId: ids.tenant,
      status: "reconnecting",
    },
    {
      id: ids.disconnectedAccount,
      tenantId: ids.tenant,
      status: "disconnected",
    },
    {
      id: ids.disabledAccount,
      tenantId: ids.tenant,
      status: "disabled",
    },
    {
      id: ids.expiredAccount,
      tenantId: ids.tenant,
      status: "expired",
    },
    {
      id: ids.failedAccount,
      tenantId: ids.tenant,
      status: "failed",
    },
    {
      id: ids.deletedAccount,
      tenantId: ids.tenant,
      status: "pending_qr",
      deletedAt: date("2026-01-01T00:00:00.000Z"),
    },
  ]);
}
