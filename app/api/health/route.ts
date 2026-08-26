import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getDb } from "@/db";
import { createLogger } from "@/lib/security/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "no-store, max-age=0" } as const;
const DB_PROBE_TIMEOUT_MS = 3_000;
const logger = createLogger("api.health");

/**
 * The probe is a bare `select 1`: it proves the pool can hand out a working
 * connection without touching a single business row, so a monitor polling this
 * every few seconds costs the production database nothing measurable.
 * A hung socket must not hold the monitor open either, hence the race.
 */
async function probeDatabase(): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      getDb().execute(sql`select 1`),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("timeout")), DB_PROBE_TIMEOUT_MS);
      }),
    ]);
    return true;
  } catch (error) {
    // Only the error's class name is logged; driver messages carry the
    // connection string and must never reach a log line or the response.
    logger.error("database_probe_failed", "Health database probe failed.", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Unauthenticated on purpose: an uptime monitor cannot hold a staff session.
 * The body is therefore two booleans and a timestamp — never a version, a
 * hostname, a dependency URL, or anything derived from an error.
 */
export async function GET(): Promise<NextResponse> {
  const database = await probeDatabase();
  return NextResponse.json(
    {
      status: database ? "ok" : "degraded",
      application: "ok",
      database: database ? "ok" : "unreachable",
      timestamp: new Date().toISOString(),
    },
    { status: database ? 200 : 503, headers: NO_STORE_HEADERS },
  );
}
