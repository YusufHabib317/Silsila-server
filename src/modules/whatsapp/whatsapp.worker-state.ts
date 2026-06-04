import { and, eq, inArray, isNull } from "drizzle-orm";

import { getDatabase } from "../../db/client.ts";
import { auditLogs, whatsappAccounts } from "../../db/schema.ts";
import { AppError } from "../../lib/app-error.ts";
import type { WhatsappAccountStatusInput } from "./whatsapp.schemas.ts";

const qrTtlMs = 1000 * 60;

const disconnectedStatuses = new Set<WhatsappAccountStatusInput>([
  "disconnected",
  "expired",
  "failed",
]);

const workerRunnableStatuses: WhatsappAccountStatusInput[] = [
  "pending_qr",
  "qr_ready",
  "connecting",
  "connected",
  "reconnecting",
];

export type WorkerRunnableWhatsappAccount = {
  tenantId: string;
  whatsappAccountId: string;
  status: WhatsappAccountStatusInput;
};

export async function listRunnableWhatsappAccountsForWorker(): Promise<
  WorkerRunnableWhatsappAccount[]
> {
  const db = getDatabase();
  const rows = await db
    .select({
      tenantId: whatsappAccounts.tenantId,
      whatsappAccountId: whatsappAccounts.id,
      status: whatsappAccounts.status,
    })
    .from(whatsappAccounts)
    .where(
      and(
        inArray(whatsappAccounts.status, workerRunnableStatuses),
        isNull(whatsappAccounts.deletedAt),
      ),
    );

  return rows;
}

export async function updateWhatsappAccountConnectionStatus(
  tenantId: string,
  whatsappAccountId: string,
  status: WhatsappAccountStatusInput,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  const db = getDatabase();
  const updatedAt = new Date();
  const updateValues: Partial<typeof whatsappAccounts.$inferInsert> = {
    status,
    qrCode: null,
    qrExpiresAt: null,
    updatedAt,
  };

  if (status === "connected") {
    updateValues.lastConnectedAt = updatedAt;
  }

  if (disconnectedStatuses.has(status)) {
    updateValues.lastDisconnectedAt = updatedAt;
  }

  await db.transaction(async (transaction) => {
    const accountRows = await transaction
      .update(whatsappAccounts)
      .set(updateValues)
      .where(
        and(
          eq(whatsappAccounts.tenantId, tenantId),
          eq(whatsappAccounts.id, whatsappAccountId),
          isNull(whatsappAccounts.deletedAt),
        ),
      )
      .returning({ id: whatsappAccounts.id });

    if (!accountRows[0]) {
      throw new AppError({
        code: "WHATSAPP_ACCOUNT_NOT_FOUND",
        message: "WhatsApp account was not found.",
        statusCode: 404,
      });
    }

    await transaction.insert(auditLogs).values({
      tenantId,
      actorUserId: null,
      action: "whatsapp_account.connection_status_updated",
      entityType: "whatsapp_account",
      entityId: whatsappAccountId,
      metadata: {
        status,
        ...metadata,
      },
    });
  });
}

export async function setWhatsappAccountQrCode(
  tenantId: string,
  whatsappAccountId: string,
  qrCode: string,
  now = new Date(),
): Promise<Date> {
  const db = getDatabase();
  const qrExpiresAt = new Date(now.getTime() + qrTtlMs);

  await db.transaction(async (transaction) => {
    const accountRows = await transaction
      .update(whatsappAccounts)
      .set({
        status: "qr_ready",
        qrCode,
        qrExpiresAt,
        updatedAt: now,
      })
      .where(
        and(
          eq(whatsappAccounts.tenantId, tenantId),
          eq(whatsappAccounts.id, whatsappAccountId),
          isNull(whatsappAccounts.deletedAt),
        ),
      )
      .returning({ id: whatsappAccounts.id });

    if (!accountRows[0]) {
      throw new AppError({
        code: "WHATSAPP_ACCOUNT_NOT_FOUND",
        message: "WhatsApp account was not found.",
        statusCode: 404,
      });
    }

    await transaction.insert(auditLogs).values({
      tenantId,
      actorUserId: null,
      action: "whatsapp_account.qr_ready",
      entityType: "whatsapp_account",
      entityId: whatsappAccountId,
      metadata: {
        qrExpiresAt: qrExpiresAt.toISOString(),
      },
    });
  });

  return qrExpiresAt;
}
