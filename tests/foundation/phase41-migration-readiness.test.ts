import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { readMigrationFiles } from "drizzle-orm/migrator";

/**
 * Phase 41 — the migration set, checked the way the migrator sees it.
 *
 * A `.sql` file on disk is not a migration. `readMigrationFiles` walks
 * `meta/_journal.json` and reads only the tags it finds there, so a file nobody
 * registered is inert — it sits in the directory looking applied and never
 * runs. That is exactly how `0016` was written by hand and silently skipped, so
 * these guards ask the real reader rather than counting files.
 */

const MIGRATIONS_DIR = "db/migrations";

function migrationsFolder(): string {
  return path.join(process.cwd(), MIGRATIONS_DIR);
}

/** What the migrator will actually execute, in the order it will execute it. */
function executable() {
  return readMigrationFiles({ migrationsFolder: MIGRATIONS_DIR });
}

function journal(): { entries: { idx: number; tag: string; when: number }[] } {
  return JSON.parse(readFileSync(path.join(migrationsFolder(), "meta", "_journal.json"), "utf8"));
}

function sqlFilesOnDisk(): string[] {
  return readdirSync(migrationsFolder())
    .filter((name) => name.endsWith(".sql"))
    .map((name) => name.replace(/\.sql$/, ""))
    .sort();
}

/* ------------------------------------------------ journal integrity ------ */

test("every migration file on disk is one the migrator will actually run", () => {
  const registered = new Set(journal().entries.map((entry) => entry.tag));
  const orphans = sqlFilesOnDisk().filter((tag) => !registered.has(tag));
  assert.deepEqual(
    orphans,
    [],
    "a .sql file has no journal entry, so the migrator will never read it — generate it with drizzle-kit instead of writing it by hand",
  );
});

test("every journal entry points at a file that exists", () => {
  const onDisk = new Set(sqlFilesOnDisk());
  const dangling = journal().entries.map((entry) => entry.tag).filter((tag) => !onDisk.has(tag));
  assert.deepEqual(dangling, [], "the journal names a migration whose SQL file is missing");
});

test("the journal is ordered, gapless and monotonic in time", () => {
  const entries = journal().entries;
  assert.deepEqual(
    entries.map((entry) => entry.idx),
    entries.map((_, index) => index),
    "journal indexes must be gapless and start at zero",
  );
  for (let i = 1; i < entries.length; i += 1) {
    assert.ok(
      entries[i].when > entries[i - 1].when,
      `${entries[i].tag} is not newer than ${entries[i - 1].tag}; the migrator would apply them out of order`,
    );
    assert.ok(
      entries[i].tag.localeCompare(entries[i - 1].tag) > 0,
      `${entries[i].tag} sorts before ${entries[i - 1].tag}`,
    );
  }
});

test("the four pending migrations are registered, in order, and last in the set", () => {
  const tags = journal().entries.map((entry) => entry.tag);
  const pending = [
    "0013_phase38_erp_core",
    "0014_phase39_fulfillment_items",
    "0015_phase39_order_channel",
    "0016_phase39_stock_movement_time_index",
  ];
  assert.deepEqual(tags.slice(-4), pending, "the pending set is not the last four journal entries");
  // And the reader agrees: one executable migration per journal entry.
  assert.equal(executable().length, tags.length);
});

test("0016 carries the index the stock movements report actually needs", () => {
  const last = executable().at(-1);
  assert.ok(last, "the migration set is empty");
  const sql = last.sql.join("\n");
  // The report filters by restaurant and a date range, ordered newest first.
  assert.match(sql, /CREATE INDEX "stock_movements_restaurant_occurred_idx"/);
  assert.match(sql, /ON "stock_movements"/);
  assert.match(sql, /"restaurant_id","occurred_at" DESC/);
  // Declared in the schema, not only in SQL — otherwise the next generate would
  // try to drop it again.
  assert.match(
    readFileSync(path.join(process.cwd(), "db/erp-schema.ts"), "utf8"),
    /index\("stock_movements_restaurant_occurred_idx"\)\.on\(t\.restaurantId, t\.occurredAt\.desc\(\)\)/,
  );
});

/* ------------------------------------------------ transaction safety ----- */

test("no migration contains SQL the transaction-wrapped migrator cannot run", () => {
  // `PgDialect.migrate` runs each file inside `session.transaction(...)`.
  // PostgreSQL refuses these statements inside a transaction block (25001), and
  // the failure aborts the whole migration run — including the migrations that
  // had already succeeded in that transaction.
  const forbidden: readonly (readonly [RegExp, string])[] = [
    [/\bCREATE\s+INDEX\s+CONCURRENTLY\b/i, "CREATE INDEX CONCURRENTLY"],
    [/\bDROP\s+INDEX\s+CONCURRENTLY\b/i, "DROP INDEX CONCURRENTLY"],
    [/\bREINDEX\s+(?:\w+\s+)*CONCURRENTLY\b/i, "REINDEX CONCURRENTLY"],
    [/\bVACUUM\b/i, "VACUUM"],
    [/\bCREATE\s+DATABASE\b/i, "CREATE DATABASE"],
    [/\bALTER\s+SYSTEM\b/i, "ALTER SYSTEM"],
    [/\bALTER\s+TYPE\s+\w+\s+ADD\s+VALUE\b/i, "ALTER TYPE ... ADD VALUE"],
  ];

  for (const tag of sqlFilesOnDisk()) {
    const source = readFileSync(path.join(migrationsFolder(), `${tag}.sql`), "utf8");
    // Comments explain why a statement is shaped as it is; they are not SQL.
    const statements = source
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("--"))
      .join("\n");
    for (const [pattern, name] of forbidden) {
      assert.doesNotMatch(
        statements,
        pattern,
        `${tag}.sql contains ${name}, which PostgreSQL rejects inside the migrator's transaction`,
      );
    }
  }
});

test("the guard would catch the defect it exists for", () => {
  // The shape 0016 originally had. If this ever stops matching, the guard above
  // has quietly stopped protecting anything.
  const regressed = 'CREATE INDEX CONCURRENTLY IF NOT EXISTS x ON stock_movements (restaurant_id);';
  assert.match(regressed, /\bCREATE\s+INDEX\s+CONCURRENTLY\b/i);
  // ...and that a comment mentioning it is not itself a failure.
  const commented = "-- we deliberately avoid CREATE INDEX CONCURRENTLY here\nCREATE INDEX x ON y (z);";
  const stripped = commented.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n");
  assert.doesNotMatch(stripped, /\bCREATE\s+INDEX\s+CONCURRENTLY\b/i);
});

test("the migrator runs each migration inside a transaction, which is why the guard exists", () => {
  // If this ever changes, the forbidden list above can be relaxed — but it must
  // be a deliberate decision, not a silent drift.
  const dialect = readFileSync(
    path.join(process.cwd(), "node_modules/drizzle-orm/pg-core/dialect.cjs"),
    "utf8",
  );
  const migrate = dialect.slice(dialect.indexOf("async migrate("), dialect.indexOf("async migrate(") + 2_000);
  assert.match(migrate, /session\.transaction\(/, "the migrator no longer wraps migrations in a transaction");
});

/* ------------------------------------------------ observability ---------- */

/**
 * A 5xx that cannot be tied back to a request is a line in a file nobody can
 * act on. The envelopes below all derive a correlation id; these guards check
 * that the id is in scope where the failure is logged, which is where the
 * original defect was — the value was computed inside the `try`.
 */
test("every 5xx envelope logs the request id it was serving", () => {
  // Scoped per envelope function: a file can hold several `try` blocks (the
  // body parser has one), and the question is only ever whether *this*
  // function's id is in scope when *this* function's catch runs.
  const envelopes: readonly (readonly [string, string, string])[] = [
    ["lib/api/admin-route.ts", "adminMutation", "mutation_failed"],
    ["lib/api/admin-route.ts", "adminRead", "read_failed"],
    ["lib/api/staff-route.ts", "staffMutation", "mutation_failed"],
    ["lib/api/staff-route.ts", "staffRead", "read_failed"],
    ["lib/api/report-route.ts", "reportRoute", "read_failed"],
    ["lib/api/printer-agent-route.ts", "printerAgentRoute", "agent_request_failed"],
  ];

  for (const [file, fn, event] of envelopes) {
    const source = readFileSync(path.join(process.cwd(), file), "utf8");
    // `reportRoute` returns a handler rather than being one, so it is a plain
    // `export function`; the rest are async. Accept either shape.
    const at = Math.min(
      ...[source.indexOf(`export async function ${fn}`), source.indexOf(`export function ${fn}`)]
        .filter((index) => index !== -1),
    );
    assert.ok(Number.isFinite(at), `${fn} is gone from ${file}`);
    // To the next top-level export, or the end of the file.
    const nextExport = source.indexOf(String.fromCharCode(10) + "export ", at + 1);
    const body = source.slice(at, nextExport === -1 ? undefined : nextExport);

    const logAt = body.indexOf(`logger.error("${event}"`);
    assert.ok(logAt !== -1, `${fn}: the ${event} log is gone`);
    const call = body.slice(logAt, body.indexOf("});", logAt));
    assert.match(call, /requestId,/, `${fn}: the ${event} log does not carry requestId`);

    const deriveAt = Math.min(
      ...[body.indexOf("const requestId = auditRequestContext"), body.indexOf("const requestId = await currentRequestId")]
        .filter((index) => index !== -1),
    );
    const tryAt = body.indexOf("try {");
    assert.ok(Number.isFinite(deriveAt) && deriveAt !== -1, `${fn}: no request id is derived`);
    assert.ok(
      deriveAt < tryAt,
      `${fn}: requestId is derived inside the try block, so it is out of scope in the catch — the original defect`,
    );
  }
});

test("a caller-supplied request id is honoured only when it is well formed", async () => {
  const { requestIdFrom } = await import("../../lib/api/audit-request");
  const headers = (value?: string) => new Headers(value === undefined ? {} : { "x-request-id": value });

  assert.equal(requestIdFrom(headers("trace-abc-12345678")), "trace-abc-12345678");
  // Too short, wrong charset, or absent: a fresh id rather than trusting input
  // into a log field an operator will read.
  for (const hostile of [undefined, "", "short", "has spaces in it", "sql'injection--", "a".repeat(200)]) {
    const produced = requestIdFrom(headers(hostile));
    assert.notEqual(produced, hostile);
    assert.match(produced, /^[0-9a-f-]{36}$/, `expected a generated uuid for ${JSON.stringify(hostile)}`);
  }
});

test("a print job that stopped retrying is louder than one that will retry", () => {
  const route = readFileSync(path.join(process.cwd(), "app/api/internal/printer-agent/fail/route.ts"), "utf8");
  assert.match(route, /const exhausted = outcome\.status === "FAILED";/);
  assert.match(route, /print_job_retries_exhausted/);
  assert.match(route, /print_job_retry_scheduled/);
  assert.match(route, /logger\[exhausted \? "error" : "warn"\]/);
  // Free text from the agent stays out of the log; the code carries the category.
  assert.doesNotMatch(route, /errorSummary:/);
  assert.match(route, /errorCode: body\.errorCode/);
  // Retry semantics are the service's, untouched by the logging.
  assert.match(route, /new PrintService\(\)\.fail\(/);
});

test("an outbox run that lost events says so instead of answering 200 in silence", () => {
  const route = readFileSync(path.join(process.cwd(), "app/api/internal/outbox/dispatch/route.ts"), "utf8");
  // Dead-lettered events will never reach the floor: that is the error case.
  assert.match(route, /result\.deadLettered > 0/);
  assert.match(route, /logger\.error\("outbox_dead_lettered"/);
  // A failure that will retry is a warning, not an incident.
  assert.match(route, /logger\.warn\("outbox_publish_failed"/);
  // Invocation failure logging is still there.
  assert.match(route, /logger\.error\("dispatch_failed"/);
  // No new queue state was invented; these are the dispatcher's own counters.
  const dispatcher = readFileSync(path.join(process.cwd(), "lib/services/outbox-dispatcher.ts"), "utf8");
  assert.match(dispatcher, /return \{ claimed: events\.length, published, failed, deadLettered \}/);
});

test("the migrator applies every pending migration in one transaction", () => {
  // This is why the runbook says the four migrations cannot be paused between,
  // and why a failure in 0016 rolls 0013-0015 back with it.
  const dialect = readFileSync(path.join(process.cwd(), "node_modules/drizzle-orm/pg-core/dialect.cjs"), "utf8");
  const migrate = dialect.slice(dialect.indexOf("async migrate("), dialect.indexOf("async migrate(") + 2_000);
  const transactionAt = migrate.indexOf("session.transaction(");
  const loopAt = migrate.indexOf("for await (const migration of migrations)");
  assert.ok(transactionAt !== -1 && loopAt !== -1, "the migrate loop changed shape");
  assert.ok(
    transactionAt < loopAt,
    "the migration loop is no longer inside the transaction — the runbook's all-or-nothing claim is now wrong",
  );
});
