import { neonConfig, Pool } from "@neondatabase/serverless";
import { sql } from "drizzle-orm";
import { drizzle, type NeonDatabase } from "drizzle-orm/neon-serverless";

import { env } from "../config/env.ts";
import * as schema from "./schema.ts";

export type AppDatabase = NeonDatabase<typeof schema>;

let pool: Pool | null = null;
let database: AppDatabase | null = null;

export function isDatabaseConfigured(): boolean {
  return Boolean(env.DATABASE_URL);
}

export function getNeonPool(): Pool {
  if (!env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not configured.");
  }

  if (!pool) {
    neonConfig.webSocketConstructor = WebSocket;
    pool = new Pool({
      connectionString: env.DATABASE_URL,
    });
    
    // Add error listener to prevent unhandled error crashes when connections close unexpectedly
    pool.on('error', (err: Error) => {
      console.error('Unexpected error on idle Neon database client', err);
    });
  }

  return pool;
}

export function getDatabase(): AppDatabase {
  if (!database) {
    const client = getNeonPool();
    database = drizzle(client, { schema });
  }

  return database;
}

export function setDatabaseForTesting(testDatabase: AppDatabase | null): void {
  if (env.NODE_ENV !== "test") {
    throw new Error("setDatabaseForTesting can only be used in test.");
  }

  pool = null;
  database = testDatabase;
}

export async function checkDatabaseConnection(): Promise<{
  configured: boolean;
  status: "ok" | "not_configured" | "error";
}> {
  if (!env.DATABASE_URL) {
    return {
      configured: false,
      status: "not_configured",
    };
  }

  try {
    const db = database ?? getDatabase();
    await db.execute(sql`select 1`);

    return {
      configured: true,
      status: "ok",
    };
  } catch {
    return {
      configured: true,
      status: "error",
    };
  }
}

export async function closeDatabase(): Promise<void> {
  const currentPool = pool;

  pool = null;
  database = null;

  if (currentPool) {
    await currentPool.end();
  }
}
