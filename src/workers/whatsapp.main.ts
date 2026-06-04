import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  type WASocket,
} from "@whiskeysockets/baileys";
import pino from "pino";

import { env } from "../config/env.ts";
import { closeDatabase, isDatabaseConfigured } from "../db/client.ts";
import { useDatabaseBaileysAuthState } from "../modules/whatsapp/whatsapp.auth-store.ts";
import { handleBaileysIncomingMessage } from "../modules/whatsapp/whatsapp.baileys.ts";
import {
  listRunnableWhatsappAccountsForWorker,
  setWhatsappAccountQrCode,
  updateWhatsappAccountConnectionStatus,
  type WorkerRunnableWhatsappAccount,
} from "../modules/whatsapp/whatsapp.worker-state.ts";

const reconnectDelayMs = 5_000;

type WhatsappWorkerAccountConfig = {
  tenantId: string;
  whatsappAccountId: string;
};

type ManagedWhatsappSocket = {
  config: WhatsappWorkerAccountConfig;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  socket: WASocket | null;
  isConnecting: boolean;
  isStopping: boolean;
};

type StatusCodeContainer = {
  output?: {
    statusCode?: unknown;
  };
  statusCode?: unknown;
};

const managedSockets = new Map<string, ManagedWhatsappSocket>();
let syncTimer: ReturnType<typeof setInterval> | null = null;
let isShuttingDown = false;
let isSyncing = false;

const logger = pino({
  level: env.LOG_LEVEL,
}).child({
  module: "whatsapp-worker",
});

function assertWorkerCanStart(): void {
  if (!isDatabaseConfigured()) {
    throw new Error("DATABASE_URL is required to run the WhatsApp worker.");
  }
}

function socketKey(tenantId: string, whatsappAccountId: string): string {
  return `${tenantId}:${whatsappAccountId}`;
}

function buildAccountConfig(
  account: WorkerRunnableWhatsappAccount,
): WhatsappWorkerAccountConfig {
  return {
    tenantId: account.tenantId,
    whatsappAccountId: account.whatsappAccountId,
  };
}

function getDisconnectStatusCode(error: unknown): number | null {
  if (!error || typeof error !== "object") {
    return null;
  }

  const container = error as StatusCodeContainer;
  const nestedStatusCode = container.output?.statusCode;

  if (typeof nestedStatusCode === "number") {
    return nestedStatusCode;
  }

  return typeof container.statusCode === "number" ? container.statusCode : null;
}

async function updateConnectionStatus(
  config: WhatsappWorkerAccountConfig,
  status: Parameters<typeof updateWhatsappAccountConnectionStatus>[2],
  metadata: Record<string, unknown> = {},
): Promise<void> {
  try {
    await updateWhatsappAccountConnectionStatus(
      config.tenantId,
      config.whatsappAccountId,
      status,
      metadata,
    );
  } catch (error) {
    logger.error(
      {
        err: error,
        tenantId: config.tenantId,
        whatsappAccountId: config.whatsappAccountId,
        status,
      },
      "Failed to update WhatsApp account status",
    );
  }
}

function scheduleReconnect(managedSocket: ManagedWhatsappSocket): void {
  if (
    isShuttingDown ||
    managedSocket.isStopping ||
    managedSocket.reconnectTimer
  ) {
    return;
  }

  managedSocket.reconnectTimer = setTimeout(() => {
    managedSocket.reconnectTimer = null;
    void connectManagedSocket(managedSocket);
  }, reconnectDelayMs);
}

async function connectManagedSocket(
  managedSocket: ManagedWhatsappSocket,
): Promise<void> {
  if (
    isShuttingDown ||
    managedSocket.isStopping ||
    managedSocket.isConnecting
  ) {
    return;
  }

  managedSocket.isConnecting = true;
  const config = managedSocket.config;

  try {
    await updateConnectionStatus(config, "connecting");

    const { state, saveCreds } = await useDatabaseBaileysAuthState(
      config.tenantId,
      config.whatsappAccountId,
    );
    const { version, isLatest } = await fetchLatestBaileysVersion();

    logger.info(
      {
        tenantId: config.tenantId,
        whatsappAccountId: config.whatsappAccountId,
        version: version.join("."),
        isLatest,
      },
      "Starting WhatsApp socket",
    );

    const socket = makeWASocket({
      auth: state,
      browser: ["WA Commerce", "Chrome", "1.0.0"],
      getMessage: async () => undefined,
      logger,
      markOnlineOnConnect: false,
      shouldSyncHistoryMessage: () => false,
      syncFullHistory: false,
      version,
    });

    managedSocket.socket = socket;

    socket.ev.on("creds.update", saveCreds);

    socket.ev.on("connection.update", (update) => {
      void (async () => {
        if (managedSocket.isStopping) {
          return;
        }

        if (update.qr) {
          const qrExpiresAt = await setWhatsappAccountQrCode(
            config.tenantId,
            config.whatsappAccountId,
            update.qr,
          );
          logger.info(
            {
              tenantId: config.tenantId,
              whatsappAccountId: config.whatsappAccountId,
              qrExpiresAt: qrExpiresAt.toISOString(),
            },
            "WhatsApp QR is ready",
          );
        }

        if (update.connection === "connecting") {
          await updateConnectionStatus(config, "connecting");
          return;
        }

        if (update.connection === "open") {
          await updateConnectionStatus(config, "connected", {
            isNewLogin: update.isNewLogin ?? false,
          });
          return;
        }

        if (update.connection !== "close") {
          return;
        }

        managedSocket.socket = null;
        const statusCode = getDisconnectStatusCode(update.lastDisconnect?.error);
        const wasLoggedOut = statusCode === DisconnectReason.loggedOut;
        await updateConnectionStatus(
          config,
          wasLoggedOut ? "expired" : "reconnecting",
          {
            statusCode,
            shouldReconnect: !wasLoggedOut,
          },
        );

        logger.warn(
          {
            tenantId: config.tenantId,
            whatsappAccountId: config.whatsappAccountId,
            statusCode,
            shouldReconnect: !wasLoggedOut,
          },
          "WhatsApp socket closed",
        );

        if (!wasLoggedOut) {
          scheduleReconnect(managedSocket);
        }
      })();
    });

    socket.ev.on("messages.upsert", (event) => {
      void (async () => {
        for (const message of event.messages) {
          try {
            const result = await handleBaileysIncomingMessage({
              tenantId: config.tenantId,
              whatsappAccountId: config.whatsappAccountId,
              message,
            });

            if (result?.wasCreated) {
              logger.info(
                {
                  tenantId: config.tenantId,
                  whatsappAccountId: config.whatsappAccountId,
                  messageId: result.messageId,
                  chatId: result.chatId,
                },
                "Stored incoming WhatsApp message",
              );
            }
          } catch (error) {
            logger.error(
              {
                err: error,
                tenantId: config.tenantId,
                whatsappAccountId: config.whatsappAccountId,
                externalMessageId: message.key.id,
                chatId: message.key.remoteJid,
              },
              "Failed to store incoming WhatsApp message",
            );
          }
        }
      })();
    });
  } catch (error) {
    await updateConnectionStatus(config, "failed", {
      reason: error instanceof Error ? error.message : "unknown",
    });
    logger.error(
      {
        err: error,
        tenantId: config.tenantId,
        whatsappAccountId: config.whatsappAccountId,
      },
      "Failed to start WhatsApp socket",
    );
  } finally {
    managedSocket.isConnecting = false;
  }
}

async function startManagedSocket(
  config: WhatsappWorkerAccountConfig,
): Promise<void> {
  const key = socketKey(config.tenantId, config.whatsappAccountId);
  const existingSocket = managedSockets.get(key);

  if (existingSocket) {
    return;
  }

  const managedSocket: ManagedWhatsappSocket = {
    config,
    reconnectTimer: null,
    socket: null,
    isConnecting: false,
    isStopping: false,
  };

  managedSockets.set(key, managedSocket);
  await connectManagedSocket(managedSocket);
}

async function stopManagedSocket(
  managedSocket: ManagedWhatsappSocket,
  reason: string,
): Promise<void> {
  managedSocket.isStopping = true;

  if (managedSocket.reconnectTimer) {
    clearTimeout(managedSocket.reconnectTimer);
    managedSocket.reconnectTimer = null;
  }

  managedSockets.delete(
    socketKey(
      managedSocket.config.tenantId,
      managedSocket.config.whatsappAccountId,
    ),
  );

  if (managedSocket.socket) {
    await managedSocket.socket.end(new Error(reason));
    managedSocket.socket = null;
  }
}

async function syncRunnableAccounts(): Promise<void> {
  if (isSyncing || isShuttingDown) {
    return;
  }

  isSyncing = true;

  try {
    const runnableAccounts = await listRunnableWhatsappAccountsForWorker();
    const desiredKeys = new Set(
      runnableAccounts.map((account) =>
        socketKey(account.tenantId, account.whatsappAccountId),
      ),
    );

    for (const account of runnableAccounts) {
      await startManagedSocket(buildAccountConfig(account));
    }

    for (const [key, managedSocket] of managedSockets.entries()) {
      if (!desiredKeys.has(key)) {
        logger.info(
          {
            tenantId: managedSocket.config.tenantId,
            whatsappAccountId: managedSocket.config.whatsappAccountId,
          },
          "Stopping WhatsApp socket because account is no longer runnable",
        );
        await stopManagedSocket(managedSocket, "Account is no longer runnable");
      }
    }
  } catch (error) {
    logger.error({ err: error }, "WhatsApp worker sync failed");
  } finally {
    isSyncing = false;
  }
}

async function shutdown(signal: string): Promise<void> {
  isShuttingDown = true;

  if (syncTimer) {
    clearInterval(syncTimer);
    syncTimer = null;
  }

  logger.info({ signal }, "Shutting down WhatsApp worker");

  for (const managedSocket of Array.from(managedSockets.values())) {
    await stopManagedSocket(managedSocket, `Worker shutdown: ${signal}`);
  }

  await closeDatabase();
  process.exit(0);
}

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});

try {
  assertWorkerCanStart();

  logger.info(
    {
      mode: "database_poll",
      pollIntervalMs: env.WHATSAPP_WORKER_POLL_INTERVAL_MS,
    },
    "Starting WhatsApp worker",
  );

  await syncRunnableAccounts();
  syncTimer = setInterval(() => {
    void syncRunnableAccounts();
  }, env.WHATSAPP_WORKER_POLL_INTERVAL_MS);
} catch (error) {
  logger.error({ err: error }, "WhatsApp worker failed to start");
  await closeDatabase();
  process.exit(1);
}
