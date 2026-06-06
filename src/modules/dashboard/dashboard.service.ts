import {
  and,
  count,
  eq,
  inArray,
  isNull,
  sql,
} from "drizzle-orm";

import { getDatabase } from "../../db/client.ts";
import {
  commissions,
  contactRoles,
  contacts,
  orders,
  products,
} from "../../db/schema.ts";

type MoneyTotalDto = {
  amountMinor: number;
  currency: string;
};

type MoneyRow = {
  amountMinor: unknown;
  currency: string;
};

const openOrderStatuses = [
  "new",
  "needs_review",
  "confirmed",
  "preparing",
  "shipped",
] as const;

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

function getCount(rows: Array<{ value: number }>): number {
  return rows[0]?.value ?? 0;
}

function mapMoneyRows(rows: MoneyRow[]): MoneyTotalDto[] {
  return rows
    .map((row) => ({
      amountMinor: toNumber(row.amountMinor),
      currency: row.currency,
    }))
    .filter((row) => row.amountMinor > 0);
}

export async function getDashboardStats(tenantId: string): Promise<{
  checkedAt: string;
  commissions: {
    approved: number;
    approvedAmount: MoneyTotalDto[];
    paid: number;
    paidAmount: MoneyTotalDto[];
    pending: number;
    pendingAmount: MoneyTotalDto[];
    total: number;
  };
  contacts: {
    agents: number;
    customers: number;
    merchants: number;
    total: number;
  };
  orders: {
    delivered: number;
    grossAmount: MoneyTotalDto[];
    needsReview: number;
    open: number;
    paid: number;
    paidAmount: MoneyTotalDto[];
    total: number;
  };
  products: {
    active: number;
    draft: number;
    lowStock: number;
    outOfStock: number;
    total: number;
  };
}> {
  const db = getDatabase();

  const [
    totalOrderRows,
    openOrderRows,
    paidOrderRows,
    deliveredOrderRows,
    needsReviewOrderRows,
    grossOrderAmountRows,
    paidOrderAmountRows,
    totalProductRows,
    activeProductRows,
    draftProductRows,
    lowStockProductRows,
    outOfStockProductRows,
    totalContactRows,
    merchantContactRows,
    agentContactRows,
    customerContactRows,
    totalCommissionRows,
    pendingCommissionRows,
    approvedCommissionRows,
    paidCommissionRows,
    pendingCommissionAmountRows,
    approvedCommissionAmountRows,
    paidCommissionAmountRows,
  ] = await Promise.all([
    db
      .select({ value: count() })
      .from(orders)
      .where(and(eq(orders.tenantId, tenantId), isNull(orders.deletedAt))),
    db
      .select({ value: count() })
      .from(orders)
      .where(
        and(
          eq(orders.tenantId, tenantId),
          inArray(orders.status, openOrderStatuses),
          isNull(orders.deletedAt),
        ),
      ),
    db
      .select({ value: count() })
      .from(orders)
      .where(
        and(
          eq(orders.tenantId, tenantId),
          eq(orders.paymentStatus, "paid"),
          isNull(orders.deletedAt),
        ),
      ),
    db
      .select({ value: count() })
      .from(orders)
      .where(
        and(
          eq(orders.tenantId, tenantId),
          eq(orders.deliveryStatus, "delivered"),
          isNull(orders.deletedAt),
        ),
      ),
    db
      .select({ value: count() })
      .from(orders)
      .where(
        and(
          eq(orders.tenantId, tenantId),
          eq(orders.status, "needs_review"),
          isNull(orders.deletedAt),
        ),
      ),
    db
      .select({
        amountMinor: sql<unknown>`coalesce(sum(${orders.totalAmountMinor}), 0)`,
        currency: orders.currency,
      })
      .from(orders)
      .where(and(eq(orders.tenantId, tenantId), isNull(orders.deletedAt)))
      .groupBy(orders.currency),
    db
      .select({
        amountMinor: sql<unknown>`coalesce(sum(${orders.totalAmountMinor}), 0)`,
        currency: orders.currency,
      })
      .from(orders)
      .where(
        and(
          eq(orders.tenantId, tenantId),
          eq(orders.paymentStatus, "paid"),
          isNull(orders.deletedAt),
        ),
      )
      .groupBy(orders.currency),
    db
      .select({ value: count() })
      .from(products)
      .where(and(eq(products.tenantId, tenantId), isNull(products.deletedAt))),
    db
      .select({ value: count() })
      .from(products)
      .where(
        and(
          eq(products.tenantId, tenantId),
          eq(products.productStatus, "active"),
          isNull(products.deletedAt),
        ),
      ),
    db
      .select({ value: count() })
      .from(products)
      .where(
        and(
          eq(products.tenantId, tenantId),
          eq(products.productStatus, "draft"),
          isNull(products.deletedAt),
        ),
      ),
    db
      .select({ value: count() })
      .from(products)
      .where(
        and(
          eq(products.tenantId, tenantId),
          eq(products.stockStatus, "low_stock"),
          isNull(products.deletedAt),
        ),
      ),
    db
      .select({ value: count() })
      .from(products)
      .where(
        and(
          eq(products.tenantId, tenantId),
          eq(products.stockStatus, "out_of_stock"),
          isNull(products.deletedAt),
        ),
      ),
    db
      .select({ value: count() })
      .from(contacts)
      .where(and(eq(contacts.tenantId, tenantId), isNull(contacts.deletedAt))),
    db
      .select({
        value: sql<unknown>`count(distinct ${contactRoles.contactId})`,
      })
      .from(contactRoles)
      .innerJoin(
        contacts,
        and(
          eq(contacts.tenantId, tenantId),
          eq(contacts.id, contactRoles.contactId),
          isNull(contacts.deletedAt),
        ),
      )
      .where(
        and(eq(contactRoles.tenantId, tenantId), eq(contactRoles.role, "merchant")),
      ),
    db
      .select({
        value: sql<unknown>`count(distinct ${contactRoles.contactId})`,
      })
      .from(contactRoles)
      .innerJoin(
        contacts,
        and(
          eq(contacts.tenantId, tenantId),
          eq(contacts.id, contactRoles.contactId),
          isNull(contacts.deletedAt),
        ),
      )
      .where(
        and(eq(contactRoles.tenantId, tenantId), eq(contactRoles.role, "agent")),
      ),
    db
      .select({
        value: sql<unknown>`count(distinct ${contactRoles.contactId})`,
      })
      .from(contactRoles)
      .innerJoin(
        contacts,
        and(
          eq(contacts.tenantId, tenantId),
          eq(contacts.id, contactRoles.contactId),
          isNull(contacts.deletedAt),
        ),
      )
      .where(
        and(eq(contactRoles.tenantId, tenantId), eq(contactRoles.role, "customer")),
      ),
    db
      .select({ value: count() })
      .from(commissions)
      .where(eq(commissions.tenantId, tenantId)),
    db
      .select({ value: count() })
      .from(commissions)
      .where(
        and(eq(commissions.tenantId, tenantId), eq(commissions.status, "pending")),
      ),
    db
      .select({ value: count() })
      .from(commissions)
      .where(
        and(eq(commissions.tenantId, tenantId), eq(commissions.status, "approved")),
      ),
    db
      .select({ value: count() })
      .from(commissions)
      .where(
        and(eq(commissions.tenantId, tenantId), eq(commissions.status, "paid")),
      ),
    db
      .select({
        amountMinor: sql<unknown>`coalesce(sum(${commissions.amountMinor}), 0)`,
        currency: commissions.currency,
      })
      .from(commissions)
      .where(
        and(eq(commissions.tenantId, tenantId), eq(commissions.status, "pending")),
      )
      .groupBy(commissions.currency),
    db
      .select({
        amountMinor: sql<unknown>`coalesce(sum(${commissions.amountMinor}), 0)`,
        currency: commissions.currency,
      })
      .from(commissions)
      .where(
        and(eq(commissions.tenantId, tenantId), eq(commissions.status, "approved")),
      )
      .groupBy(commissions.currency),
    db
      .select({
        amountMinor: sql<unknown>`coalesce(sum(${commissions.amountMinor}), 0)`,
        currency: commissions.currency,
      })
      .from(commissions)
      .where(
        and(eq(commissions.tenantId, tenantId), eq(commissions.status, "paid")),
      )
      .groupBy(commissions.currency),
  ]);

  return {
    checkedAt: new Date().toISOString(),
    commissions: {
      approved: getCount(approvedCommissionRows),
      approvedAmount: mapMoneyRows(approvedCommissionAmountRows),
      paid: getCount(paidCommissionRows),
      paidAmount: mapMoneyRows(paidCommissionAmountRows),
      pending: getCount(pendingCommissionRows),
      pendingAmount: mapMoneyRows(pendingCommissionAmountRows),
      total: getCount(totalCommissionRows),
    },
    contacts: {
      agents: toNumber(agentContactRows[0]?.value),
      customers: toNumber(customerContactRows[0]?.value),
      merchants: toNumber(merchantContactRows[0]?.value),
      total: getCount(totalContactRows),
    },
    orders: {
      delivered: getCount(deliveredOrderRows),
      grossAmount: mapMoneyRows(grossOrderAmountRows),
      needsReview: getCount(needsReviewOrderRows),
      open: getCount(openOrderRows),
      paid: getCount(paidOrderRows),
      paidAmount: mapMoneyRows(paidOrderAmountRows),
      total: getCount(totalOrderRows),
    },
    products: {
      active: getCount(activeProductRows),
      draft: getCount(draftProductRows),
      lowStock: getCount(lowStockProductRows),
      outOfStock: getCount(outOfStockProductRows),
      total: getCount(totalProductRows),
    },
  };
}
