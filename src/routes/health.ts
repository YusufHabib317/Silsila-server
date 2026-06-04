import type { FastifyInstance } from "fastify";

import { env } from "../config/env.ts";
import { checkDatabaseConnection } from "../db/client.ts";
import { requirePlatformAdmin } from "../modules/auth/auth.middleware.ts";

export async function registerHealthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/health", async () => ({
    status: "ok",
    service: "wa-commerce-server",
    environment: env.NODE_ENV,
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    dependencies: {
      databaseConfigured: Boolean(env.DATABASE_URL),
      r2Configured: Boolean(
        env.R2_BUCKET_NAME &&
          env.R2_ENDPOINT &&
          env.R2_ACCESS_KEY_ID &&
          env.R2_SECRET_ACCESS_KEY,
      ),
    },
  }));

  app.get("/ready", async (_request, reply) => {
    const database = await checkDatabaseConnection();
    const isReady = database.status !== "error";

    await reply.status(isReady ? 200 : 503).send({
      status: isReady ? "ready" : "not_ready",
      dependencies: {
        database,
        r2: {
          configured: Boolean(
            env.R2_BUCKET_NAME &&
              env.R2_ENDPOINT &&
              env.R2_ACCESS_KEY_ID &&
              env.R2_SECRET_ACCESS_KEY,
          ),
        },
      },
      checkedAt: new Date().toISOString(),
    });
  });

  app.get("/admin/system-health", { preHandler: requirePlatformAdmin }, async () => ({
    api: {
      status: "ok",
      service: "api",
      checkedAt: new Date().toISOString(),
    },
    workers: {
      whatsapp: "not_started",
      cleanup: "not_started",
    },
    storage: {
      r2Configured: Boolean(env.R2_BUCKET_NAME),
    },
  }));
}
