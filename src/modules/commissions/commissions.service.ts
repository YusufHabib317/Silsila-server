import {
  and,
  desc,
  eq,
  isNull,
  lt,
  or,
  type SQL,
} from "drizzle-orm";

import { getDatabase } from "../../db/client.ts";
import {
  auditLogs,
  commissions,
  contacts,
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
  CommissionListQuery,
  CommissionRecordTypeInput,
  CommissionStatusInput,
  CommissionTypeInput,
  CreateCommissionInput,
  UpdateCommissionInput,
} from "./commissions.schemas.ts";

type CommissionRecord = typeof commissions.$inferSelect;

type CommissionDto = {
  id: string;
  orderId: string | null;
  productId: string | null;
  contactId: string;
  commissionType: CommissionRecordTypeInput;
  amountMinor: number | null;
  percentage: number | null;
  currency: string;
  status: CommissionStatusInput;
  paidAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type CommissionListResult = {
  items: CommissionDto[];
  pageInfo: {
    limit: number;
    nextCursor: string | null;
    hasMore: boolean;
  };
};

type CommissionReferenceValues = {
  orderId?: string | null | undefined;
  productId?: string | null | undefined;
  contactId?: string | undefined;
};

type CommissionValueValues = {
  commissionType: CommissionRecordTypeInput;
  amountMinor: number | null | undefined;
  percentage: number | null | undefined;
  status: CommissionStatusInput;
  paidAt: Date | null | undefined;
};

type CommissionUpdateValues = {
  orderId?: string | null;
  productId?: string | null;
  contactId?: string;
  commissionType?: CommissionTypeInput;
  amountMinor?: number | null;
  percentage?: string | null;
  currency?: string;
  status?: CommissionStatusInput;
  paidAt?: Date | null;
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

function toNullableIsoDate(value: Date | null): string | null {
  return value ? toIsoDate(value) : null;
}

function toPercentageDto(value: string | null): number | null {
  return value === null ? null : Number(value);
}

function toStoredPercentage(value: number | null | undefined): string | null {
  return value === undefined || value === null ? null : value.toFixed(2);
}

function hasValue<TValue>(value: TValue | null | undefined): value is TValue {
  return value !== undefined && value !== null;
}

function validateCommissionValues(values: CommissionValueValues): void {
  if (
    values.commissionType === "fixed_amount" ||
    values.commissionType === "manual"
  ) {
    if (!hasValue(values.amountMinor)) {
      throw new AppError({
        code: "COMMISSION_AMOUNT_REQUIRED",
        message: "Fixed amount and manual commissions require amountMinor.",
        statusCode: 400,
      });
    }

    if (hasValue(values.percentage)) {
      throw new AppError({
        code: "COMMISSION_PERCENTAGE_NOT_ALLOWED",
        message: "Fixed amount and manual commissions cannot include percentage.",
        statusCode: 400,
      });
    }
  }

  if (values.commissionType === "percentage") {
    if (!hasValue(values.percentage)) {
      throw new AppError({
        code: "COMMISSION_PERCENTAGE_REQUIRED",
        message: "Percentage commissions require percentage.",
        statusCode: 400,
      });
    }

    if (hasValue(values.amountMinor)) {
      throw new AppError({
        code: "COMMISSION_AMOUNT_NOT_ALLOWED",
        message: "Percentage commissions cannot include amountMinor in v1.",
        statusCode: 400,
      });
    }
  }

  if (hasValue(values.paidAt) && values.status !== "paid") {
    throw new AppError({
      code: "COMMISSION_PAID_AT_STATUS_INVALID",
      message: "paidAt can only be set when commission status is paid.",
      statusCode: 400,
    });
  }
}

function toCommissionDto(commission: CommissionRecord): CommissionDto {
  return {
    id: commission.id,
    orderId: commission.orderId,
    productId: commission.productId,
    contactId: commission.contactId,
    commissionType: commission.commissionType,
    amountMinor: commission.amountMinor,
    percentage: toPercentageDto(commission.percentage),
    currency: commission.currency,
    status: commission.status,
    paidAt: toNullableIsoDate(commission.paidAt),
    createdAt: toIsoDate(commission.createdAt),
    updatedAt: toIsoDate(commission.updatedAt),
  };
}

async function validateCommissionReferences(
  tenantId: string,
  references: CommissionReferenceValues,
): Promise<void> {
  const db = getDatabase();

  if (references.contactId !== undefined) {
    const contactRows = await db
      .select({ id: contacts.id })
      .from(contacts)
      .where(
        and(
          eq(contacts.tenantId, tenantId),
          eq(contacts.id, references.contactId),
          isNull(contacts.deletedAt),
        ),
      )
      .limit(1);

    if (!contactRows[0]) {
      throw new AppError({
        code: "COMMISSION_CONTACT_REFERENCE_INVALID",
        message: "Referenced contact was not found for this tenant.",
        statusCode: 400,
      });
    }
  }

  if (typeof references.orderId === "string") {
    const orderRows = await db
      .select({ id: orders.id })
      .from(orders)
      .where(
        and(
          eq(orders.tenantId, tenantId),
          eq(orders.id, references.orderId),
          isNull(orders.deletedAt),
        ),
      )
      .limit(1);

    if (!orderRows[0]) {
      throw new AppError({
        code: "COMMISSION_ORDER_REFERENCE_INVALID",
        message: "Referenced order was not found for this tenant.",
        statusCode: 400,
      });
    }
  }

  if (typeof references.productId === "string") {
    const productRows = await db
      .select({ id: products.id })
      .from(products)
      .where(
        and(
          eq(products.tenantId, tenantId),
          eq(products.id, references.productId),
          isNull(products.deletedAt),
        ),
      )
      .limit(1);

    if (!productRows[0]) {
      throw new AppError({
        code: "COMMISSION_PRODUCT_REFERENCE_INVALID",
        message: "Referenced product was not found for this tenant.",
        statusCode: 400,
      });
    }
  }

  if (
    typeof references.orderId === "string" &&
    typeof references.productId === "string"
  ) {
    const itemRows = await db
      .select({ id: orderItems.id })
      .from(orderItems)
      .where(
        and(
          eq(orderItems.tenantId, tenantId),
          eq(orderItems.orderId, references.orderId),
          eq(orderItems.productId, references.productId),
        ),
      )
      .limit(1);

    if (!itemRows[0]) {
      throw new AppError({
        code: "COMMISSION_ORDER_PRODUCT_MISMATCH",
        message: "Referenced product is not on the referenced order.",
        statusCode: 400,
      });
    }
  }
}

async function findCommissionForTenant(
  tenantId: string,
  commissionId: string,
): Promise<CommissionRecord> {
  const db = getDatabase();
  const rows = await db
    .select()
    .from(commissions)
    .where(and(eq(commissions.id, commissionId), eq(commissions.tenantId, tenantId)))
    .limit(1);

  const commission = rows[0];

  if (!commission) {
    throw new AppError({
      code: "COMMISSION_NOT_FOUND",
      message: "Commission was not found.",
      statusCode: 404,
    });
  }

  return commission;
}

export async function listCommissions(
  tenantId: string,
  query: CommissionListQuery,
): Promise<CommissionListResult> {
  await validateCommissionReferences(tenantId, query);

  const db = getDatabase();
  const conditions: SQL[] = [eq(commissions.tenantId, tenantId)];

  if (query.orderId) {
    conditions.push(eq(commissions.orderId, query.orderId));
  }

  if (query.productId) {
    conditions.push(eq(commissions.productId, query.productId));
  }

  if (query.contactId) {
    conditions.push(eq(commissions.contactId, query.contactId));
  }

  if (query.commissionType) {
    conditions.push(eq(commissions.commissionType, query.commissionType));
  }

  if (query.status) {
    conditions.push(eq(commissions.status, query.status));
  }

  if (query.currency) {
    conditions.push(eq(commissions.currency, query.currency));
  }

  if (query.cursor) {
    const cursor = decodeDateIdCursor(query.cursor);
    const cursorCondition = or(
      lt(commissions.createdAt, cursor.createdAt),
      and(
        eq(commissions.createdAt, cursor.createdAt),
        lt(commissions.id, cursor.id),
      ),
    );

    if (cursorCondition) {
      conditions.push(cursorCondition);
    }
  }

  const rows = await db
    .select()
    .from(commissions)
    .where(combineConditions(conditions))
    .orderBy(desc(commissions.createdAt), desc(commissions.id))
    .limit(query.limit + 1);

  const pageRows = rows.slice(0, query.limit);
  const nextRow = rows[query.limit];
  const cursorRow = pageRows[pageRows.length - 1];

  return {
    items: pageRows.map(toCommissionDto),
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

export async function getCommission(
  tenantId: string,
  commissionId: string,
): Promise<CommissionDto> {
  const commission = await findCommissionForTenant(tenantId, commissionId);

  return toCommissionDto(commission);
}

export async function createCommission(
  tenantId: string,
  actorUserId: string,
  input: CreateCommissionInput,
): Promise<CommissionDto> {
  await validateCommissionReferences(tenantId, input);
  validateCommissionValues({
    commissionType: input.commissionType,
    amountMinor: input.amountMinor,
    percentage: input.percentage,
    status: input.status,
    paidAt: input.paidAt,
  });

  const db = getDatabase();
  const createdCommission = await db.transaction(async (transaction) => {
    const commissionRows = await transaction
      .insert(commissions)
      .values({
        tenantId,
        orderId: input.orderId ?? null,
        productId: input.productId ?? null,
        contactId: input.contactId,
        commissionType: input.commissionType,
        amountMinor: input.amountMinor ?? null,
        percentage: toStoredPercentage(input.percentage),
        currency: input.currency,
        status: input.status,
        paidAt: input.paidAt ?? null,
      })
      .returning();

    const commission = commissionRows[0];

    if (!commission) {
      throw new AppError({
        code: "COMMISSION_CREATE_FAILED",
        message: "Commission could not be created.",
        statusCode: 500,
      });
    }

    await transaction.insert(auditLogs).values({
      tenantId,
      actorUserId,
      action: "commission.created",
      entityType: "commission",
      entityId: commission.id,
      metadata: {
        orderId: input.orderId ?? null,
        productId: input.productId ?? null,
        contactId: input.contactId,
        commissionType: input.commissionType,
      },
    });

    return commission;
  });

  return toCommissionDto(createdCommission);
}

export async function updateCommission(
  tenantId: string,
  actorUserId: string,
  commissionId: string,
  input: UpdateCommissionInput,
): Promise<CommissionDto> {
  const existingCommission = await findCommissionForTenant(tenantId, commissionId);
  const nextCommissionType =
    input.commissionType ?? existingCommission.commissionType;
  const nextAmountMinor = input.amountMinor !== undefined
    ? input.amountMinor
    : existingCommission.amountMinor;
  const nextPercentage = input.percentage !== undefined
    ? input.percentage
    : toPercentageDto(existingCommission.percentage);
  const nextStatus = input.status ?? existingCommission.status;
  const nextPaidAt = input.paidAt !== undefined
    ? input.paidAt
    : existingCommission.paidAt;

  await validateCommissionReferences(tenantId, {
    orderId: input.orderId !== undefined
      ? input.orderId
      : existingCommission.orderId,
    productId: input.productId !== undefined
      ? input.productId
      : existingCommission.productId,
    contactId: input.contactId ?? existingCommission.contactId,
  });
  validateCommissionValues({
    commissionType: nextCommissionType,
    amountMinor: nextAmountMinor,
    percentage: nextPercentage,
    status: nextStatus,
    paidAt: nextPaidAt,
  });

  const db = getDatabase();
  const updatedAt = new Date();
  const updateValues: CommissionUpdateValues = { updatedAt };
  const changedFields: string[] = [];

  if (input.orderId !== undefined) {
    updateValues.orderId = input.orderId;
    changedFields.push("orderId");
  }

  if (input.productId !== undefined) {
    updateValues.productId = input.productId;
    changedFields.push("productId");
  }

  if (input.contactId !== undefined) {
    updateValues.contactId = input.contactId;
    changedFields.push("contactId");
  }

  if (input.commissionType !== undefined) {
    updateValues.commissionType = input.commissionType;
    changedFields.push("commissionType");
  }

  if (input.amountMinor !== undefined) {
    updateValues.amountMinor = input.amountMinor;
    changedFields.push("amountMinor");
  }

  if (input.percentage !== undefined) {
    updateValues.percentage = toStoredPercentage(input.percentage);
    changedFields.push("percentage");
  }

  if (input.currency !== undefined) {
    updateValues.currency = input.currency;
    changedFields.push("currency");
  }

  if (input.status !== undefined) {
    updateValues.status = input.status;
    changedFields.push("status");
  }

  if (input.paidAt !== undefined) {
    updateValues.paidAt = input.paidAt;
    changedFields.push("paidAt");
  }

  const updatedCommission = await db.transaction(async (transaction) => {
    const commissionRows = await transaction
      .update(commissions)
      .set(updateValues)
      .where(
        and(
          eq(commissions.id, commissionId),
          eq(commissions.tenantId, tenantId),
        ),
      )
      .returning();

    const commission = commissionRows[0];

    if (!commission) {
      throw new AppError({
        code: "COMMISSION_UPDATE_FAILED",
        message: "Commission could not be updated.",
        statusCode: 500,
      });
    }

    await transaction.insert(auditLogs).values({
      tenantId,
      actorUserId,
      action: "commission.updated",
      entityType: "commission",
      entityId: commissionId,
      metadata: {
        changedFields,
      },
    });

    return commission;
  });

  return toCommissionDto(updatedCommission);
}
