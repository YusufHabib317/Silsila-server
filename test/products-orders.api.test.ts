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
  bundleA: uuid(20),
  bundleB: uuid(21),
  productA1: uuid(30),
  productA2: uuid(31),
  productA3: uuid(32),
  productB1: uuid(33),
  orderA1: uuid(40),
  orderA2: uuid(41),
  orderA3: uuid(42),
  orderB1: uuid(43),
} as const;

type TestDatabase = PgliteDatabase<typeof schema> & {
  $client: PGlite;
};

type ApiTestContext = {
  app: FastifyInstance;
  client: PGlite;
  db: TestDatabase;
  headersFor: (
    tenantId: string,
    options?: { unsafe?: boolean },
  ) => Record<string, string>;
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

type ProductDto = {
  id: string;
  name: string;
  ownerContactId: string | null;
  merchantContactId: string | null;
  sourceBundleId: string | null;
};

type ProductListResponse = {
  items: ProductDto[];
  pageInfo: {
    limit: number;
    nextCursor: string | null;
    hasMore: boolean;
  };
};

type OrderItemDto = {
  id: string;
  productId: string | null;
  title: string;
  quantity: number;
  unitAmountMinor: number | null;
  totalAmountMinor: number | null;
  currency: string;
};

type OrderDto = {
  id: string;
  orderNumber: string;
  customerContactId: string | null;
  merchantContactId: string | null;
  agentContactId: string | null;
  sourceBundleId: string | null;
  totalAmountMinor: number | null;
  currency: string;
  notes: string | null;
  items: OrderItemDto[];
};

type OrderListResponse = {
  items: OrderDto[];
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

describe("products and orders API tenant graph", () => {
  it(
    "rejects cross-tenant contact, product, and source bundle references",
    async () => {
      const context = await setupApiTest();

      await seedContact(
        context.db,
        ids.tenantA,
        ids.contactA,
        "Tenant A Customer",
      );
      await seedContact(
        context.db,
        ids.tenantB,
        ids.contactB,
        "Tenant B Customer",
      );
      await seedSourceBundle(context.db, ids.tenantA, ids.bundleA, 50);
      await seedSourceBundle(context.db, ids.tenantB, ids.bundleB, 60);
      await seedProduct(context.db, {
        id: ids.productB1,
        tenantId: ids.tenantB,
        name: "Tenant B Product",
      });

      const badProductContact = await context.post<ErrorResponse>("/products", {
        name: "Bad Product Contact",
        ownerContactId: ids.contactB,
      });
      expect(badProductContact.statusCode).toBe(400);
      expect(badProductContact.body.error.code).toBe(
        "PRODUCT_CONTACT_REFERENCE_INVALID",
      );

      const badProductBundle = await context.post<ErrorResponse>("/products", {
        name: "Bad Product Bundle",
        sourceBundleId: ids.bundleB,
      });
      expect(badProductBundle.statusCode).toBe(400);
      expect(badProductBundle.body.error.code).toBe(
        "PRODUCT_SOURCE_BUNDLE_REFERENCE_INVALID",
      );

      const badOrderContact = await context.post<ErrorResponse>("/orders", {
        orderNumber: "ORD-BAD-CONTACT",
        customerContactId: ids.contactB,
        items: [{ title: "Manual Item", quantity: 1, unitAmountMinor: 1000 }],
      });
      expect(badOrderContact.statusCode).toBe(400);
      expect(badOrderContact.body.error.code).toBe(
        "ORDER_CONTACT_REFERENCE_INVALID",
      );

      const badOrderBundle = await context.post<ErrorResponse>("/orders", {
        orderNumber: "ORD-BAD-BUNDLE",
        sourceBundleId: ids.bundleB,
        items: [{ title: "Manual Item", quantity: 1, unitAmountMinor: 1000 }],
      });
      expect(badOrderBundle.statusCode).toBe(400);
      expect(badOrderBundle.body.error.code).toBe(
        "ORDER_SOURCE_BUNDLE_REFERENCE_INVALID",
      );

      const badOrderProduct = await context.post<ErrorResponse>("/orders", {
        orderNumber: "ORD-BAD-PRODUCT",
        items: [
          {
            productId: ids.productB1,
            title: "Foreign Product",
            quantity: 1,
            unitAmountMinor: 1000,
          },
        ],
      });
      expect(badOrderProduct.statusCode).toBe(400);
      expect(badOrderProduct.body.error.code).toBe(
        "ORDER_PRODUCT_REFERENCE_INVALID",
      );
    },
    apiTestTimeoutMs,
  );

  it(
    "keeps GET /products tenant-scoped and cursor paginated",
    async () => {
      const context = await setupApiTest();

      await seedProduct(context.db, {
        id: ids.productA1,
        tenantId: ids.tenantA,
        name: "Tenant A Product 1",
        createdAt: date("2026-01-03T00:00:00.000Z"),
      });
      await seedProduct(context.db, {
        id: ids.productA2,
        tenantId: ids.tenantA,
        name: "Tenant A Product 2",
        createdAt: date("2026-01-02T00:00:00.000Z"),
      });
      await seedProduct(context.db, {
        id: ids.productA3,
        tenantId: ids.tenantA,
        name: "Tenant A Product 3",
        createdAt: date("2026-01-01T00:00:00.000Z"),
      });
      await seedProduct(context.db, {
        id: ids.productB1,
        tenantId: ids.tenantB,
        name: "Tenant B Product 1",
        createdAt: date("2026-01-04T00:00:00.000Z"),
      });

      const firstPage =
        await context.get<ProductListResponse>("/products?limit=2");
      expect(firstPage.statusCode).toBe(200);
      expect(firstPage.body.items.map((product) => product.name)).toEqual([
        "Tenant A Product 1",
        "Tenant A Product 2",
      ]);
      expect(firstPage.body.items.map((product) => product.name)).not.toContain(
        "Tenant B Product 1",
      );
      expect(firstPage.body.pageInfo.hasMore).toBe(true);
      expect(typeof firstPage.body.pageInfo.nextCursor).toBe("string");

      const nextCursor = firstPage.body.pageInfo.nextCursor;
      if (!nextCursor) {
        throw new Error("Expected products nextCursor to be set.");
      }

      const secondPage = await context.get<ProductListResponse>(
        `/products?limit=2&cursor=${encodeURIComponent(nextCursor)}`,
      );
      expect(secondPage.statusCode).toBe(200);
      expect(secondPage.body.items.map((product) => product.name)).toEqual([
        "Tenant A Product 3",
      ]);
      expect(secondPage.body.pageInfo.hasMore).toBe(false);
      expect(secondPage.body.pageInfo.nextCursor).toBeNull();
    },
    apiTestTimeoutMs,
  );

  it(
    "keeps GET /orders tenant-scoped and cursor paginated",
    async () => {
      const context = await setupApiTest();

      await seedOrderWithItems(context.db, {
        id: ids.orderA1,
        tenantId: ids.tenantA,
        orderNumber: "A-003",
        createdAt: date("2026-02-03T00:00:00.000Z"),
      });
      await seedOrderWithItems(context.db, {
        id: ids.orderA2,
        tenantId: ids.tenantA,
        orderNumber: "A-002",
        createdAt: date("2026-02-02T00:00:00.000Z"),
      });
      await seedOrderWithItems(context.db, {
        id: ids.orderA3,
        tenantId: ids.tenantA,
        orderNumber: "A-001",
        createdAt: date("2026-02-01T00:00:00.000Z"),
      });
      await seedOrderWithItems(context.db, {
        id: ids.orderB1,
        tenantId: ids.tenantB,
        orderNumber: "B-004",
        createdAt: date("2026-02-04T00:00:00.000Z"),
      });

      const firstPage = await context.get<OrderListResponse>("/orders?limit=2");
      expect(firstPage.statusCode).toBe(200);
      expect(firstPage.body.items.map((order) => order.orderNumber)).toEqual([
        "A-003",
        "A-002",
      ]);
      expect(
        firstPage.body.items.map((order) => order.orderNumber),
      ).not.toContain("B-004");
      expect(firstPage.body.pageInfo.hasMore).toBe(true);
      expect(typeof firstPage.body.pageInfo.nextCursor).toBe("string");

      const nextCursor = firstPage.body.pageInfo.nextCursor;
      if (!nextCursor) {
        throw new Error("Expected orders nextCursor to be set.");
      }

      const secondPage = await context.get<OrderListResponse>(
        `/orders?limit=2&cursor=${encodeURIComponent(nextCursor)}`,
      );
      expect(secondPage.statusCode).toBe(200);
      expect(secondPage.body.items.map((order) => order.orderNumber)).toEqual([
        "A-001",
      ]);
      expect(secondPage.body.pageInfo.hasMore).toBe(false);
      expect(secondPage.body.pageInfo.nextCursor).toBeNull();
    },
    apiTestTimeoutMs,
  );

  it(
    "derives order and item totals from item minor units on POST /orders",
    async () => {
      const context = await setupApiTest();

      await seedContact(
        context.db,
        ids.tenantA,
        ids.contactA,
        "Tenant A Customer",
      );
      await seedProduct(context.db, {
        id: ids.productA1,
        tenantId: ids.tenantA,
        name: "Tenant A Product 1",
      });

      const created = await context.post<OrderDto>("/orders", {
        orderNumber: "ORD-TOTALS",
        customerContactId: ids.contactA,
        currency: "syp",
        items: [
          {
            productId: ids.productA1,
            title: "Product Item",
            quantity: 2,
            unitAmountMinor: 1200,
          },
          {
            title: "Manual Item",
            quantity: 3,
            unitAmountMinor: 500,
          },
        ],
      });

      expect(created.statusCode).toBe(201);
      expect(created.body.currency).toBe("SYP");
      expect(created.body.totalAmountMinor).toBe(3900);
      expect(
        Object.fromEntries(
          created.body.items.map((item) => [item.title, item.totalAmountMinor]),
        ),
      ).toEqual({
        "Product Item": 2400,
        "Manual Item": 1500,
      });
    },
    apiTestTimeoutMs,
  );

  it(
    "replaces order items only when PATCH /orders sends items",
    async () => {
      const context = await setupApiTest();

      await seedProduct(context.db, {
        id: ids.productA1,
        tenantId: ids.tenantA,
        name: "Tenant A Product 1",
      });

      const created = await context.post<OrderDto>("/orders", {
        orderNumber: "ORD-PATCH-ITEMS",
        notes: "Original note",
        items: [
          {
            productId: ids.productA1,
            title: "Original Item",
            quantity: 2,
            unitAmountMinor: 700,
          },
        ],
      });
      expect(created.statusCode).toBe(201);
      const originalItemIds = created.body.items.map((item) => item.id);

      const notesOnly = await context.patch<OrderDto>(
        `/orders/${created.body.id}`,
        {
          notes: "Updated note",
        },
      );
      expect(notesOnly.statusCode).toBe(200);
      expect(notesOnly.body.notes).toBe("Updated note");
      expect(notesOnly.body.totalAmountMinor).toBe(1400);
      expect(notesOnly.body.items.map((item) => item.id)).toEqual(
        originalItemIds,
      );
      expect(notesOnly.body.items.map((item) => item.title)).toEqual([
        "Original Item",
      ]);

      const replaced = await context.patch<OrderDto>(
        `/orders/${created.body.id}`,
        {
          items: [
            {
              title: "Replacement Item",
              quantity: 4,
              unitAmountMinor: 250,
            },
          ],
        },
      );
      expect(replaced.statusCode).toBe(200);
      expect(replaced.body.totalAmountMinor).toBe(1000);
      expect(replaced.body.items).toHaveLength(1);
      expect(replaced.body.items[0]?.title).toBe("Replacement Item");
      expect(replaced.body.items[0]?.id).not.toBe(originalItemIds[0]);
    },
    apiTestTimeoutMs,
  );

  it(
    "writes audit logs for product create and update",
    async () => {
      const context = await setupApiTest();

      const created = await context.post<ProductDto>("/products", {
        name: "Audited Product",
      });
      expect(created.statusCode).toBe(201);

      const updated = await context.patch<ProductDto>(
        `/products/${created.body.id}`,
        {
          name: "Audited Product Updated",
        },
      );
      expect(updated.statusCode).toBe(200);

      const logs = await context.db
        .select()
        .from(schema.auditLogs)
        .where(
          and(
            eq(schema.auditLogs.tenantId, ids.tenantA),
            inArray(schema.auditLogs.action, [
              "product.created",
              "product.updated",
            ]),
          ),
        )
        .orderBy(asc(schema.auditLogs.createdAt));

      expect(logs.map((log) => log.action)).toEqual([
        "product.created",
        "product.updated",
      ]);
      expect(logs[0]?.entityId).toBe(created.body.id);
      expect(logs[0]?.actorUserId).toBe(ids.user);
      expect(logs[1]?.metadata).toEqual({
        changedFields: ["name"],
      });
    },
    apiTestTimeoutMs,
  );

  it(
    "writes audit logs for order create and update",
    async () => {
      const context = await setupApiTest();

      await seedContact(
        context.db,
        ids.tenantA,
        ids.contactA,
        "Tenant A Customer",
      );
      await seedProduct(context.db, {
        id: ids.productA1,
        tenantId: ids.tenantA,
        name: "Tenant A Product 1",
      });

      const created = await context.post<OrderDto>("/orders", {
        orderNumber: "ORD-AUDIT",
        customerContactId: ids.contactA,
        items: [
          {
            productId: ids.productA1,
            title: "Audited Item",
            quantity: 1,
            unitAmountMinor: 2000,
          },
        ],
      });
      expect(created.statusCode).toBe(201);

      const updated = await context.patch<OrderDto>(
        `/orders/${created.body.id}`,
        {
          items: [
            {
              title: "Audited Replacement",
              quantity: 2,
              unitAmountMinor: 900,
            },
          ],
        },
      );
      expect(updated.statusCode).toBe(200);

      const logs = await context.db
        .select()
        .from(schema.auditLogs)
        .where(
          and(
            eq(schema.auditLogs.tenantId, ids.tenantA),
            inArray(schema.auditLogs.action, [
              "order.created",
              "order.updated",
            ]),
          ),
        )
        .orderBy(asc(schema.auditLogs.createdAt));

      expect(logs.map((log) => log.action)).toEqual([
        "order.created",
        "order.updated",
      ]);
      expect(logs[0]?.entityId).toBe(created.body.id);
      expect(logs[0]?.metadata).toEqual({
        itemCount: 1,
        productIds: [ids.productA1],
        customerContactId: ids.contactA,
        merchantContactId: null,
        agentContactId: null,
        sourceBundleId: null,
      });
      expect(logs[1]?.metadata).toEqual({
        changedFields: ["items", "totalAmountMinor"],
        replacedItems: true,
        itemCount: 1,
        productIds: [],
      });
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
    headersFor,
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

async function seedSourceBundle(
  db: TestDatabase,
  tenantId: string,
  bundleId: string,
  seed: number,
): Promise<void> {
  const whatsappAccountId = uuid(seed);
  const chatId = uuid(seed + 1);

  await db.insert(schema.whatsappAccounts).values({
    id: whatsappAccountId,
    tenantId,
  });

  await db.insert(schema.whatsappChats).values({
    id: chatId,
    tenantId,
    whatsappAccountId,
    externalChatId: `chat-${seed}`,
  });

  await db.insert(schema.messageBundles).values({
    id: bundleId,
    tenantId,
    whatsappAccountId,
    sourceChatId: chatId,
    title: `Bundle ${seed}`,
    bundleType: "product",
    createdByUserId: ids.user,
  });
}

async function seedProduct(
  db: TestDatabase,
  input: {
    id: string;
    tenantId: string;
    name: string;
    createdAt?: Date;
  },
): Promise<void> {
  const createdAt = input.createdAt ?? date("2026-01-01T00:00:00.000Z");

  await db.insert(schema.products).values({
    id: input.id,
    tenantId: input.tenantId,
    name: input.name,
    currency: "SYP",
    createdAt,
    updatedAt: createdAt,
  });
}

async function seedOrderWithItems(
  db: TestDatabase,
  input: {
    id: string;
    tenantId: string;
    orderNumber: string;
    createdAt?: Date;
  },
): Promise<void> {
  const createdAt = input.createdAt ?? date("2026-02-01T00:00:00.000Z");
  const itemId = uuid(Number.parseInt(input.id.slice(-12), 16) + 1000);

  await db.insert(schema.orders).values({
    id: input.id,
    tenantId: input.tenantId,
    orderNumber: input.orderNumber,
    totalAmountMinor: 1000,
    currency: "SYP",
    createdAt,
    updatedAt: createdAt,
  });

  await db.insert(schema.orderItems).values({
    id: itemId,
    tenantId: input.tenantId,
    orderId: input.id,
    title: `${input.orderNumber} item`,
    quantity: 1,
    unitAmountMinor: 1000,
    totalAmountMinor: 1000,
    currency: "SYP",
    createdAt,
  });
}
