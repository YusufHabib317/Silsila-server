import { afterEach, describe, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";

import { PGlite } from "@electric-sql/pglite";
import { and, asc, eq, inArray } from "drizzle-orm";
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
  contactA: uuid(10),
  contactB: uuid(11),
  productA1: uuid(30),
  productA2: uuid(31),
  productB1: uuid(33),
  orderA1: uuid(40),
  orderB1: uuid(43),
  commissionA1: uuid(50),
  commissionA2: uuid(51),
  commissionA3: uuid(52),
  commissionB1: uuid(53),
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
  patch: <TBody>(
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

type CommissionDto = {
  id: string;
  orderId: string | null;
  productId: string | null;
  contactId: string;
  commissionType: "fixed_amount" | "percentage" | "manual" | "unknown";
  amountMinor: number | null;
  percentage: number | null;
  currency: string;
  status: "pending" | "approved" | "paid" | "cancelled";
  paidAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type CommissionListResponse = {
  items: CommissionDto[];
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

describe("commissions API tenant graph", () => {
  it(
    "rejects cross-tenant order, product, and contact references",
    async () => {
      const context = await setupApiTest();

      await seedContact(context.db, ids.tenantA, ids.contactA, "Tenant A Agent");
      await seedContact(context.db, ids.tenantB, ids.contactB, "Tenant B Agent");
      await seedProduct(context.db, {
        id: ids.productA1,
        tenantId: ids.tenantA,
        name: "Tenant A Product",
      });
      await seedProduct(context.db, {
        id: ids.productB1,
        tenantId: ids.tenantB,
        name: "Tenant B Product",
      });
      await seedOrderWithItems(context.db, {
        id: ids.orderA1,
        tenantId: ids.tenantA,
        orderNumber: "A-001",
        productId: ids.productA1,
      });
      await seedOrderWithItems(context.db, {
        id: ids.orderB1,
        tenantId: ids.tenantB,
        orderNumber: "B-001",
        productId: ids.productB1,
      });

      const badContact = await context.post<ErrorResponse>("/commissions", {
        contactId: ids.contactB,
        commissionType: "manual",
        amountMinor: 500,
      });
      expect(badContact.statusCode).toBe(400);
      expect(badContact.body.error.code).toBe(
        "COMMISSION_CONTACT_REFERENCE_INVALID",
      );

      const badOrder = await context.post<ErrorResponse>("/commissions", {
        contactId: ids.contactA,
        orderId: ids.orderB1,
        commissionType: "manual",
        amountMinor: 500,
      });
      expect(badOrder.statusCode).toBe(400);
      expect(badOrder.body.error.code).toBe(
        "COMMISSION_ORDER_REFERENCE_INVALID",
      );

      const badProduct = await context.post<ErrorResponse>("/commissions", {
        contactId: ids.contactA,
        productId: ids.productB1,
        commissionType: "manual",
        amountMinor: 500,
      });
      expect(badProduct.statusCode).toBe(400);
      expect(badProduct.body.error.code).toBe(
        "COMMISSION_PRODUCT_REFERENCE_INVALID",
      );
    },
    apiTestTimeoutMs,
  );

  it(
    "keeps GET /commissions tenant-scoped and cursor paginated",
    async () => {
      const context = await setupApiTest();

      await seedContact(context.db, ids.tenantA, ids.contactA, "Tenant A Agent");
      await seedContact(context.db, ids.tenantB, ids.contactB, "Tenant B Agent");
      await seedCommission(context.db, {
        id: ids.commissionA1,
        tenantId: ids.tenantA,
        contactId: ids.contactA,
        amountMinor: 300,
        createdAt: date("2026-03-03T00:00:00.000Z"),
      });
      await seedCommission(context.db, {
        id: ids.commissionA2,
        tenantId: ids.tenantA,
        contactId: ids.contactA,
        amountMinor: 200,
        createdAt: date("2026-03-02T00:00:00.000Z"),
      });
      await seedCommission(context.db, {
        id: ids.commissionA3,
        tenantId: ids.tenantA,
        contactId: ids.contactA,
        amountMinor: 100,
        createdAt: date("2026-03-01T00:00:00.000Z"),
      });
      await seedCommission(context.db, {
        id: ids.commissionB1,
        tenantId: ids.tenantB,
        contactId: ids.contactB,
        amountMinor: 400,
        createdAt: date("2026-03-04T00:00:00.000Z"),
      });

      const firstPage =
        await context.get<CommissionListResponse>("/commissions?limit=2");
      expect(firstPage.statusCode).toBe(200);
      expect(firstPage.body.items.map((commission) => commission.id)).toEqual([
        ids.commissionA1,
        ids.commissionA2,
      ]);
      expect(
        firstPage.body.items.map((commission) => commission.id),
      ).not.toContain(ids.commissionB1);
      expect(firstPage.body.pageInfo.hasMore).toBe(true);
      expect(typeof firstPage.body.pageInfo.nextCursor).toBe("string");

      const nextCursor = firstPage.body.pageInfo.nextCursor;
      if (!nextCursor) {
        throw new Error("Expected commissions nextCursor to be set.");
      }

      const secondPage = await context.get<CommissionListResponse>(
        `/commissions?limit=2&cursor=${encodeURIComponent(nextCursor)}`,
      );
      expect(secondPage.statusCode).toBe(200);
      expect(secondPage.body.items.map((commission) => commission.id)).toEqual([
        ids.commissionA3,
      ]);
      expect(secondPage.body.pageInfo.hasMore).toBe(false);
      expect(secondPage.body.pageInfo.nextCursor).toBeNull();
    },
    apiTestTimeoutMs,
  );

  it(
    "writes audit logs for commission create and update",
    async () => {
      const context = await setupApiTest();

      await seedContact(context.db, ids.tenantA, ids.contactA, "Tenant A Agent");

      const created = await context.post<CommissionDto>("/commissions", {
        contactId: ids.contactA,
        commissionType: "fixed_amount",
        amountMinor: 1500,
        currency: "syp",
      });
      expect(created.statusCode).toBe(201);
      expect(created.body.currency).toBe("SYP");

      const updated = await context.patch<CommissionDto>(
        `/commissions/${created.body.id}`,
        {
          status: "approved",
          amountMinor: 1750,
        },
      );
      expect(updated.statusCode).toBe(200);
      expect(updated.body.status).toBe("approved");
      expect(updated.body.amountMinor).toBe(1750);

      const logs = await context.db
        .select()
        .from(schema.auditLogs)
        .where(
          and(
            eq(schema.auditLogs.tenantId, ids.tenantA),
            inArray(schema.auditLogs.action, [
              "commission.created",
              "commission.updated",
            ]),
          ),
        )
        .orderBy(asc(schema.auditLogs.createdAt));

      expect(logs.map((log) => log.action)).toEqual([
        "commission.created",
        "commission.updated",
      ]);
      expect(logs[0]?.entityId).toBe(created.body.id);
      expect(logs[0]?.actorUserId).toBe(ids.user);
      expect(logs[0]?.metadata).toEqual({
        orderId: null,
        productId: null,
        contactId: ids.contactA,
        commissionType: "fixed_amount",
      });
      expect(logs[1]?.metadata).toEqual({
        changedFields: ["amountMinor", "status"],
      });
    },
    apiTestTimeoutMs,
  );

  it(
    "requires a sent productId to belong to the sent orderId",
    async () => {
      const context = await setupApiTest();

      await seedContact(context.db, ids.tenantA, ids.contactA, "Tenant A Agent");
      await seedProduct(context.db, {
        id: ids.productA1,
        tenantId: ids.tenantA,
        name: "Tenant A Product 1",
      });
      await seedProduct(context.db, {
        id: ids.productA2,
        tenantId: ids.tenantA,
        name: "Tenant A Product 2",
      });
      await seedOrderWithItems(context.db, {
        id: ids.orderA1,
        tenantId: ids.tenantA,
        orderNumber: "A-001",
        productId: ids.productA1,
      });

      const mismatch = await context.post<ErrorResponse>("/commissions", {
        contactId: ids.contactA,
        orderId: ids.orderA1,
        productId: ids.productA2,
        commissionType: "fixed_amount",
        amountMinor: 750,
      });
      expect(mismatch.statusCode).toBe(400);
      expect(mismatch.body.error.code).toBe(
        "COMMISSION_ORDER_PRODUCT_MISMATCH",
      );

      const matched = await context.post<CommissionDto>("/commissions", {
        contactId: ids.contactA,
        orderId: ids.orderA1,
        productId: ids.productA1,
        commissionType: "fixed_amount",
        amountMinor: 750,
      });
      expect(matched.statusCode).toBe(201);
      expect(matched.body.orderId).toBe(ids.orderA1);
      expect(matched.body.productId).toBe(ids.productA1);
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

  async function patch<TBody>(
    url: string,
    payload: unknown,
    tenantId = ids.tenantA,
  ): Promise<InjectedJson<TBody>> {
    const response = await app.inject({
      method: "PATCH",
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
    patch,
    setDatabaseForTesting: dbClient.setDatabaseForTesting,
  };

  return currentContext;
}

async function applyMigrations(client: PGlite): Promise<void> {
  const migration = await readFile(
    new URL("../drizzle/0000_furry_trish_tilby.sql", import.meta.url),
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

async function seedContact(
  db: TestDatabase,
  tenantId: string,
  id: string,
  displayName: string,
): Promise<void> {
  await db.insert(schema.contacts).values({
    id,
    tenantId,
    displayName,
  });
}

async function seedProduct(
  db: TestDatabase,
  input: {
    id: string;
    tenantId: string;
    name: string;
  },
): Promise<void> {
  await db.insert(schema.products).values({
    id: input.id,
    tenantId: input.tenantId,
    name: input.name,
    currency: "SYP",
  });
}

async function seedOrderWithItems(
  db: TestDatabase,
  input: {
    id: string;
    tenantId: string;
    orderNumber: string;
    productId?: string;
  },
): Promise<void> {
  const itemId = uuid(Number.parseInt(input.id.slice(-12), 16) + 1000);

  await db.insert(schema.orders).values({
    id: input.id,
    tenantId: input.tenantId,
    orderNumber: input.orderNumber,
    totalAmountMinor: 1000,
    currency: "SYP",
  });

  await db.insert(schema.orderItems).values({
    id: itemId,
    tenantId: input.tenantId,
    orderId: input.id,
    productId: input.productId ?? null,
    title: `${input.orderNumber} item`,
    quantity: 1,
    unitAmountMinor: 1000,
    totalAmountMinor: 1000,
    currency: "SYP",
  });
}

async function seedCommission(
  db: TestDatabase,
  input: {
    id: string;
    tenantId: string;
    contactId: string;
    amountMinor: number;
    createdAt: Date;
  },
): Promise<void> {
  await db.insert(schema.commissions).values({
    id: input.id,
    tenantId: input.tenantId,
    contactId: input.contactId,
    commissionType: "fixed_amount",
    amountMinor: input.amountMinor,
    currency: "SYP",
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  });
}
