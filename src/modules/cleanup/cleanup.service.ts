import { and, asc, eq, inArray, isNull, lt } from "drizzle-orm";

import { getDatabase } from "../../db/client.ts";
import {
  auditLogs,
  mediaObjects,
  whatsappMessages,
} from "../../db/schema.ts";

const defaultCleanupBatchSize = 100;

export type TemporaryMediaObjectForCleanup = {
  id: string;
  tenantId: string;
  whatsappMessageId: string | null;
  bucket: string;
  objectKey: string;
};

export type ExpiredWhatsappCleanupOptions = {
  now?: Date;
  limit?: number;
  deleteMediaObject?: (mediaObject: TemporaryMediaObjectForCleanup) => Promise<void>;
};

export type ExpiredWhatsappCleanupResult = {
  checkedAt: string;
  cleanedMessageCount: number;
  cleanedMediaObjectCount: number;
  auditLogCount: number;
};

type TenantCleanupCounts = {
  messageCount: number;
  mediaObjectCount: number;
};

function getCleanupLimit(limit: number | undefined): number {
  if (!limit) {
    return defaultCleanupBatchSize;
  }

  return Math.max(1, Math.min(limit, 1000));
}

function buildTenantCounts(
  messages: Array<{ id: string; tenantId: string }>,
  mediaRows: TemporaryMediaObjectForCleanup[],
): Map<string, TenantCleanupCounts> {
  const countsByTenantId = new Map<string, TenantCleanupCounts>();

  for (const message of messages) {
    const counts = countsByTenantId.get(message.tenantId) ?? {
      messageCount: 0,
      mediaObjectCount: 0,
    };

    counts.messageCount += 1;
    countsByTenantId.set(message.tenantId, counts);
  }

  for (const mediaObject of mediaRows) {
    const counts = countsByTenantId.get(mediaObject.tenantId) ?? {
      messageCount: 0,
      mediaObjectCount: 0,
    };

    counts.mediaObjectCount += 1;
    countsByTenantId.set(mediaObject.tenantId, counts);
  }

  return countsByTenantId;
}

export async function cleanupExpiredWhatsappMessages(
  options: ExpiredWhatsappCleanupOptions = {},
): Promise<ExpiredWhatsappCleanupResult> {
  const db = getDatabase();
  const now = options.now ?? new Date();
  const limit = getCleanupLimit(options.limit);

  const expiredMessageRows = await db
    .select({
      id: whatsappMessages.id,
      tenantId: whatsappMessages.tenantId,
    })
    .from(whatsappMessages)
    .where(
      and(
        eq(whatsappMessages.isTemporary, true),
        eq(whatsappMessages.isTracked, false),
        eq(whatsappMessages.isLinked, false),
        lt(whatsappMessages.expiresAt, now),
        isNull(whatsappMessages.deletedAt),
      ),
    )
    .orderBy(asc(whatsappMessages.expiresAt), asc(whatsappMessages.id))
    .limit(limit);

  if (expiredMessageRows.length === 0) {
    return {
      checkedAt: now.toISOString(),
      cleanedMessageCount: 0,
      cleanedMediaObjectCount: 0,
      auditLogCount: 0,
    };
  }

  const messageIds = expiredMessageRows.map((message) => message.id);
  const mediaRows = await db
    .select({
      id: mediaObjects.id,
      tenantId: mediaObjects.tenantId,
      whatsappMessageId: mediaObjects.whatsappMessageId,
      bucket: mediaObjects.bucket,
      objectKey: mediaObjects.objectKey,
    })
    .from(mediaObjects)
    .where(
      and(
        inArray(mediaObjects.whatsappMessageId, messageIds),
        eq(mediaObjects.isTemporary, true),
        isNull(mediaObjects.deletedAt),
      ),
    );

  if (options.deleteMediaObject) {
    for (const mediaObject of mediaRows) {
      await options.deleteMediaObject(mediaObject);
    }
  }

  const countsByTenantId = buildTenantCounts(expiredMessageRows, mediaRows);
  const auditLogValues = Array.from(countsByTenantId.entries()).map(
    ([tenantId, counts]) => ({
      tenantId,
      actorUserId: null,
      action: "cleanup.expired_whatsapp_messages",
      entityType: "whatsapp_message",
      entityId: null,
      metadata: {
        messageCount: counts.messageCount,
        mediaObjectCount: counts.mediaObjectCount,
        cleanedAt: now.toISOString(),
      },
      createdAt: now,
    }),
  );

  await db.transaction(async (transaction) => {
    if (mediaRows.length > 0) {
      await transaction
        .update(mediaObjects)
        .set({
          deletedAt: now,
        })
        .where(
          and(
            inArray(
              mediaObjects.id,
              mediaRows.map((mediaObject) => mediaObject.id),
            ),
            eq(mediaObjects.isTemporary, true),
            isNull(mediaObjects.deletedAt),
          ),
        );
    }

    await transaction
      .update(whatsappMessages)
      .set({
        bodyText: null,
        rawPayloadJson: {
          cleaned: true,
          reason: "expired_temporary_message",
          cleanedAt: now.toISOString(),
        },
        deletedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          inArray(whatsappMessages.id, messageIds),
          eq(whatsappMessages.isTemporary, true),
          eq(whatsappMessages.isTracked, false),
          eq(whatsappMessages.isLinked, false),
          lt(whatsappMessages.expiresAt, now),
          isNull(whatsappMessages.deletedAt),
        ),
      );

    if (auditLogValues.length > 0) {
      await transaction.insert(auditLogs).values(auditLogValues);
    }
  });

  return {
    checkedAt: now.toISOString(),
    cleanedMessageCount: expiredMessageRows.length,
    cleanedMediaObjectCount: mediaRows.length,
    auditLogCount: auditLogValues.length,
  };
}
