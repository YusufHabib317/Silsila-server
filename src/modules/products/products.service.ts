import {
  and,
  desc,
  eq,
  ilike,
  inArray,
  isNull,
  lt,
  or,
  type SQL,
} from "drizzle-orm";

import { getDatabase } from "../../db/client.ts";
import {
  auditLogs,
  contacts,
  messageBundles,
  products,
} from "../../db/schema.ts";
import { AppError } from "../../lib/app-error.ts";
import {
  decodeDateIdCursor,
  encodeDateIdCursor,
} from "../../lib/pagination.ts";
import type {
  CreateProductInput,
  ProductListQuery,
  ProductOwnerTypeInput,
  ProductStatusInput,
  StockStatusInput,
  UpdateProductInput,
} from "./products.schemas.ts";

type ProductRecord = typeof products.$inferSelect;

type ProductDto = {
  id: string;
  name: string;
  description: string | null;
  categoryId: string | null;
  ownerType: ProductOwnerTypeInput;
  ownerContactId: string | null;
  merchantContactId: string | null;
  sourceBundleId: string | null;
  costAmountMinor: number | null;
  saleAmountMinor: number | null;
  agentAmountMinor: number | null;
  currency: string;
  stockStatus: StockStatusInput;
  productStatus: ProductStatusInput;
  notes: string | null;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
};

type ProductListResult = {
  items: ProductDto[];
  pageInfo: {
    limit: number;
    nextCursor: string | null;
    hasMore: boolean;
  };
};

type ProductReferenceValues = {
  ownerContactId?: string | null | undefined;
  merchantContactId?: string | null | undefined;
  sourceBundleId?: string | null | undefined;
};

type ProductUpdateValues = {
  name?: string;
  description?: string | null;
  categoryId?: string | null;
  ownerType?: ProductOwnerTypeInput;
  ownerContactId?: string | null;
  merchantContactId?: string | null;
  sourceBundleId?: string | null;
  costAmountMinor?: number | null;
  saleAmountMinor?: number | null;
  agentAmountMinor?: number | null;
  currency?: string;
  stockStatus?: StockStatusInput;
  productStatus?: ProductStatusInput;
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

function toProductDto(product: ProductRecord): ProductDto {
  return {
    id: product.id,
    name: product.name,
    description: product.description,
    categoryId: product.categoryId,
    ownerType: product.ownerType,
    ownerContactId: product.ownerContactId,
    merchantContactId: product.merchantContactId,
    sourceBundleId: product.sourceBundleId,
    costAmountMinor: product.costAmountMinor,
    saleAmountMinor: product.saleAmountMinor,
    agentAmountMinor: product.agentAmountMinor,
    currency: product.currency,
    stockStatus: product.stockStatus,
    productStatus: product.productStatus,
    notes: product.notes,
    createdByUserId: product.createdByUserId,
    createdAt: toIsoDate(product.createdAt),
    updatedAt: toIsoDate(product.updatedAt),
  };
}

async function validateProductReferences(
  tenantId: string,
  references: ProductReferenceValues,
): Promise<void> {
  const db = getDatabase();
  const contactIds = Array.from(
    new Set(
      [references.ownerContactId, references.merchantContactId].filter(
        (contactId): contactId is string => typeof contactId === "string",
      ),
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
        code: "PRODUCT_CONTACT_REFERENCE_INVALID",
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
        code: "PRODUCT_SOURCE_BUNDLE_REFERENCE_INVALID",
        message: "Referenced source bundle was not found for this tenant.",
        statusCode: 400,
      });
    }
  }
}

async function findProductForTenant(
  tenantId: string,
  productId: string,
): Promise<ProductRecord> {
  const db = getDatabase();
  const rows = await db
    .select()
    .from(products)
    .where(
      and(
        eq(products.id, productId),
        eq(products.tenantId, tenantId),
        isNull(products.deletedAt),
      ),
    )
    .limit(1);

  const product = rows[0];

  if (!product) {
    throw new AppError({
      code: "PRODUCT_NOT_FOUND",
      message: "Product was not found.",
      statusCode: 404,
    });
  }

  return product;
}

export async function listProducts(
  tenantId: string,
  query: ProductListQuery,
): Promise<ProductListResult> {
  await validateProductReferences(tenantId, query);

  const db = getDatabase();
  const conditions: SQL[] = [
    eq(products.tenantId, tenantId),
    isNull(products.deletedAt),
  ];

  if (query.productStatus) {
    conditions.push(eq(products.productStatus, query.productStatus));
  }

  if (query.stockStatus) {
    conditions.push(eq(products.stockStatus, query.stockStatus));
  }

  if (query.ownerType) {
    conditions.push(eq(products.ownerType, query.ownerType));
  }

  if (query.ownerContactId) {
    conditions.push(eq(products.ownerContactId, query.ownerContactId));
  }

  if (query.merchantContactId) {
    conditions.push(eq(products.merchantContactId, query.merchantContactId));
  }

  if (query.sourceBundleId) {
    conditions.push(eq(products.sourceBundleId, query.sourceBundleId));
  }

  if (query.categoryId) {
    conditions.push(eq(products.categoryId, query.categoryId));
  }

  if (query.currency) {
    conditions.push(eq(products.currency, query.currency));
  }

  if (query.search) {
    const searchPattern = `%${query.search}%`;
    const searchCondition = or(
      ilike(products.name, searchPattern),
      ilike(products.description, searchPattern),
      ilike(products.notes, searchPattern),
    );

    if (searchCondition) {
      conditions.push(searchCondition);
    }
  }

  if (query.cursor) {
    const cursor = decodeDateIdCursor(query.cursor);
    const cursorCondition = or(
      lt(products.createdAt, cursor.createdAt),
      and(eq(products.createdAt, cursor.createdAt), lt(products.id, cursor.id)),
    );

    if (cursorCondition) {
      conditions.push(cursorCondition);
    }
  }

  const rows = await db
    .select()
    .from(products)
    .where(combineConditions(conditions))
    .orderBy(desc(products.createdAt), desc(products.id))
    .limit(query.limit + 1);

  const pageRows = rows.slice(0, query.limit);
  const nextRow = rows[query.limit];

  return {
    items: pageRows.map(toProductDto),
    pageInfo: {
      limit: query.limit,
      nextCursor: nextRow
        ? encodeDateIdCursor({
            createdAt: nextRow.createdAt,
            id: nextRow.id,
          })
        : null,
      hasMore: nextRow !== undefined,
    },
  };
}

export async function getProduct(
  tenantId: string,
  productId: string,
): Promise<ProductDto> {
  const product = await findProductForTenant(tenantId, productId);

  return toProductDto(product);
}

export async function createProduct(
  tenantId: string,
  actorUserId: string,
  input: CreateProductInput,
): Promise<ProductDto> {
  await validateProductReferences(tenantId, input);

  const db = getDatabase();
  const createdProduct = await db.transaction(async (transaction) => {
    const productRows = await transaction
      .insert(products)
      .values({
        tenantId,
        name: input.name,
        description: input.description,
        categoryId: input.categoryId,
        ownerType: input.ownerType,
        ownerContactId: input.ownerContactId,
        merchantContactId: input.merchantContactId,
        sourceBundleId: input.sourceBundleId,
        costAmountMinor: input.costAmountMinor,
        saleAmountMinor: input.saleAmountMinor,
        agentAmountMinor: input.agentAmountMinor,
        currency: input.currency,
        stockStatus: input.stockStatus,
        productStatus: input.productStatus,
        notes: input.notes,
        createdByUserId: actorUserId,
      })
      .returning();

    const product = productRows[0];

    if (!product) {
      throw new AppError({
        code: "PRODUCT_CREATE_FAILED",
        message: "Product could not be created.",
        statusCode: 500,
      });
    }

    await transaction.insert(auditLogs).values({
      tenantId,
      actorUserId,
      action: "product.created",
      entityType: "product",
      entityId: product.id,
      metadata: {
        ownerContactId: input.ownerContactId ?? null,
        merchantContactId: input.merchantContactId ?? null,
        sourceBundleId: input.sourceBundleId ?? null,
      },
    });

    return product;
  });

  return toProductDto(createdProduct);
}

export async function updateProduct(
  tenantId: string,
  actorUserId: string,
  productId: string,
  input: UpdateProductInput,
): Promise<ProductDto> {
  await findProductForTenant(tenantId, productId);
  await validateProductReferences(tenantId, input);

  const db = getDatabase();
  const updatedAt = new Date();
  const updateValues: ProductUpdateValues = { updatedAt };
  const changedFields: string[] = [];

  if (input.name !== undefined) {
    updateValues.name = input.name;
    changedFields.push("name");
  }

  if (input.description !== undefined) {
    updateValues.description = input.description;
    changedFields.push("description");
  }

  if (input.categoryId !== undefined) {
    updateValues.categoryId = input.categoryId;
    changedFields.push("categoryId");
  }

  if (input.ownerType !== undefined) {
    updateValues.ownerType = input.ownerType;
    changedFields.push("ownerType");
  }

  if (input.ownerContactId !== undefined) {
    updateValues.ownerContactId = input.ownerContactId;
    changedFields.push("ownerContactId");
  }

  if (input.merchantContactId !== undefined) {
    updateValues.merchantContactId = input.merchantContactId;
    changedFields.push("merchantContactId");
  }

  if (input.sourceBundleId !== undefined) {
    updateValues.sourceBundleId = input.sourceBundleId;
    changedFields.push("sourceBundleId");
  }

  if (input.costAmountMinor !== undefined) {
    updateValues.costAmountMinor = input.costAmountMinor;
    changedFields.push("costAmountMinor");
  }

  if (input.saleAmountMinor !== undefined) {
    updateValues.saleAmountMinor = input.saleAmountMinor;
    changedFields.push("saleAmountMinor");
  }

  if (input.agentAmountMinor !== undefined) {
    updateValues.agentAmountMinor = input.agentAmountMinor;
    changedFields.push("agentAmountMinor");
  }

  if (input.currency !== undefined) {
    updateValues.currency = input.currency;
    changedFields.push("currency");
  }

  if (input.stockStatus !== undefined) {
    updateValues.stockStatus = input.stockStatus;
    changedFields.push("stockStatus");
  }

  if (input.productStatus !== undefined) {
    updateValues.productStatus = input.productStatus;
    changedFields.push("productStatus");
  }

  if (input.notes !== undefined) {
    updateValues.notes = input.notes;
    changedFields.push("notes");
  }

  const updatedProduct = await db.transaction(async (transaction) => {
    const productRows = await transaction
      .update(products)
      .set(updateValues)
      .where(
        and(
          eq(products.id, productId),
          eq(products.tenantId, tenantId),
          isNull(products.deletedAt),
        ),
      )
      .returning();

    const product = productRows[0];

    if (!product) {
      throw new AppError({
        code: "PRODUCT_UPDATE_FAILED",
        message: "Product could not be updated.",
        statusCode: 500,
      });
    }

    await transaction.insert(auditLogs).values({
      tenantId,
      actorUserId,
      action: "product.updated",
      entityType: "product",
      entityId: productId,
      metadata: {
        changedFields,
      },
    });

    return product;
  });

  return toProductDto(updatedProduct);
}
