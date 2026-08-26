import { loadEnvConfig } from "@next/env";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { parseServerEnvironment } from "../lib/env/validation";

loadEnvConfig(process.cwd());

async function main() {
  const databaseUrl = parseServerEnvironment(process.env, ["database"]).databaseUrl!;

  const client = postgres(databaseUrl, {
    max: 1,
    prepare: false,
    connect_timeout: 10,
  });
  try {
    await migrate(drizzle(client), { migrationsFolder: "db/migrations" });
  } finally {
    await client.end({ timeout: 5 });
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown migration error";
  console.error(`[Database migration] ${message}`);
  process.exitCode = 1;
});
