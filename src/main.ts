import { env } from "./config/env.ts";
import { parsePortArgument } from "./config/cli.ts";
import { closeDatabase } from "./db/client.ts";
import { buildServer } from "./server.ts";

const resolvePort = (): number => {
  try {
    return parsePortArgument() ?? env.PORT;
  } catch (error) {
    console.error(
      "Invalid port argument",
      error instanceof Error ? error.message : error,
    );
    process.exit(1);
  }
};

const port = resolvePort();
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
    port,
  });
} catch (error) {
  app.log.error({ err: error }, "API server failed to start");
  process.exit(1);
}
