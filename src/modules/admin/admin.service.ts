import {
  and,
  count,
  desc,
  eq,
  gte,
  ilike,
  isNull,
  lt,
  or,
  sql,
  type SQL,
} from "drizzle-orm";

import { getDatabase } from "../../db/client.ts";
import {
  auditLogs,
  mediaObjects,
  orders,
  products,
  tenantUsers,
  tenants,
  users,
  whatsappAccounts,
  whatsappMessages,
} from "../../db/schema.ts";
import { AppError } from "../../lib/app-error.ts";
import {
  decodeDateIdCursor,
  encodeDateIdCursor,
} from "../../lib/pagination.ts";
import type {
  AdminAuditLogListQuery,
  AdminTenantListQuery,
} from "./admin.schemas.ts";

type PaginatedRows<T extends { id: string; createdAt: Date }> = {
  pageRows: T[];
  nextCursor: string | null;
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

function paginateRows<T extends { id: string; createdAt: Date }>(
  rows: T[],
  limit: number,
): PaginatedRows<T> {
  const pageRows = rows.slice(0, limit);
  const nextRow = rows[limit];
  const cursorRow = pageRows[pageRows.length - 1];

  return {
    pageRows,
    nextCursor: nextRow && cursorRow
      ? encodeDateIdCursor({
          createdAt: cursorRow.createdAt,
          id: cursorRow.id,
        })
      : null,
  };
}

function toIsoDate(value: Date): string {
  return value.toISOString();
}

function toNumber(value: unknown): number {
  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "bigint") {
    return Number(value);
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function getUtcDayRange(date: Date): { start: Date; end: Date } {
  const start = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);

  return { start, end };
}

export async function listAdminTenants(query: AdminTenantListQuery): Promise<{
  items: Array<{
    id: string;
    name: string;
    slug: string;
    status: string;
    plan: string;
    createdAt: string;
    updatedAt: string;
  }>;
  pageInfo: {
    limit: number;
    nextCursor: string | null;
    hasMore: boolean;
  };
}> {
  const db = getDatabase();
  const conditions: SQL[] = [];

  if (query.status) {
    conditions.push(eq(tenants.status, query.status));
  } else {
    conditions.push(isNull(tenants.deletedAt));
  }

  if (query.plan) {
    conditions.push(eq(tenants.plan, query.plan));
  }

  if (query.search) {
    const searchPattern = `%${query.search}%`;
    const searchCondition = or(
      ilike(tenants.name, searchPattern),
      ilike(tenants.slug, searchPattern),
    );

    if (searchCondition) {
      conditions.push(searchCondition);
    }
  }

  if (query.cursor) {
    const cursor = decodeDateIdCursor(query.cursor);
    const cursorCondition = or(
      lt(tenants.createdAt, cursor.createdAt),
      and(eq(tenants.createdAt, cursor.createdAt), lt(tenants.id, cursor.id)),
    );

    if (cursorCondition) {
      conditions.push(cursorCondition);
    }
  }

  const rows = await db
    .select({
      id: tenants.id,
      name: tenants.name,
      slug: tenants.slug,
      status: tenants.status,
      plan: tenants.plan,
      createdAt: tenants.createdAt,
      updatedAt: tenants.updatedAt,
    })
    .from(tenants)
    .where(combineConditions(conditions))
    .orderBy(desc(tenants.createdAt), desc(tenants.id))
    .limit(query.limit + 1);

  const { pageRows, nextCursor } = paginateRows(rows, query.limit);

  return {
    items: pageRows.map((tenant) => ({
      ...tenant,
      createdAt: toIsoDate(tenant.createdAt),
      updatedAt: toIsoDate(tenant.updatedAt),
    })),
    pageInfo: {
      limit: query.limit,
      nextCursor,
      hasMore: nextCursor !== null,
    },
  };
}

export async function getAdminTenantDetail(tenantId: string): Promise<{
  tenant: {
    id: string;
    name: string;
    slug: string;
    status: string;
    plan: string;
    createdAt: string;
    updatedAt: string;
  };
  users: Array<{
    id: string;
    userId: string;
    email: string;
    displayName: string;
    role: string;
    status: string;
    createdAt: string;
  }>;
  whatsappAccounts: Array<{
    id: string;
    phoneNumber: string | null;
    displayName: string | null;
    status: string;
    lastConnectedAt: string | null;
    lastDisconnectedAt: string | null;
    createdAt: string;
  }>;
  counts: {
    activeUsers: number;
    whatsappAccounts: number;
    products: number;
    orders: number;
    untrackedMessagesPendingDeletion: number;
    temporaryMediaObjects: number;
  };
}> {
  const db = getDatabase();

  const tenantRows = await db
    .select({
      id: tenants.id,
      name: tenants.name,
      slug: tenants.slug,
      status: tenants.status,
      plan: tenants.plan,
      createdAt: tenants.createdAt,
      updatedAt: tenants.updatedAt,
    })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);

  const tenant = tenantRows[0];

  if (!tenant) {
    throw new AppError({
      code: "TENANT_NOT_FOUND",
      message: "Tenant was not found.",
      statusCode: 404,
    });
  }

  const [
    tenantUserRows,
    whatsappAccountRows,
    activeUserCountRows,
    whatsappAccountCountRows,
    productCountRows,
    orderCountRows,
    untrackedMessageRows,
    temporaryMediaRows,
  ] = await Promise.all([
    db
      .select({
        id: tenantUsers.id,
        userId: users.id,
        email: users.email,
        displayName: users.displayName,
        role: tenantUsers.role,
        status: tenantUsers.status,
        createdAt: tenantUsers.createdAt,
      })
      .from(tenantUsers)
      .innerJoin(users, eq(tenantUsers.userId, users.id))
      .where(
        and(
          eq(tenantUsers.tenantId, tenantId),
          isNull(tenantUsers.deletedAt),
          isNull(users.deletedAt),
        ),
      )
      .orderBy(desc(tenantUsers.createdAt)),
    db
      .select({
        id: whatsappAccounts.id,
        phoneNumber: whatsappAccounts.phoneNumber,
        displayName: whatsappAccounts.displayName,
        status: whatsappAccounts.status,
        lastConnectedAt: whatsappAccounts.lastConnectedAt,
        lastDisconnectedAt: whatsappAccounts.lastDisconnectedAt,
        createdAt: whatsappAccounts.createdAt,
      })
      .from(whatsappAccounts)
      .where(
        and(
          eq(whatsappAccounts.tenantId, tenantId),
          isNull(whatsappAccounts.deletedAt),
        ),
      )
      .orderBy(desc(whatsappAccounts.createdAt)),
    db
      .select({ value: count() })
      .from(tenantUsers)
      .where(
        and(
          eq(tenantUsers.tenantId, tenantId),
          eq(tenantUsers.status, "active"),
          isNull(tenantUsers.deletedAt),
        ),
      ),
    db
      .select({ value: count() })
      .from(whatsappAccounts)
      .where(
        and(
          eq(whatsappAccounts.tenantId, tenantId),
          isNull(whatsappAccounts.deletedAt),
        ),
      ),
    db
      .select({ value: count() })
      .from(products)
      .where(and(eq(products.tenantId, tenantId), isNull(products.deletedAt))),
    db
      .select({ value: count() })
      .from(orders)
      .where(and(eq(orders.tenantId, tenantId), isNull(orders.deletedAt))),
    db
      .select({ value: count() })
      .from(whatsappMessages)
      .where(
        and(
          eq(whatsappMessages.tenantId, tenantId),
          eq(whatsappMessages.isTemporary, true),
          eq(whatsappMessages.isTracked, false),
          eq(whatsappMessages.isLinked, false),
          lt(whatsappMessages.expiresAt, new Date()),
          isNull(whatsappMessages.deletedAt),
        ),
      ),
    db
      .select({ value: count() })
      .from(mediaObjects)
      .where(
        and(
          eq(mediaObjects.tenantId, tenantId),
          eq(mediaObjects.isTemporary, true),
          isNull(mediaObjects.deletedAt),
        ),
      ),
  ]);

  return {
    tenant: {
      ...tenant,
      createdAt: toIsoDate(tenant.createdAt),
      updatedAt: toIsoDate(tenant.updatedAt),
    },
    users: tenantUserRows.map((tenantUser) => ({
      ...tenantUser,
      createdAt: toIsoDate(tenantUser.createdAt),
    })),
    whatsappAccounts: whatsappAccountRows.map((account) => ({
      ...account,
      lastConnectedAt: account.lastConnectedAt
        ? toIsoDate(account.lastConnectedAt)
        : null,
      lastDisconnectedAt: account.lastDisconnectedAt
        ? toIsoDate(account.lastDisconnectedAt)
        : null,
      createdAt: toIsoDate(account.createdAt),
    })),
    counts: {
      activeUsers: activeUserCountRows[0]?.value ?? 0,
      whatsappAccounts: whatsappAccountCountRows[0]?.value ?? 0,
      products: productCountRows[0]?.value ?? 0,
      orders: orderCountRows[0]?.value ?? 0,
      untrackedMessagesPendingDeletion: untrackedMessageRows[0]?.value ?? 0,
      temporaryMediaObjects: temporaryMediaRows[0]?.value ?? 0,
    },
  };
}

export async function listAdminAuditLogs(
  query: AdminAuditLogListQuery,
): Promise<{
  items: Array<{
    id: string;
    tenantId: string | null;
    actorUserId: string | null;
    action: string;
    entityType: string;
    entityId: string | null;
    metadata: Record<string, unknown>;
    createdAt: string;
  }>;
  pageInfo: {
    limit: number;
    nextCursor: string | null;
    hasMore: boolean;
  };
}> {
  const db = getDatabase();
  const conditions: SQL[] = [];

  if (query.tenantId) {
    conditions.push(eq(auditLogs.tenantId, query.tenantId));
  }

  if (query.actorUserId) {
    conditions.push(eq(auditLogs.actorUserId, query.actorUserId));
  }

  if (query.action) {
    conditions.push(eq(auditLogs.action, query.action));
  }

  if (query.entityType) {
    conditions.push(eq(auditLogs.entityType, query.entityType));
  }

  if (query.cursor) {
    const cursor = decodeDateIdCursor(query.cursor);
    const cursorCondition = or(
      lt(auditLogs.createdAt, cursor.createdAt),
      and(eq(auditLogs.createdAt, cursor.createdAt), lt(auditLogs.id, cursor.id)),
    );

    if (cursorCondition) {
      conditions.push(cursorCondition);
    }
  }

  const rows = await db
    .select({
      id: auditLogs.id,
      tenantId: auditLogs.tenantId,
      actorUserId: auditLogs.actorUserId,
      action: auditLogs.action,
      entityType: auditLogs.entityType,
      entityId: auditLogs.entityId,
      metadata: auditLogs.metadata,
      createdAt: auditLogs.createdAt,
    })
    .from(auditLogs)
    .where(combineConditions(conditions))
    .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
    .limit(query.limit + 1);

  const { pageRows, nextCursor } = paginateRows(rows, query.limit);

  return {
    items: pageRows.map((auditLog) => ({
      ...auditLog,
      createdAt: toIsoDate(auditLog.createdAt),
    })),
    pageInfo: {
      limit: query.limit,
      nextCursor,
      hasMore: nextCursor !== null,
    },
  };
}

export async function getAdminSystemMetrics(): Promise<{
  tenants: {
    total: number;
    byStatus: Record<string, number>;
  };
  whatsappAccounts: {
    total: number;
    byStatus: Record<string, number>;
  };
  messages: {
    receivedToday: number;
    trackedToday: number;
    expiredUntrackedPendingDeletion: number;
  };
  storage: {
    temporaryObjectCount: number;
    temporaryStorageBytes: number;
  };
  checkedAt: string;
}> {
  const db = getDatabase();
  const now = new Date();
  const today = getUtcDayRange(now);

  const [
    tenantStatusRows,
    whatsappAccountStatusRows,
    messagesReceivedTodayRows,
    messagesTrackedTodayRows,
    expiredUntrackedRows,
    temporaryStorageRows,
  ] = await Promise.all([
    db
      .select({
        status: tenants.status,
        value: count(),
      })
      .from(tenants)
      .where(isNull(tenants.deletedAt))
      .groupBy(tenants.status),
    db
      .select({
        status: whatsappAccounts.status,
        value: count(),
      })
      .from(whatsappAccounts)
      .where(isNull(whatsappAccounts.deletedAt))
      .groupBy(whatsappAccounts.status),
    db
      .select({ value: count() })
      .from(whatsappMessages)
      .where(
        and(
          gte(whatsappMessages.receivedAt, today.start),
          lt(whatsappMessages.receivedAt, today.end),
          isNull(whatsappMessages.deletedAt),
        ),
      ),
    db
      .select({ value: count() })
      .from(whatsappMessages)
      .where(
        and(
          eq(whatsappMessages.isTracked, true),
          gte(whatsappMessages.receivedAt, today.start),
          lt(whatsappMessages.receivedAt, today.end),
          isNull(whatsappMessages.deletedAt),
        ),
      ),
    db
      .select({ value: count() })
      .from(whatsappMessages)
      .where(
        and(
          eq(whatsappMessages.isTemporary, true),
          eq(whatsappMessages.isTracked, false),
          eq(whatsappMessages.isLinked, false),
          lt(whatsappMessages.expiresAt, now),
          isNull(whatsappMessages.deletedAt),
        ),
      ),
    db
      .select({
        temporaryObjectCount: count(),
        temporaryStorageBytes: sql<unknown>`coalesce(sum(${mediaObjects.sizeBytes}), 0)`,
      })
      .from(mediaObjects)
      .where(
        and(eq(mediaObjects.isTemporary, true), isNull(mediaObjects.deletedAt)),
      ),
  ]);

  const tenantsByStatus: Record<string, number> = {};
  for (const row of tenantStatusRows) {
    tenantsByStatus[row.status] = row.value;
  }

  const whatsappAccountsByStatus: Record<string, number> = {};
  for (const row of whatsappAccountStatusRows) {
    whatsappAccountsByStatus[row.status] = row.value;
  }

  const temporaryStorage = temporaryStorageRows[0];

  return {
    tenants: {
      total: tenantStatusRows.reduce((sum, row) => sum + row.value, 0),
      byStatus: tenantsByStatus,
    },
    whatsappAccounts: {
      total: whatsappAccountStatusRows.reduce((sum, row) => sum + row.value, 0),
      byStatus: whatsappAccountsByStatus,
    },
    messages: {
      receivedToday: messagesReceivedTodayRows[0]?.value ?? 0,
      trackedToday: messagesTrackedTodayRows[0]?.value ?? 0,
      expiredUntrackedPendingDeletion: expiredUntrackedRows[0]?.value ?? 0,
    },
    storage: {
      temporaryObjectCount: temporaryStorage?.temporaryObjectCount ?? 0,
      temporaryStorageBytes: toNumber(temporaryStorage?.temporaryStorageBytes),
    },
    checkedAt: now.toISOString(),
  };
}
