import { afterEach, describe, expect, it } from "bun:test";
import { readdir, readFile } from "node:fs/promises";

import { PGlite } from "@electric-sql/pglite";
import { and, count, eq, isNotNull } from "drizzle-orm";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import type { FastifyInstance } from "fastify";

import type { AppDatabase } from "../src/db/client.ts";
import * as schema from "../src/db/schema.ts";
import {
  hashPassword,
  hashSessionToken,
} from "../src/modules/auth/passwords.ts";

process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = "silent";

const sessionCookieName = "wa_commerce_session";
const csrfCookieName = "wa_commerce_csrf";
const csrfHeaderName = "x-csrf-token";
const sessionToken = "test-session-token";
const csrfToken = "test-csrf-token";
const loginPassword = "correct horse battery staple";
const apiTestTimeoutMs = 15_000;

const ids = {
  user: uuid(1),
  tenantA: uuid(2),
  tenantB: uuid(3),
  tenantC: uuid(4),
  session: uuid(5),
  tenantUserA: uuid(6),
  tenantUserB: uuid(7),
  contactA: uuid(10),
  contactB: uuid(11),
  whatsappAccountA: uuid(12),
  whatsappContactA: uuid(13),
} as const;

type TestDatabase = PgliteDatabase<typeof schema> & {
  $client: PGlite;
};

type ApiTestContext = {
  app: FastifyInstance;
  client: PGlite;
  db: TestDatabase;
  csrfHeaders: () => Record<string, string>;
  sessionHeaders: (
    tenantId?: string,
    options?: { unsafe?: boolean; sessionToken?: string },
  ) => Record<string, string>;
  setDatabaseForTesting: (database: AppDatabase | null) => void;
};

type ErrorResponse = {
  error: {
    code: string;
    message: string;
    requestId: string;
    details?: unknown;
  };
};

type AuthResponse = {
  user: {
    id: string;
    email: string;
    displayName: string;
  };
  tenants: Array<{
    id: string;
    name: string;
    slug: string;
    role: string;
  }>;
  isPlatformAdmin: boolean;
  sessionExpiresAt: string;
  csrfToken: string;
};

type MeResponse = {
  user: {
    id: string;
    email: string;
    displayName: string;
  };
  tenants: Array<{
    id: string;
    name: string;
    slug: string;
    role: string;
  }>;
  isPlatformAdmin: boolean;
};

type ContactListResponse = {
  items: Array<{
    id: string;
    displayName: string;
  }>;
};

type ContactResponse = {
  id: string;
  displayName: string;
  phoneNumber: string | null;
  whatsappIdentities: Array<{
    whatsappContactId: string;
    externalContactId: string;
  }>;
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

describe("auth API", () => {
  it(
    "registers a tenant owner through the injected database and starts a session",
    async () => {
      const context = await setupApiTest();

      const response = await context.app.inject({
        method: "POST",
        url: "/auth/register",
        headers: context.csrfHeaders(),
        payload: {
          email: "Owner@Example.com",
          password: "super secure password",
          displayName: "Tenant Owner",
          tenantName: "Owner Shop",
        },
      });

      expect(response.statusCode).toBe(201);
      const body = response.json() as AuthResponse;
      expect(body.user.email).toBe("owner@example.com");
      expect(body.tenants).toHaveLength(1);
      expect(body.tenants[0]?.role).toBe("owner");
      expect(typeof body.csrfToken).toBe("string");

      const sessionCookie = extractSetCookieValue(response, sessionCookieName);
      expect(sessionCookie).not.toBeNull();

      const [userCountRows, tenantCountRows, tenantUserCountRows, auditRows] =
        await Promise.all([
          context.db.select({ value: count() }).from(schema.users),
          context.db.select({ value: count() }).from(schema.tenants),
          context.db.select({ value: count() }).from(schema.tenantUsers),
          context.db
            .select()
            .from(schema.auditLogs)
            .where(eq(schema.auditLogs.action, "auth.registered")),
        ]);

      expect(userCountRows[0]?.value).toBe(1);
      expect(tenantCountRows[0]?.value).toBe(1);
      expect(tenantUserCountRows[0]?.value).toBe(1);
      expect(auditRows[0]?.tenantId).toBe(body.tenants[0]?.id);
      expect(auditRows[0]?.actorUserId).toBe(body.user.id);

      const duplicate = await context.app.inject({
        method: "POST",
        url: "/auth/register",
        headers: context.csrfHeaders(),
        payload: {
          email: "owner@example.com",
          password: "super secure password",
          displayName: "Tenant Owner",
          tenantName: "Duplicate Shop",
        },
      });
      expect(duplicate.statusCode).toBe(409);
      expect((duplicate.json() as ErrorResponse).error.code).toBe(
        "EMAIL_ALREADY_REGISTERED",
      );
    },
    apiTestTimeoutMs,
  );

  it(
    "logs in, exposes /me, logs out, and rejects revoked sessions",
    async () => {
      const context = await setupApiTest();
      await seedAuthenticatedUser(context.db);

      const invalid = await context.app.inject({
        method: "POST",
        url: "/auth/login",
        headers: context.csrfHeaders(),
        payload: {
          email: "api-test@example.com",
          password: "wrong password",
        },
      });
      expect(invalid.statusCode).toBe(401);
      expect((invalid.json() as ErrorResponse).error.code).toBe(
        "INVALID_CREDENTIALS",
      );

      const login = await context.app.inject({
        method: "POST",
        url: "/auth/login",
        headers: context.csrfHeaders(),
        payload: {
          email: "api-test@example.com",
          password: loginPassword,
        },
      });
      expect(login.statusCode).toBe(200);
      const loginBody = login.json() as AuthResponse;
      expect(loginBody.tenants.map((tenant) => tenant.id).sort()).toEqual([
        ids.tenantA,
        ids.tenantB,
      ]);

      const loginSessionCookie = extractSetCookieValue(login, sessionCookieName);
      if (!loginSessionCookie) {
        throw new Error("Expected login response to set a session cookie.");
      }

      const me = await context.app.inject({
        method: "GET",
        url: "/me",
        headers: {
          cookie: `${sessionCookieName}=${loginSessionCookie}`,
        },
      });
      expect(me.statusCode).toBe(200);
      expect((me.json() as MeResponse).user.email).toBe("api-test@example.com");

      const logout = await context.app.inject({
        method: "POST",
        url: "/auth/logout",
        headers: context.sessionHeaders(undefined, {
          unsafe: true,
          sessionToken: loginSessionCookie,
        }),
      });
      expect(logout.statusCode).toBe(204);

      const revokedSessionRows = await context.db
        .select({ id: schema.sessions.id })
        .from(schema.sessions)
        .where(
          and(
            eq(schema.sessions.tokenHash, hashSessionToken(loginSessionCookie)),
            isNotNull(schema.sessions.revokedAt),
          ),
        );
      expect(revokedSessionRows).toHaveLength(1);

      const meAfterLogout = await context.app.inject({
        method: "GET",
        url: "/me",
        headers: {
          cookie: `${sessionCookieName}=${loginSessionCookie}`,
        },
      });
      expect(meAfterLogout.statusCode).toBe(401);
      expect((meAfterLogout.json() as ErrorResponse).error.code).toBe(
        "AUTHENTICATION_REQUIRED",
      );
    },
    apiTestTimeoutMs,
  );

  it(
    "requires csrf tokens for unsafe requests",
    async () => {
      const context = await setupApiTest();
      await seedAuthenticatedUser(context.db);

      const csrf = await context.app.inject({
        method: "GET",
        url: "/auth/csrf",
      });
      expect(csrf.statusCode).toBe(200);
      expect(typeof (csrf.json() as { csrfToken: string }).csrfToken).toBe(
        "string",
      );
      expect(extractSetCookieValue(csrf, csrfCookieName)).not.toBeNull();

      const missingCsrf = await context.app.inject({
        method: "POST",
        url: "/auth/login",
        payload: {
          email: "api-test@example.com",
          password: loginPassword,
        },
      });
      expect(missingCsrf.statusCode).toBe(403);
      expect((missingCsrf.json() as ErrorResponse).error.code).toBe(
        "CSRF_TOKEN_INVALID",
      );

      const validCsrf = await context.app.inject({
        method: "POST",
        url: "/auth/login",
        headers: context.csrfHeaders(),
        payload: {
          email: "api-test@example.com",
          password: loginPassword,
        },
      });
      expect(validCsrf.statusCode).toBe(200);
    },
    apiTestTimeoutMs,
  );

  it(
    "requires explicit tenant selection for multi-tenant users",
    async () => {
      const context = await setupApiTest();
      await seedAuthenticatedUser(context.db);
      await seedContacts(context.db);

      const missingTenant = await context.app.inject({
        method: "GET",
        url: "/contacts",
        headers: context.sessionHeaders(),
      });
      expect(missingTenant.statusCode).toBe(400);
      expect((missingTenant.json() as ErrorResponse).error.code).toBe(
        "TENANT_REQUIRED",
      );

      const tenantAContacts = await context.app.inject({
        method: "GET",
        url: "/contacts",
        headers: context.sessionHeaders(ids.tenantA),
      });
      expect(tenantAContacts.statusCode).toBe(200);
      expect(
        (tenantAContacts.json() as ContactListResponse).items.map(
          (contact) => contact.displayName,
        ),
      ).toEqual(["Tenant A Contact"]);

      const tenantBContacts = await context.app.inject({
        method: "GET",
        url: "/contacts",
        headers: context.sessionHeaders(ids.tenantB),
      });
      expect(tenantBContacts.statusCode).toBe(200);
      expect(
        (tenantBContacts.json() as ContactListResponse).items.map(
          (contact) => contact.displayName,
        ),
      ).toEqual(["Tenant B Contact"]);

      const foreignTenant = await context.app.inject({
        method: "GET",
        url: "/contacts",
        headers: context.sessionHeaders(ids.tenantC),
      });
      expect(foreignTenant.statusCode).toBe(403);
      expect((foreignTenant.json() as ErrorResponse).error.code).toBe(
        "TENANT_ACCESS_DENIED",
      );
    },
    apiTestTimeoutMs,
  );

  it(
    "links created contacts to existing WhatsApp sender identities",
    async () => {
      const context = await setupApiTest();
      await seedAuthenticatedUser(context.db);

      await context.db.insert(schema.whatsappAccounts).values({
        id: ids.whatsappAccountA,
        tenantId: ids.tenantA,
        displayName: "Tenant A WhatsApp",
        status: "connected",
      });
      await context.db.insert(schema.whatsappContacts).values({
        id: ids.whatsappContactA,
        tenantId: ids.tenantA,
        whatsappAccountId: ids.whatsappAccountA,
        externalContactId: "236975239991464@lid",
        phoneNumber: null,
        displayName: "LID Sender",
      });

      const created = await context.app.inject({
        method: "POST",
        url: "/contacts",
        headers: context.sessionHeaders(ids.tenantA, { unsafe: true }),
        payload: {
          displayName: "May",
          whatsappExternalContactIds: ["236975239991464@lid"],
          roles: ["customer"],
        },
      });

      expect(created.statusCode).toBe(201);
      const body = created.json() as ContactResponse;
      expect(body.displayName).toBe("May");
      expect(body.whatsappIdentities).toMatchObject([
        {
          whatsappContactId: ids.whatsappContactA,
          externalContactId: "236975239991464@lid",
        },
      ]);

      const identityRows = await context.db
        .select()
        .from(schema.contactWhatsappIdentities)
        .where(
          and(
            eq(schema.contactWhatsappIdentities.tenantId, ids.tenantA),
            eq(
              schema.contactWhatsappIdentities.whatsappContactId,
              ids.whatsappContactA,
            ),
          ),
        );
      expect(identityRows).toHaveLength(1);
      expect(identityRows[0]?.contactId).toBe(body.id);
    },
    apiTestTimeoutMs,
  );
});

describe("environment validation", () => {
  it("fails fast when production secrets and storage config are missing", () => {
    const result = runEnvImport({
      NODE_ENV: "production",
      DATABASE_URL: "",
      SESSION_SECRET: "",
      ENCRYPTION_KEY: "",
      R2_ACCOUNT_ID: "",
      R2_ACCESS_KEY_ID: "",
      R2_SECRET_ACCESS_KEY: "",
      R2_BUCKET_NAME: "",
      R2_BUCKET: "",
      R2_ENDPOINT: "",
      CORS_ORIGINS: "https://dashboard.example.com",
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr?.toString() ?? "").toContain(
      "Invalid environment configuration",
    );
  });

  it("accepts production config when required values are present", () => {
    const result = runEnvImport({
      NODE_ENV: "production",
      DATABASE_URL: "postgres://user:pass@example.com:5432/app",
      SESSION_SECRET: "s".repeat(32),
      ENCRYPTION_KEY: "e".repeat(32),
      R2_ACCOUNT_ID: "account-id",
      R2_ACCESS_KEY_ID: "access-key",
      R2_SECRET_ACCESS_KEY: "secret-key",
      R2_BUCKET_NAME: "tenant-media",
      R2_ENDPOINT: "https://example.r2.cloudflarestorage.com",
      CORS_ORIGINS: "https://dashboard.example.com",
    });

    expect(result.exitCode).toBe(0);
  });
});

function uuid(value: number): string {
  return `00000000-0000-4000-8000-${value.toString(16).padStart(12, "0")}`;
}

function date(value: string): Date {
  return new Date(value);
}

function extractSetCookieValue(
  response: { headers: Record<string, string | string[] | number | undefined> },
  cookieName: string,
): string | null {
  const setCookieHeader = response.headers["set-cookie"];
  const setCookieValues = Array.isArray(setCookieHeader)
    ? setCookieHeader.filter((value): value is string => typeof value === "string")
    : typeof setCookieHeader === "string"
      ? [setCookieHeader]
      : [];
  const cookie = setCookieValues.find((value) =>
    value.startsWith(`${cookieName}=`),
  );
  const cookiePair = cookie?.split(";")[0];

  return cookiePair ? cookiePair.slice(cookieName.length + 1) : null;
}

function runEnvImport(
  overrides: Record<string, string>,
): ReturnType<typeof Bun.spawnSync> {
  return Bun.spawnSync({
    cmd: ["bun", "--eval", "import './src/config/env.ts';"],
    env: {
      ...process.env,
      ...overrides,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
}

async function setupApiTest(): Promise<ApiTestContext> {
  const client = new PGlite();
  await applyMigrations(client);

  const db = drizzle(client, { schema });
  const dbClient = await import("../src/db/client.ts");
  dbClient.setDatabaseForTesting(db as unknown as AppDatabase);

  const { buildServer } = await import("../src/server.ts");
  const app = await buildServer();
  await app.ready();

  function csrfHeaders(): Record<string, string> {
    return {
      cookie: `${csrfCookieName}=${csrfToken}`,
      [csrfHeaderName]: csrfToken,
      "content-type": "application/json",
    };
  }

  function sessionHeaders(
    tenantId?: string,
    options: { unsafe?: boolean; sessionToken?: string } = {},
  ): Record<string, string> {
    const cookies = [
      `${sessionCookieName}=${options.sessionToken ?? sessionToken}`,
    ];
    const headers: Record<string, string> = {
      cookie: cookies.join("; "),
    };

    if (tenantId) {
      headers["x-tenant-id"] = tenantId;
    }

    if (options.unsafe) {
      cookies.push(`${csrfCookieName}=${csrfToken}`);
      headers.cookie = cookies.join("; ");
      headers[csrfHeaderName] = csrfToken;
    }

    return headers;
  }

  currentContext = {
    app,
    client,
    db,
    csrfHeaders,
    sessionHeaders,
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
  const passwordHash = await hashPassword(loginPassword);

  await db.insert(schema.users).values({
    id: ids.user,
    email: "api-test@example.com",
    passwordHash,
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

async function seedContacts(db: TestDatabase): Promise<void> {
  await db.insert(schema.contacts).values([
    {
      id: ids.contactA,
      tenantId: ids.tenantA,
      displayName: "Tenant A Contact",
      createdAt: date("2026-01-02T00:00:00.000Z"),
      updatedAt: date("2026-01-02T00:00:00.000Z"),
    },
    {
      id: ids.contactB,
      tenantId: ids.tenantB,
      displayName: "Tenant B Contact",
      createdAt: date("2026-01-03T00:00:00.000Z"),
      updatedAt: date("2026-01-03T00:00:00.000Z"),
    },
  ]);
}
