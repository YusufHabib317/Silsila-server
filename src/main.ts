import { env } from "./config/env.ts";
import { closeDatabase } from "./db/client.ts";
import { buildServer } from "./server.ts";

const app = await buildServer();

const close = async (signal: string): Promise<void> => {
  app.log.info({ signal }, "Shutting down API server");
  await closeDatabase();
  await app.close();
  process.exit(0);
};

process.on("SIGINT", () => {
  void close("SIGINT");
});

process.on("SIGTERM", () => {
  void close("SIGTERM");
});

try {
  await app.listen({
    host: env.HOST,
    port: env.PORT,
  });
} catch (error) {
  app.log.error({ err: error }, "API server failed to start");
  process.exit(1);
}
