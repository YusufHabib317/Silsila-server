import { drizzle } from "drizzle-orm/neon-http";
import { migrate } from "drizzle-orm/neon-http/migrator";

import * as schema from "../src/db/schema.ts";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error("DATABASE_URL is required to run migrations.");
  process.exit(1);
}

const startedAt = Date.now();
const db = drizzle(databaseUrl, { schema });

console.log("Applying database migrations with Neon HTTP driver...");

await migrate(db, {
  migrationsFolder: "./drizzle",
});

console.log(
  `Database migrations applied in ${Date.now() - startedAt}ms.`,
);
