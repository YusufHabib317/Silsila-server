import { env } from "../config/env.ts";
import { closeDatabase } from "../db/client.ts";
import { cleanupExpiredWhatsappMessages } from "../modules/cleanup/cleanup.service.ts";

let isRunning = false;

async function runCleanupCycle(): Promise<void> {
  if (isRunning) {
    console.info(
      JSON.stringify({
        module: "cleanup-worker",
        action: "cleanup.skipped",
        reason: "previous_cycle_still_running",
        checkedAt: new Date().toISOString(),
      }),
    );
    return;
  }

  isRunning = true;

  try {
    const result = await cleanupExpiredWhatsappMessages();

    console.info(
      JSON.stringify({
        module: "cleanup-worker",
        action: "cleanup.completed",
        status: "ok",
        ...result,
      }),
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        module: "cleanup-worker",
        action: "cleanup.failed",
        status: "error",
        message: error instanceof Error ? error.message : "Unknown error",
        checkedAt: new Date().toISOString(),
      }),
    );
  } finally {
    isRunning = false;
  }
}

async function shutdown(signal: string): Promise<void> {
  console.info(
    JSON.stringify({
      module: "cleanup-worker",
      action: "worker.shutdown",
      signal,
      checkedAt: new Date().toISOString(),
    }),
  );
  await closeDatabase();
  process.exit(0);
}

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});

if (process.argv.includes("--once")) {
  await runCleanupCycle();
  await closeDatabase();
  process.exit(0);
}

console.info(
  JSON.stringify({
    module: "cleanup-worker",
    action: "worker.started",
    intervalMs: env.CLEANUP_WORKER_INTERVAL_MS,
    checkedAt: new Date().toISOString(),
  }),
);

await runCleanupCycle();
setInterval(() => {
  void runCleanupCycle();
}, env.CLEANUP_WORKER_INTERVAL_MS);
