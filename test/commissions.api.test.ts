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
  contactA2: uuid(12),
  productA1: uuid(30),
  productA2: uuid(31),
  productB1: uuid(33),
  orderA1: uuid(40),
  orderA2: uuid(41),
  orderB1: uuid(43),
  commissionA1: uuid(50),
  commissionA2: uuid(51),
  commissionA3: uuid(52),
  commissionB1: uuid(53),
  commissionA4: uuid(54),
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
    "keeps GET /commissions/:id tenant-scoped",
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
        id: ids.commissionB1,
        tenantId: ids.tenantB,
        contactId: ids.contactB,
        amountMinor: 400,
        createdAt: date("2026-03-04T00:00:00.000Z"),
      });

      const ownCommission =
        await context.get<CommissionDto>(`/commissions/${ids.commissionA1}`);
      expect(ownCommission.statusCode).toBe(200);
      expect(ownCommission.body.id).toBe(ids.commissionA1);

      const foreignCommission =
        await context.get<ErrorResponse>(`/commissions/${ids.commissionB1}`);
      expect(foreignCommission.statusCode).toBe(404);
      expect(foreignCommission.body.error.code).toBe("COMMISSION_NOT_FOUND");

      const tenantBOwnCommission = await context.get<CommissionDto>(
        `/commissions/${ids.commissionB1}`,
        ids.tenantB,
      );
      expect(tenantBOwnCommission.statusCode).toBe(200);
      expect(tenantBOwnCommission.body.id).toBe(ids.commissionB1);
    },
    apiTestTimeoutMs,
  );

  it(
    "filters GET /commissions by order, product, contact, status, and type",
    async () => {
      const context = await setupApiTest();

      await seedContact(context.db, ids.tenantA, ids.contactA, "Tenant A Agent");
      await seedContact(
        context.db,
        ids.tenantA,
        ids.contactA2,
        "Tenant A Agent 2",
      );
      await seedContact(context.db, ids.tenantB, ids.contactB, "Tenant B Agent");
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
        id: ids.orderA2,
        tenantId: ids.tenantA,
        orderNumber: "A-002",
        productId: ids.productA2,
      });
      await seedOrderWithItems(context.db, {
        id: ids.orderB1,
        tenantId: ids.tenantB,
        orderNumber: "B-001",
        productId: ids.productB1,
      });
      await seedCommission(context.db, {
        id: ids.commissionA1,
        tenantId: ids.tenantA,
        orderId: ids.orderA1,
        productId: ids.productA1,
        contactId: ids.contactA,
        commissionType: "fixed_amount",
        status: "pending",
        amountMinor: 100,
        createdAt: date("2026-03-04T00:00:00.000Z"),
      });
      await seedCommission(context.db, {
        id: ids.commissionA2,
        tenantId: ids.tenantA,
        orderId: ids.orderA2,
        productId: ids.productA2,
        contactId: ids.contactA2,
        commissionType: "percentage",
        status: "approved",
        amountMinor: 200,
        percentage: "12.50",
        createdAt: date("2026-03-03T00:00:00.000Z"),
      });
      await seedCommission(context.db, {
        id: ids.commissionA3,
        tenantId: ids.tenantA,
        contactId: ids.contactA,
        commissionType: "manual",
        status: "paid",
        amountMinor: 300,
        createdAt: date("2026-03-02T00:00:00.000Z"),
      });
      await seedCommission(context.db, {
        id: ids.commissionB1,
        tenantId: ids.tenantB,
        orderId: ids.orderB1,
        productId: ids.productB1,
        contactId: ids.contactB,
        commissionType: "fixed_amount",
        status: "pending",
        amountMinor: 400,
        createdAt: date("2026-03-05T00:00:00.000Z"),
      });

      const byOrder = await context.get<CommissionListResponse>(
        `/commissions?orderId=${ids.orderA1}`,
      );
      expect(byOrder.statusCode).toBe(200);
      expect(byOrder.body.items.map((commission) => commission.id)).toEqual([
        ids.commissionA1,
      ]);

      const byProduct = await context.get<CommissionListResponse>(
        `/commissions?productId=${ids.productA2}`,
      );
      expect(byProduct.statusCode).toBe(200);
      expect(byProduct.body.items.map((commission) => commission.id)).toEqual([
        ids.commissionA2,
      ]);

      const byContact = await context.get<CommissionListResponse>(
        `/commissions?contactId=${ids.contactA2}`,
      );
      expect(byContact.statusCode).toBe(200);
      expect(byContact.body.items.map((commission) => commission.id)).toEqual([
        ids.commissionA2,
      ]);

      const byStatus =
        await context.get<CommissionListResponse>("/commissions?status=paid");
      expect(byStatus.statusCode).toBe(200);
      expect(byStatus.body.items.map((commission) => commission.id)).toEqual([
        ids.commissionA3,
      ]);

      const byType = await context.get<CommissionListResponse>(
        "/commissions?commissionType=percentage",
      );
      expect(byType.statusCode).toBe(200);
      expect(byType.body.items.map((commission) => commission.id)).toEqual([
        ids.commissionA2,
      ]);
    },
    apiTestTimeoutMs,
  );

  it(
    "validates commission amount and percentage by type",
    async () => {
      const context = await setupApiTest();

      await seedContact(context.db, ids.tenantA, ids.contactA, "Tenant A Agent");

      const fixedMissingAmount = await context.post<ErrorResponse>(
        "/commissions",
        {
          contactId: ids.contactA,
          commissionType: "fixed_amount",
        },
      );
      expect(fixedMissingAmount.statusCode).toBe(400);
      expect(fixedMissingAmount.body.error.code).toBe(
        "COMMISSION_AMOUNT_REQUIRED",
      );

      const manualWithPercentage = await context.post<ErrorResponse>(
        "/commissions",
        {
          contactId: ids.contactA,
          commissionType: "manual",
          amountMinor: 100,
          percentage: 10,
        },
      );
      expect(manualWithPercentage.statusCode).toBe(400);
      expect(manualWithPercentage.body.error.code).toBe(
        "COMMISSION_PERCENTAGE_NOT_ALLOWED",
      );

      const percentageMissingValue = await context.post<ErrorResponse>(
        "/commissions",
        {
          contactId: ids.contactA,
          commissionType: "percentage",
        },
      );
      expect(percentageMissingValue.statusCode).toBe(400);
      expect(percentageMissingValue.body.error.code).toBe(
        "COMMISSION_PERCENTAGE_REQUIRED",
      );

      const percentageWithAmount = await context.post<ErrorResponse>(
        "/commissions",
        {
          contactId: ids.contactA,
          commissionType: "percentage",
          amountMinor: 100,
          percentage: 12.5,
        },
      );
      expect(percentageWithAmount.statusCode).toBe(400);
      expect(percentageWithAmount.body.error.code).toBe(
        "COMMISSION_AMOUNT_NOT_ALLOWED",
      );

      const validPercentage = await context.post<CommissionDto>(
        "/commissions",
        {
          contactId: ids.contactA,
          commissionType: "percentage",
          percentage: 12.5,
        },
      );
      expect(validPercentage.statusCode).toBe(201);
      expect(validPercentage.body.amountMinor).toBeNull();
      expect(validPercentage.body.percentage).toBe(12.5);
    },
    apiTestTimeoutMs,
  );

  it(
    "allows paidAt only when the commission is paid",
    async () => {
      const context = await setupApiTest();
      const paidAt = "2026-04-01T00:00:00.000Z";

      await seedContact(context.db, ids.tenantA, ids.contactA, "Tenant A Agent");

      const pendingWithPaidAt = await context.post<ErrorResponse>(
        "/commissions",
        {
          contactId: ids.contactA,
          commissionType: "fixed_amount",
          amountMinor: 500,
          paidAt,
        },
      );
      expect(pendingWithPaidAt.statusCode).toBe(400);
      expect(pendingWithPaidAt.body.error.code).toBe(
        "COMMISSION_PAID_AT_STATUS_INVALID",
      );

      const paidOnCreate = await context.post<CommissionDto>("/commissions", {
        contactId: ids.contactA,
        commissionType: "fixed_amount",
        amountMinor: 500,
        status: "paid",
        paidAt,
      });
      expect(paidOnCreate.statusCode).toBe(201);
      expect(paidOnCreate.body.status).toBe("paid");
      expect(paidOnCreate.body.paidAt).toBe(paidAt);

      const createdPending = await context.post<CommissionDto>("/commissions", {
        contactId: ids.contactA,
        commissionType: "manual",
        amountMinor: 600,
      });
      expect(createdPending.statusCode).toBe(201);

      const paidAtWithoutStatus = await context.patch<ErrorResponse>(
        `/commissions/${createdPending.body.id}`,
        {
          paidAt,
        },
      );
      expect(paidAtWithoutStatus.statusCode).toBe(400);
      expect(paidAtWithoutStatus.body.error.code).toBe(
        "COMMISSION_PAID_AT_STATUS_INVALID",
      );

      const paidOnPatch = await context.patch<CommissionDto>(
        `/commissions/${createdPending.body.id}`,
        {
          status: "paid",
          paidAt,
        },
      );
      expect(paidOnPatch.statusCode).toBe(200);
      expect(paidOnPatch.body.status).toBe("paid");
      expect(paidOnPatch.body.paidAt).toBe(paidAt);
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
    orderId?: string;
    productId?: string;
    contactId: string;
    commissionType?: "fixed_amount" | "percentage" | "manual";
    status?: "pending" | "approved" | "paid" | "cancelled";
    amountMinor: number;
    percentage?: string;
    createdAt: Date;
  },
): Promise<void> {
  await db.insert(schema.commissions).values({
    id: input.id,
    tenantId: input.tenantId,
    orderId: input.orderId ?? null,
    productId: input.productId ?? null,
    contactId: input.contactId,
    commissionType: input.commissionType ?? "fixed_amount",
    amountMinor: input.amountMinor,
    percentage: input.percentage ?? null,
    currency: "SYP",
    status: input.status ?? "pending",
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  });
}
