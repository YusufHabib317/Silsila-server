import {
  and,
  asc,
  desc,
  eq,
  ilike,
  inArray,
  isNull,
  lt,
  ne,
  or,
  type SQL,
} from "drizzle-orm";

import { getDatabase } from "../../db/client.ts";
import {
  auditLogs,
  contacts,
  messageBundles,
  orderItems,
  orders,
  products,
} from "../../db/schema.ts";
import { AppError } from "../../lib/app-error.ts";
import {
  decodeDateIdCursor,
  encodeDateIdCursor,
} from "../../lib/pagination.ts";
import type {
  CreateOrderInput,
  DeliveryStatusInput,
  OrderItemInput,
  OrderListQuery,
  OrderStatusInput,
  PaymentStatusInput,
  UpdateOrderInput,
} from "./orders.schemas.ts";

const maxAmountMinor = 2_147_483_647;

type OrderRecord = typeof orders.$inferSelect;
type OrderItemRecord = typeof orderItems.$inferSelect;

type OrderItemDto = {
  id: string;
  productId: string | null;
  title: string;
  quantity: number;
  unitAmountMinor: number | null;
  totalAmountMinor: number | null;
  currency: string;
  createdAt: string;
};

type OrderDto = {
  id: string;
  orderNumber: string;
  customerContactId: string | null;
  merchantContactId: string | null;
  agentContactId: string | null;
  sourceBundleId: string | null;
  status: OrderStatusInput;
  paymentStatus: PaymentStatusInput;
  deliveryStatus: DeliveryStatusInput;
  totalAmountMinor: number | null;
  currency: string;
  notes: string | null;
  createdByUserId: string | null;
  items: OrderItemDto[];
  createdAt: string;
  updatedAt: string;
};

type OrderListResult = {
  items: OrderDto[];
  pageInfo: {
    limit: number;
    nextCursor: string | null;
    hasMore: boolean;
  };
};

type OrderReferenceValues = {
  customerContactId?: string | null | undefined;
  merchantContactId?: string | null | undefined;
  agentContactId?: string | null | undefined;
  sourceBundleId?: string | null | undefined;
  productId?: string | null | undefined;
  productIds?: string[] | undefined;
};

type NormalizedOrderItem = {
  productId: string | null;
  title: string;
  quantity: number;
  unitAmountMinor: number | null;
  totalAmountMinor: number | null;
  currency: string;
};

type OrderUpdateValues = {
  orderNumber?: string;
  customerContactId?: string | null;
  merchantContactId?: string | null;
  agentContactId?: string | null;
  sourceBundleId?: string | null;
  status?: OrderStatusInput;
  paymentStatus?: PaymentStatusInput;
  deliveryStatus?: DeliveryStatusInput;
  totalAmountMinor?: number | null;
  currency?: string;
  notes?: string | null;
  updatedAt: Date;
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

function toIsoDate(value: Date): string {
  return value.toISOString();
}

function toOrderItemDto(item: OrderItemRecord): OrderItemDto {
  return {
    id: item.id,
    productId: item.productId,
    title: item.title,
    quantity: item.quantity,
    unitAmountMinor: item.unitAmountMinor,
    totalAmountMinor: item.totalAmountMinor,
    currency: item.currency,
    createdAt: toIsoDate(item.createdAt),
  };
}

function toOrderDto(
  order: OrderRecord,
  itemRows: OrderItemRecord[],
): OrderDto {
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    customerContactId: order.customerContactId,
    merchantContactId: order.merchantContactId,
    agentContactId: order.agentContactId,
    sourceBundleId: order.sourceBundleId,
    status: order.status,
    paymentStatus: order.paymentStatus,
    deliveryStatus: order.deliveryStatus,
    totalAmountMinor: order.totalAmountMinor,
    currency: order.currency,
    notes: order.notes,
    createdByUserId: order.createdByUserId,
    items: itemRows.map(toOrderItemDto),
    createdAt: toIsoDate(order.createdAt),
    updatedAt: toIsoDate(order.updatedAt),
  };
}

function getReferencedProductIds(
  references: OrderReferenceValues,
): string[] {
  const productIds = [
    references.productId,
    ...(references.productIds ?? []),
  ].filter((productId): productId is string => typeof productId === "string");

  return Array.from(new Set(productIds));
}

function calculateItemTotalAmountMinor(
  quantity: number,
  unitAmountMinor: number | null,
): number | null {
  if (unitAmountMinor === null) {
    return null;
  }

  const totalAmountMinor = quantity * unitAmountMinor;

  if (totalAmountMinor > maxAmountMinor) {
    throw new AppError({
      code: "ORDER_ITEM_TOTAL_TOO_LARGE",
      message: "Order item total exceeds the supported minor-unit range.",
      statusCode: 400,
    });
  }

  return totalAmountMinor;
}

function calculateOrderTotalAmountMinor(
  items: NormalizedOrderItem[],
): number | null {
  let totalAmountMinor = 0;

  for (const item of items) {
    if (item.totalAmountMinor === null) {
      return null;
    }

    totalAmountMinor += item.totalAmountMinor;

    if (totalAmountMinor > maxAmountMinor) {
      throw new AppError({
        code: "ORDER_TOTAL_TOO_LARGE",
        message: "Order total exceeds the supported minor-unit range.",
        statusCode: 400,
      });
    }
  }

  return totalAmountMinor;
}

function normalizeOrderItems(
  inputItems: OrderItemInput[],
  fallbackCurrency: string,
): NormalizedOrderItem[] {
  return inputItems.map((item) => {
    const unitAmountMinor = item.unitAmountMinor ?? null;
    const currency = item.currency ?? fallbackCurrency;

    if (currency !== fallbackCurrency) {
      throw new AppError({
        code: "ORDER_ITEM_CURRENCY_MISMATCH",
        message: "Order item currency must match the order currency.",
        statusCode: 400,
      });
    }

    return {
      productId: item.productId ?? null,
      title: item.title,
      quantity: item.quantity,
      unitAmountMinor,
      totalAmountMinor: calculateItemTotalAmountMinor(
        item.quantity,
        unitAmountMinor,
      ),
      currency,
    };
  });
}

async function validateOrderReferences(
  tenantId: string,
  references: OrderReferenceValues,
): Promise<void> {
  const db = getDatabase();
  const contactIds = Array.from(
    new Set(
      [
        references.customerContactId,
        references.merchantContactId,
        references.agentContactId,
      ].filter((contactId): contactId is string => typeof contactId === "string"),
    ),
  );

  if (contactIds.length > 0) {
    const contactRows = await db
      .select({ id: contacts.id })
      .from(contacts)
      .where(
        and(
          eq(contacts.tenantId, tenantId),
          inArray(contacts.id, contactIds),
          isNull(contacts.deletedAt),
        ),
      );
    const foundContactIds = new Set(contactRows.map((contact) => contact.id));
    const hasMissingContact = contactIds.some(
      (contactId) => !foundContactIds.has(contactId),
    );

    if (hasMissingContact) {
      throw new AppError({
        code: "ORDER_CONTACT_REFERENCE_INVALID",
        message: "Referenced contact was not found for this tenant.",
        statusCode: 400,
      });
    }
  }

  if (typeof references.sourceBundleId === "string") {
    const bundleRows = await db
      .select({ id: messageBundles.id })
      .from(messageBundles)
      .where(
        and(
          eq(messageBundles.tenantId, tenantId),
          eq(messageBundles.id, references.sourceBundleId),
          isNull(messageBundles.deletedAt),
        ),
      )
      .limit(1);

    if (!bundleRows[0]) {
      throw new AppError({
        code: "ORDER_SOURCE_BUNDLE_REFERENCE_INVALID",
        message: "Referenced source bundle was not found for this tenant.",
        statusCode: 400,
      });
    }
  }

  const productIds = getReferencedProductIds(references);

  if (productIds.length > 0) {
    const productRows = await db
      .select({ id: products.id })
      .from(products)
      .where(
        and(
          eq(products.tenantId, tenantId),
          inArray(products.id, productIds),
          isNull(products.deletedAt),
        ),
      );
    const foundProductIds = new Set(productRows.map((product) => product.id));
    const hasMissingProduct = productIds.some(
      (productId) => !foundProductIds.has(productId),
    );

    if (hasMissingProduct) {
      throw new AppError({
        code: "ORDER_PRODUCT_REFERENCE_INVALID",
        message: "Referenced product was not found for this tenant.",
        statusCode: 400,
      });
    }
  }
}

async function ensureOrderNumberAvailable(
  tenantId: string,
  orderNumber: string,
  exceptOrderId?: string,
): Promise<void> {
  const db = getDatabase();
  const conditions: SQL[] = [
    eq(orders.tenantId, tenantId),
    eq(orders.orderNumber, orderNumber),
  ];

  if (exceptOrderId) {
    conditions.push(ne(orders.id, exceptOrderId));
  }

  const rows = await db
    .select({ id: orders.id })
    .from(orders)
    .where(combineConditions(conditions))
    .limit(1);

  if (rows[0]) {
    throw new AppError({
      code: "ORDER_NUMBER_CONFLICT",
      message: "Order number is already used for this tenant.",
      statusCode: 409,
    });
  }
}

async function findOrderIdsByProductId(
  tenantId: string,
  productId: string,
): Promise<string[]> {
  const db = getDatabase();
  const rows = await db
    .select({ orderId: orderItems.orderId })
    .from(orderItems)
    .where(
      and(eq(orderItems.tenantId, tenantId), eq(orderItems.productId, productId)),
    );

  return Array.from(new Set(rows.map((item) => item.orderId)));
}

async function findOrderForTenant(
  tenantId: string,
  orderId: string,
): Promise<OrderRecord> {
  const db = getDatabase();
  const rows = await db
    .select()
    .from(orders)
    .where(
      and(
        eq(orders.id, orderId),
        eq(orders.tenantId, tenantId),
        isNull(orders.deletedAt),
      ),
    )
    .limit(1);

  const order = rows[0];

  if (!order) {
    throw new AppError({
      code: "ORDER_NOT_FOUND",
      message: "Order was not found.",
      statusCode: 404,
    });
  }

  return order;
}

async function loadItemsByOrderId(
  tenantId: string,
  orderIds: string[],
): Promise<Map<string, OrderItemRecord[]>> {
  const itemsByOrderId = new Map<string, OrderItemRecord[]>();

  if (orderIds.length === 0) {
    return itemsByOrderId;
  }

  const db = getDatabase();
  const itemRows = await db
    .select()
    .from(orderItems)
    .where(
      and(
        eq(orderItems.tenantId, tenantId),
        inArray(orderItems.orderId, orderIds),
      ),
    )
    .orderBy(asc(orderItems.createdAt), asc(orderItems.id));

  for (const itemRow of itemRows) {
    const existingItems = itemsByOrderId.get(itemRow.orderId) ?? [];
    existingItems.push(itemRow);
    itemsByOrderId.set(itemRow.orderId, existingItems);
  }

  return itemsByOrderId;
}

export async function listOrders(
  tenantId: string,
  query: OrderListQuery,
): Promise<OrderListResult> {
  await validateOrderReferences(tenantId, query);

  const db = getDatabase();
  const conditions: SQL[] = [
    eq(orders.tenantId, tenantId),
    isNull(orders.deletedAt),
  ];

  if (query.status) {
    conditions.push(eq(orders.status, query.status));
  }

  if (query.paymentStatus) {
    conditions.push(eq(orders.paymentStatus, query.paymentStatus));
  }

  if (query.deliveryStatus) {
    conditions.push(eq(orders.deliveryStatus, query.deliveryStatus));
  }

  if (query.customerContactId) {
    conditions.push(eq(orders.customerContactId, query.customerContactId));
  }

  if (query.merchantContactId) {
    conditions.push(eq(orders.merchantContactId, query.merchantContactId));
  }

  if (query.agentContactId) {
    conditions.push(eq(orders.agentContactId, query.agentContactId));
  }

  if (query.sourceBundleId) {
    conditions.push(eq(orders.sourceBundleId, query.sourceBundleId));
  }

  if (query.productId) {
    const productOrderIds = await findOrderIdsByProductId(
      tenantId,
      query.productId,
    );

    if (productOrderIds.length === 0) {
      return {
        items: [],
        pageInfo: {
          limit: query.limit,
          nextCursor: null,
          hasMore: false,
        },
      };
    }

    conditions.push(inArray(orders.id, productOrderIds));
  }

  if (query.currency) {
    conditions.push(eq(orders.currency, query.currency));
  }

  if (query.search) {
    const searchPattern = `%${query.search}%`;
    const searchCondition = or(
      ilike(orders.orderNumber, searchPattern),
      ilike(orders.notes, searchPattern),
    );

    if (searchCondition) {
      conditions.push(searchCondition);
    }
  }

  if (query.cursor) {
    const cursor = decodeDateIdCursor(query.cursor);
    const cursorCondition = or(
      lt(orders.createdAt, cursor.createdAt),
      and(eq(orders.createdAt, cursor.createdAt), lt(orders.id, cursor.id)),
    );

    if (cursorCondition) {
      conditions.push(cursorCondition);
    }
  }

  const rows = await db
    .select()
    .from(orders)
    .where(combineConditions(conditions))
    .orderBy(desc(orders.createdAt), desc(orders.id))
    .limit(query.limit + 1);

  const pageRows = rows.slice(0, query.limit);
  const nextRow = rows[query.limit];
  const cursorRow = pageRows[pageRows.length - 1];
  const itemsByOrderId = await loadItemsByOrderId(
    tenantId,
    pageRows.map((order) => order.id),
  );

  return {
    items: pageRows.map((order) =>
      toOrderDto(order, itemsByOrderId.get(order.id) ?? []),
    ),
    pageInfo: {
      limit: query.limit,
      nextCursor: nextRow && cursorRow
        ? encodeDateIdCursor({
            createdAt: cursorRow.createdAt,
            id: cursorRow.id,
          })
        : null,
      hasMore: nextRow !== undefined,
    },
  };
}

export async function getOrder(
  tenantId: string,
  orderId: string,
): Promise<OrderDto> {
  const order = await findOrderForTenant(tenantId, orderId);
  const itemsByOrderId = await loadItemsByOrderId(tenantId, [order.id]);

  return toOrderDto(order, itemsByOrderId.get(order.id) ?? []);
}

export async function createOrder(
  tenantId: string,
  actorUserId: string,
  input: CreateOrderInput,
): Promise<OrderDto> {
  const normalizedItems = normalizeOrderItems(input.items, input.currency);
  const totalAmountMinor = calculateOrderTotalAmountMinor(normalizedItems);
  const productIds = normalizedItems
    .map((item) => item.productId)
    .filter((productId): productId is string => typeof productId === "string");

  await validateOrderReferences(tenantId, {
    ...input,
    productIds,
  });
  await ensureOrderNumberAvailable(tenantId, input.orderNumber);

  const db = getDatabase();
  const createdOrder = await db.transaction(async (transaction) => {
    const orderRows = await transaction
      .insert(orders)
      .values({
        tenantId,
        orderNumber: input.orderNumber,
        customerContactId: input.customerContactId,
        merchantContactId: input.merchantContactId,
        agentContactId: input.agentContactId,
        sourceBundleId: input.sourceBundleId,
        status: input.status,
        paymentStatus: input.paymentStatus,
        deliveryStatus: input.deliveryStatus,
        totalAmountMinor,
        currency: input.currency,
        notes: input.notes,
        createdByUserId: actorUserId,
      })
      .returning();

    const order = orderRows[0];

    if (!order) {
      throw new AppError({
        code: "ORDER_CREATE_FAILED",
        message: "Order could not be created.",
        statusCode: 500,
      });
    }

    await transaction.insert(orderItems).values(
      normalizedItems.map((item) => ({
        tenantId,
        orderId: order.id,
        productId: item.productId,
        title: item.title,
        quantity: item.quantity,
        unitAmountMinor: item.unitAmountMinor,
        totalAmountMinor: item.totalAmountMinor,
        currency: item.currency,
      })),
    );

    await transaction.insert(auditLogs).values({
      tenantId,
      actorUserId,
      action: "order.created",
      entityType: "order",
      entityId: order.id,
      metadata: {
        itemCount: normalizedItems.length,
        productIds,
        customerContactId: input.customerContactId ?? null,
        merchantContactId: input.merchantContactId ?? null,
        agentContactId: input.agentContactId ?? null,
        sourceBundleId: input.sourceBundleId ?? null,
      },
    });

    return order;
  });

  const itemsByOrderId = await loadItemsByOrderId(tenantId, [createdOrder.id]);

  return toOrderDto(createdOrder, itemsByOrderId.get(createdOrder.id) ?? []);
}

export async function updateOrder(
  tenantId: string,
  actorUserId: string,
  orderId: string,
  input: UpdateOrderInput,
): Promise<OrderDto> {
  const existingOrder = await findOrderForTenant(tenantId, orderId);
  const fallbackCurrency = input.currency ?? existingOrder.currency;
  const normalizedItems = input.items
    ? normalizeOrderItems(input.items, fallbackCurrency)
    : undefined;
  const productIds = normalizedItems
    ? normalizedItems
        .map((item) => item.productId)
        .filter((productId): productId is string => typeof productId === "string")
    : undefined;

  await validateOrderReferences(tenantId, {
    ...input,
    productIds,
  });

  if (
    input.orderNumber !== undefined &&
    input.orderNumber !== existingOrder.orderNumber
  ) {
    await ensureOrderNumberAvailable(tenantId, input.orderNumber, orderId);
  }

  const db = getDatabase();
  const updatedAt = new Date();
  const updateValues: OrderUpdateValues = { updatedAt };
  const changedFields: string[] = [];

  if (input.orderNumber !== undefined) {
    updateValues.orderNumber = input.orderNumber;
    changedFields.push("orderNumber");
  }

  if (input.customerContactId !== undefined) {
    updateValues.customerContactId = input.customerContactId;
    changedFields.push("customerContactId");
  }

  if (input.merchantContactId !== undefined) {
    updateValues.merchantContactId = input.merchantContactId;
    changedFields.push("merchantContactId");
  }

  if (input.agentContactId !== undefined) {
    updateValues.agentContactId = input.agentContactId;
    changedFields.push("agentContactId");
  }

  if (input.sourceBundleId !== undefined) {
    updateValues.sourceBundleId = input.sourceBundleId;
    changedFields.push("sourceBundleId");
  }

  if (input.status !== undefined) {
    updateValues.status = input.status;
    changedFields.push("status");
  }

  if (input.paymentStatus !== undefined) {
    updateValues.paymentStatus = input.paymentStatus;
    changedFields.push("paymentStatus");
  }

  if (input.deliveryStatus !== undefined) {
    updateValues.deliveryStatus = input.deliveryStatus;
    changedFields.push("deliveryStatus");
  }

  if (input.currency !== undefined) {
    updateValues.currency = input.currency;
    changedFields.push("currency");
  }

  if (input.notes !== undefined) {
    updateValues.notes = input.notes;
    changedFields.push("notes");
  }

  if (normalizedItems !== undefined) {
    updateValues.totalAmountMinor =
      calculateOrderTotalAmountMinor(normalizedItems);
    changedFields.push("items", "totalAmountMinor");
  }

  const updatedOrder = await db.transaction(async (transaction) => {
    const orderRows = await transaction
      .update(orders)
      .set(updateValues)
      .where(
        and(
          eq(orders.id, orderId),
          eq(orders.tenantId, tenantId),
          isNull(orders.deletedAt),
        ),
      )
      .returning();

    const order = orderRows[0];

    if (!order) {
      throw new AppError({
        code: "ORDER_UPDATE_FAILED",
        message: "Order could not be updated.",
        statusCode: 500,
      });
    }

    if (normalizedItems !== undefined) {
      await transaction
        .delete(orderItems)
        .where(
          and(
            eq(orderItems.tenantId, tenantId),
            eq(orderItems.orderId, orderId),
          ),
        );

      await transaction.insert(orderItems).values(
        normalizedItems.map((item) => ({
          tenantId,
          orderId,
          productId: item.productId,
          title: item.title,
          quantity: item.quantity,
          unitAmountMinor: item.unitAmountMinor,
          totalAmountMinor: item.totalAmountMinor,
          currency: item.currency,
        })),
      );
    } else if (input.currency !== undefined) {
      await transaction
        .update(orderItems)
        .set({ currency: input.currency })
        .where(
          and(
            eq(orderItems.tenantId, tenantId),
            eq(orderItems.orderId, orderId),
          ),
        );
    }

    await transaction.insert(auditLogs).values({
      tenantId,
      actorUserId,
      action: "order.updated",
      entityType: "order",
      entityId: orderId,
      metadata: {
        changedFields,
        replacedItems: normalizedItems !== undefined,
        itemCount: normalizedItems?.length ?? null,
        productIds: productIds ?? null,
      },
    });

    return order;
  });

  const itemsByOrderId = await loadItemsByOrderId(tenantId, [orderId]);

  return toOrderDto(updatedOrder, itemsByOrderId.get(orderId) ?? []);
}
