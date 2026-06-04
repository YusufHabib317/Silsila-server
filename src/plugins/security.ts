import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import websocket from "@fastify/websocket";
import type { FastifyInstance } from "fastify";

import { env } from "../config/env.ts";

export async function registerCorePlugins(app: FastifyInstance): Promise<void> {
  await app.register(helmet);

  await app.register(cors, {
    origin(origin, callback) {
      if (origin === undefined || env.CORS_ORIGINS.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error("Origin is not allowed by CORS"), false);
    },
    credentials: true,
  });

  await app.register(cookie, {
    hook: "onRequest",
  });

  await app.register(rateLimit, {
    max: 100,
    timeWindow: "1 minute",
  });

  await app.register(websocket);
}
