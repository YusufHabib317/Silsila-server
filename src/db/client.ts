import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { sql } from "drizzle-orm";
import { drizzle, type NeonHttpDatabase } from "drizzle-orm/neon-http";

import { env } from "../config/env.ts";
import * as schema from "./schema.ts";

export type AppDatabase = NeonHttpDatabase<typeof schema>;

let queryClient: NeonQueryFunction<false, false> | null = null;
let database: AppDatabase | null = null;

export function isDatabaseConfigured(): boolean {
  return Boolean(env.DATABASE_URL);
}

export function getNeonQueryClient(): NeonQueryFunction<false, false> {
  if (!env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not configured.");
  }

  if (!queryClient) {
    queryClient = neon(env.DATABASE_URL);
  }

  return queryClient;
}

export function getDatabase(): AppDatabase {
  const client = getNeonQueryClient();

  if (!database) {
    database = drizzle(client, { schema });
  }

  return database;
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
    const db = database ?? drizzle(neon(env.DATABASE_URL), { schema });
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
  queryClient = null;
  database = null;
}
