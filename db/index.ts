import "server-only";

import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import { getServerEnvironment } from "../lib/env/server";
import { sqlDebugHook, sqlProfilingEnabled } from "../lib/perf/sql-profiler";

import * as relations from "./relations";
import * as schema from "./schema";

const databaseSchema = { ...schema, ...relations };

export type Database = PostgresJsDatabase<typeof databaseSchema>;

export interface DatabaseConnection {
  db: Database;
  client: Sql;
  close(): Promise<void>;
}

export interface CreateDatabaseOptions {
  /** Keep this conservative for serverless deployments with many instances. */
  maxConnections?: number;
}

/**
 * One connection per instance serialises every transaction the instance is
 * handling: with a ~47 ms round trip to the pooler, ten concurrent order
 * writes queued behind each other for ~2.8 s. A small pool absorbs a normal
 * dinner rush while staying far below the pooler's client limit. Override with
 * DATABASE_POOL_MAX where the deployment's connection budget demands it.
 */
function runtimePoolSize(): number {
  const configured = Number(process.env.DATABASE_POOL_MAX);
  return Number.isInteger(configured) && configured > 0 ? configured : 5;
}

/**
 * Whether statements may be prepared and reused.
 *
 * postgres.js sends an unprepared parameterised statement as Describe first and
 * Bind/Execute second — two network round trips instead of one. Against a
 * regional pooler that doubles the cost of every query the application makes,
 * and the application makes nothing but parameterised queries. Both Supabase
 * pooler ports (session 5432 and Supavisor transaction 6543) track named
 * statements, so this is on by default; set DATABASE_PREPARED_STATEMENTS=0 for
 * a pooler that cannot, and every statement falls back to the two-trip form.
 */
function preparedStatementsEnabled(): boolean {
  return process.env.DATABASE_PREPARED_STATEMENTS !== "0";
}

/**
 * Drizzle issues every statement through `client.unsafe(sql, params)`, which
 * hard-codes `prepare: false` on the query regardless of the pool setting. The
 * only place to opt back in is the per-call options argument, so it is added
 * here — including for the client handed to a transaction body.
 */
function withPreparedStatements<T extends object>(client: T): T {
  const wrap = (target: object): object =>
    new Proxy(target, {
      get(owner, property, receiver) {
        const value = Reflect.get(owner, property, receiver);
        if (typeof value !== "function") return value;
        if (property === "unsafe") {
          return (query: string, parameters?: unknown[], options?: object) =>
            value.call(owner, query, parameters, { prepare: true, ...options });
        }
        if (property === "begin") {
          return (...args: unknown[]) => {
            const bodyIndex = args.findIndex((argument) => typeof argument === "function");
            if (bodyIndex >= 0) {
              const body = args[bodyIndex] as (transaction: unknown) => unknown;
              args[bodyIndex] = (transaction: object) => body(wrap(transaction));
            }
            return value.apply(owner, args);
          };
        }
        return value.bind(owner);
      },
    });
  return wrap(client) as T;
}

const globalDatabase = globalThis as typeof globalThis & {
  __sehirDatabaseConnection?: DatabaseConnection;
};

/**
 * Creates a PostgreSQL connection without reading global configuration.
 * Callers that own a short-lived connection should call `close()` during
 * teardown.
 */
export function createDb(
  databaseUrl: string,
  options: CreateDatabaseOptions = {},
): DatabaseConnection {
  const normalizedUrl = databaseUrl.trim();
  if (!normalizedUrl) {
    throw new Error("[Database] A non-empty PostgreSQL connection URL is required.");
  }

  const prepared = preparedStatementsEnabled();
  const client = postgres(normalizedUrl, {
    max: options.maxConnections ?? runtimePoolSize(),
    prepare: prepared,
    connect_timeout: 10,
    idle_timeout: 20,
    max_lifetime: 60 * 30,
    ...(sqlProfilingEnabled() ? { debug: sqlDebugHook() } : {}),
  });

  return {
    db: drizzle(prepared ? withPreparedStatements(client) : client, { schema: databaseSchema }),
    client,
    close: () => client.end({ timeout: 5 }),
  };
}

function createRuntimeConnection(): DatabaseConnection {
  const databaseUrl = getServerEnvironment(["database"]).databaseUrl!;
  return createDb(databaseUrl);
}

/**
 * Lazily creates and reuses the runtime connection. Merely importing this file
 * never reads DATABASE_URL and never opens a socket, so build-time evaluation
 * remains safe when deployment secrets are unavailable.
 */
export function getDbConnection(): DatabaseConnection {
  globalDatabase.__sehirDatabaseConnection ??= createRuntimeConnection();
  return globalDatabase.__sehirDatabaseConnection;
}

export function getDb(): Database {
  return getDbConnection().db;
}

/** Intended for test/process teardown, not per-request use. */
export async function closeDb(): Promise<void> {
  const connection = globalDatabase.__sehirDatabaseConnection;
  if (!connection) return;

  delete globalDatabase.__sehirDatabaseConnection;
  await connection.close();
}
