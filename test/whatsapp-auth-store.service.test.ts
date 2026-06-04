import { afterEach, describe, expect, it } from "bun:test";
import { readdir, readFile } from "node:fs/promises";

import { PGlite } from "@electric-sql/pglite";
import { and, count, eq } from "drizzle-orm";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";

import type { AppDatabase } from "../src/db/client.ts";
import * as schema from "../src/db/schema.ts";

process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = "silent";
process.env.ENCRYPTION_KEY = "test-encryption-key-with-32-characters";

const serviceTestTimeoutMs = 15_000;

const ids = {
  tenantA: uuid(1),
  tenantB: uuid(2),
  accountA: uuid(10),
  accountB: uuid(11),
} as const;

type TestDatabase = PgliteDatabase<typeof schema> & {
  $client: PGlite;
};

type AuthStoreModule = typeof import("../src/modules/whatsapp/whatsapp.auth-store.ts");

type ServiceTestContext = {
  client: PGlite;
  db: TestDatabase;
  authStore: AuthStoreModule;
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

describe("database-backed Baileys auth store", () => {
  it(
    "saves encrypted credentials and reloads them for the same tenant account",
    async () => {
      const context = await setupServiceTest();
      await seedTenantsAndAccounts(context.db);

      const firstAuth = await context.authStore.useDatabaseBaileysAuthState(
        ids.tenantA,
        ids.accountA,
      );
      const advSecretKey = firstAuth.state.creds.advSecretKey;
      await firstAuth.saveCreds();

      const authRows = await context.db
        .select()
        .from(schema.whatsappAuthStates)
        .where(
          and(
            eq(schema.whatsappAuthStates.tenantId, ids.tenantA),
            eq(schema.whatsappAuthStates.whatsappAccountId, ids.accountA),
            eq(schema.whatsappAuthStates.keyType, "creds"),
            eq(schema.whatsappAuthStates.keyId, "creds"),
          ),
        );
      expect(authRows).toHaveLength(1);
      expect(authRows[0]?.encryptedPayload).not.toContain(advSecretKey);

      const secondAuth = await context.authStore.useDatabaseBaileysAuthState(
        ids.tenantA,
        ids.accountA,
      );
      expect(secondAuth.state.creds.advSecretKey).toBe(advSecretKey);

      const tenantBAuth = await context.authStore.useDatabaseBaileysAuthState(
        ids.tenantB,
        ids.accountB,
      );
      expect(tenantBAuth.state.creds.advSecretKey).not.toBe(advSecretKey);
    },
    serviceTestTimeoutMs,
  );

  it(
    "round-trips and deletes encrypted signal keys",
    async () => {
      const context = await setupServiceTest();
      await seedTenantsAndAccounts(context.db);
      const auth = await context.authStore.useDatabaseBaileysAuthState(
        ids.tenantA,
        ids.accountA,
      );

      await auth.state.keys.set({
        "pre-key": {
          "1": {
            public: new Uint8Array([1, 2, 3]),
            private: new Uint8Array([4, 5, 6]),
          },
        },
        session: {
          "session-1": new Uint8Array([7, 8, 9]),
        },
      });

      const preKeys = await auth.state.keys.get("pre-key", ["1"]);
      const preKey = preKeys["1"];
      expect(preKey).toBeDefined();
      expect(Array.from(preKey!.public)).toEqual([1, 2, 3]);
      expect(Array.from(preKey!.private)).toEqual([4, 5, 6]);

      const sessions = await auth.state.keys.get("session", ["session-1"]);
      const session = sessions["session-1"];
      expect(session).toBeDefined();
      expect(Array.from(session!)).toEqual([7, 8, 9]);

      const authRows = await context.db
        .select()
        .from(schema.whatsappAuthStates)
        .where(eq(schema.whatsappAuthStates.whatsappAccountId, ids.accountA));
      expect(authRows.map((row) => row.encryptedPayload).join("\n")).not.toContain(
        "[1,2,3]",
      );

      await auth.state.keys.set({
        "pre-key": {
          "1": null,
        },
      });

      const deletedPreKeys = await auth.state.keys.get("pre-key", ["1"]);
      expect(deletedPreKeys["1"]).toBeUndefined();
    },
    serviceTestTimeoutMs,
  );

  it(
    "clears all auth rows for one tenant account only",
    async () => {
      const context = await setupServiceTest();
      await seedTenantsAndAccounts(context.db);

      const tenantAAuth = await context.authStore.useDatabaseBaileysAuthState(
        ids.tenantA,
        ids.accountA,
      );
      await tenantAAuth.saveCreds();

      const tenantBAuth = await context.authStore.useDatabaseBaileysAuthState(
        ids.tenantB,
        ids.accountB,
      );
      await tenantBAuth.saveCreds();

      await context.authStore.clearDatabaseBaileysAuthState(
        ids.tenantA,
        ids.accountA,
      );

      const tenantACount = await context.db
        .select({ value: count() })
        .from(schema.whatsappAuthStates)
        .where(
          and(
            eq(schema.whatsappAuthStates.tenantId, ids.tenantA),
            eq(schema.whatsappAuthStates.whatsappAccountId, ids.accountA),
          ),
        );
      expect(tenantACount[0]?.value).toBe(0);

      const tenantBCount = await context.db
        .select({ value: count() })
        .from(schema.whatsappAuthStates)
        .where(
          and(
            eq(schema.whatsappAuthStates.tenantId, ids.tenantB),
            eq(schema.whatsappAuthStates.whatsappAccountId, ids.accountB),
          ),
        );
      expect(tenantBCount[0]?.value).toBe(1);
    },
    serviceTestTimeoutMs,
  );
});

function uuid(value: number): string {
  return `00000000-0000-4000-8000-${value.toString(16).padStart(12, "0")}`;
}

async function setupServiceTest(): Promise<ServiceTestContext> {
  const client = new PGlite();
  await applyMigrations(client);

  const db = drizzle(client, { schema });
  const dbClient = await import("../src/db/client.ts");
  dbClient.setDatabaseForTesting(db as unknown as AppDatabase);

  const authStore = await import("../src/modules/whatsapp/whatsapp.auth-store.ts");

  currentContext = {
    client,
    db,
    authStore,
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
