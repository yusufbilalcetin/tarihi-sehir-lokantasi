import "server-only";

import { sql } from "drizzle-orm";

import type { Database } from "../../db";
import {
  MAINTENANCE_BATCH,
  MAINTENANCE_OPERATIONS,
  OUTBOX_STALE_PENDING_HOURS,
  assertBatchSize,
  assertMaxBatches,
  retentionOf,
  type MaintenanceOperation,
} from "../config/data-retention";

/**
 * Technical data maintenance: the only component in the system allowed to
 * delete rows on a schedule.
 *
 * Three properties are deliberate and load-bearing:
 *
 * 1. It can only touch the three tables the retention policy marks
 *    `CONDITIONAL`. The table name and the cutoff come from that policy, never
 *    from a caller, so no request can widen the blast radius.
 * 2. Every delete is batched behind `for update skip locked`, so two schedulers
 *    firing at once take disjoint rows instead of deadlocking, and a long
 *    backlog never becomes one table-wide DELETE.
 * 3. `dryRun` is the safe default of the HTTP surface; deletion must be asked
 *    for explicitly.
 *
 * It is a *global* system job, not a tenant-scoped one. `api_rate_limits` has
 * no `restaurant_id` at all, and the other two tables hold infrastructure state
 * rather than tenant-visible data, so a per-restaurant mode would be a
 * half-truth. See docs/data-retention.md.
 */

export interface MaintenanceRunOptions {
  /** When true nothing is deleted; candidates are only counted. */
  readonly dryRun: boolean;
  readonly now?: Date;
  readonly batchSize?: number;
  readonly maxBatches?: number;
  /** Defaults to every implemented operation. */
  readonly operations?: readonly MaintenanceOperation[];
}

export interface MaintenanceOperationResult {
  readonly operation: MaintenanceOperation;
  readonly table: string;
  /** Rows matching the retention condition when the operation started. */
  readonly scanned: number;
  readonly deleted: number;
  readonly batches: number;
  readonly cutoff: string;
  /** True when the batch ceiling stopped the run before the backlog was clear. */
  readonly truncated: boolean;
  readonly error: string | null;
}

export interface MaintenanceRunResult {
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly dryRun: boolean;
  readonly batchSize: number;
  readonly maxBatches: number;
  readonly operations: readonly MaintenanceOperationResult[];
  readonly errors: readonly string[];
}

export interface MaintenanceTableSize {
  readonly table: string;
  readonly totalBytes: number;
  readonly tableBytes: number;
  readonly indexBytes: number;
  readonly estimatedRows: number;
}

export interface MaintenanceHealthReport {
  readonly checkedAt: string;
  readonly connected: boolean;
  readonly appliedMigrations: number;
  readonly databaseBytes: number;
  readonly tables: readonly MaintenanceTableSize[];
  readonly outbox: {
    readonly pending: number;
    readonly processing: number;
    readonly failed: number;
    readonly deadLettered: number;
    readonly oldestPendingAt: string | null;
    readonly stalePending: number;
  };
  readonly expiredIdempotencyKeys: number;
  readonly expiredRateLimits: number;
  /** Human-readable conditions an operator should look at. Never auto-fixed. */
  readonly needsAttention: readonly string[];
}

function safeErrorMessage(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : "UnknownError";
}

function toNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Raw SQL carries no column type for a bind parameter, so the driver cannot
 * infer one from a `Date`. Every timestamp below is sent as ISO text and cast
 * explicitly.
 */
function at(instant: Date): string {
  return instant.toISOString();
}

function cutoffFor(operation: MaintenanceOperation, now: Date): Date {
  const policy = retentionOf(TABLE_OF[operation]).autoDelete;
  if (policy.mode !== "CONDITIONAL") {
    // Unreachable while the policy and this map agree; a loud failure is far
    // better than silently deleting from a protected table.
    throw new Error(`[Maintenance] Operation ${operation} targets a protected table.`);
  }
  return new Date(now.getTime() - policy.graceDays * 86_400_000);
}

const TABLE_OF: Readonly<Record<MaintenanceOperation, string>> = {
  EXPIRED_RATE_LIMITS: "api_rate_limits",
  EXPIRED_IDEMPOTENCY_KEYS: "idempotency_keys",
  PROCESSED_OUTBOX_EVENTS: "outbox_events",
};

export class DataMaintenanceService {
  constructor(private readonly db: Database) {}

  async run(options: MaintenanceRunOptions): Promise<MaintenanceRunResult> {
    const startedAt = options.now ?? new Date();
    const batchSize = assertBatchSize(options.batchSize ?? MAINTENANCE_BATCH.default);
    const maxBatches = assertMaxBatches(options.maxBatches ?? MAINTENANCE_BATCH.defaultMaxBatches);
    const requested = options.operations ?? MAINTENANCE_OPERATIONS;

    for (const operation of requested) {
      if (!MAINTENANCE_OPERATIONS.includes(operation)) {
        throw new TypeError(`[Maintenance] Unknown operation "${operation}".`);
      }
    }

    const results: MaintenanceOperationResult[] = [];
    const errors: string[] = [];

    // One failing operation must not hide the others: each is isolated and
    // reports its own outcome, and the run as a whole still finishes.
    for (const operation of requested) {
      const cutoff = cutoffFor(operation, startedAt);
      try {
        results.push(
          await this.runOperation(operation, cutoff, options.dryRun, batchSize, maxBatches),
        );
      } catch (error) {
        const message = `${operation}: ${safeErrorMessage(error)}`;
        errors.push(message);
        results.push({
          operation,
          table: TABLE_OF[operation],
          scanned: 0,
          deleted: 0,
          batches: 0,
          cutoff: cutoff.toISOString(),
          truncated: false,
          error: message,
        });
      }
    }

    return {
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      dryRun: options.dryRun,
      batchSize,
      maxBatches,
      operations: results,
      errors,
    };
  }

  private async runOperation(
    operation: MaintenanceOperation,
    cutoff: Date,
    dryRun: boolean,
    batchSize: number,
    maxBatches: number,
  ): Promise<MaintenanceOperationResult> {
    const scanned = await this.countCandidates(operation, cutoff);
    let deleted = 0;
    let batches = 0;

    if (!dryRun) {
      // Stop as soon as a batch comes back short: the backlog is clear, or a
      // concurrent run took the rest. Either way there is nothing left to do.
      while (batches < maxBatches) {
        const removed = await this.deleteBatch(operation, cutoff, batchSize);
        batches += 1;
        deleted += removed;
        if (removed < batchSize) break;
      }
    }

    return {
      operation,
      table: TABLE_OF[operation],
      scanned,
      deleted,
      batches,
      cutoff: cutoff.toISOString(),
      truncated: !dryRun && batches >= maxBatches && deleted < scanned,
      error: null,
    };
  }

  private async countCandidates(
    operation: MaintenanceOperation,
    cutoff: Date,
  ): Promise<number> {
    const rows = await this.db.execute(
      operation === "EXPIRED_RATE_LIMITS"
        ? sql`select count(*)::int as count from public.api_rate_limits where expires_at <= ${at(cutoff)}::timestamptz`
        : operation === "EXPIRED_IDEMPOTENCY_KEYS"
          ? sql`select count(*)::int as count from public.idempotency_keys where expires_at <= ${at(cutoff)}::timestamptz`
          : sql`select count(*)::int as count from public.outbox_events
                where status = 'PUBLISHED' and published_at is not null and published_at <= ${at(cutoff)}::timestamptz`,
    );
    return toNumber((rows as unknown as readonly { count: number }[])[0]?.count);
  }

  /**
   * One batch, one implicit transaction. `for update skip locked` is what makes
   * a second concurrent maintenance run safe: it takes different rows rather
   * than blocking on, or double-counting, the rows this one holds.
   */
  private async deleteBatch(
    operation: MaintenanceOperation,
    cutoff: Date,
    batchSize: number,
  ): Promise<number> {
    const statement =
      operation === "EXPIRED_RATE_LIMITS"
        ? sql`
            with doomed as (
              select id from public.api_rate_limits
              where expires_at <= ${at(cutoff)}::timestamptz
              order by expires_at
              limit ${batchSize}
              for update skip locked
            )
            delete from public.api_rate_limits as target
            using doomed where target.id = doomed.id
            returning target.id`
        : operation === "EXPIRED_IDEMPOTENCY_KEYS"
          ? sql`
            with doomed as (
              select id from public.idempotency_keys
              where expires_at <= ${at(cutoff)}::timestamptz
              order by expires_at
              limit ${batchSize}
              for update skip locked
            )
            delete from public.idempotency_keys as target
            using doomed where target.id = doomed.id
            returning target.id`
          : sql`
            with doomed as (
              select id from public.outbox_events
              where status = 'PUBLISHED'
                and published_at is not null
                and published_at <= ${at(cutoff)}::timestamptz
              order by published_at
              limit ${batchSize}
              for update skip locked
            )
            delete from public.outbox_events as target
            using doomed where target.id = doomed.id
            returning target.id`;

    const rows = await this.db.execute(statement);
    return (rows as unknown as readonly unknown[]).length;
  }

  /**
   * Operational observability, not a public endpoint. Exact database sizes and
   * queue depths are deployment internals; the route that serves this is
   * protected by the maintenance secret.
   */
  async health(now: Date = new Date()): Promise<MaintenanceHealthReport> {
    const staleBefore = new Date(now.getTime() - OUTBOX_STALE_PENDING_HOURS * 3_600_000);

    const [sizeRows, tableRows, outboxRows, idempotencyRows, rateLimitRows, migrationRows] =
      await Promise.all([
        this.db.execute(sql`select pg_database_size(current_database())::bigint as bytes`),
        this.db.execute(sql`
          select c.relname as table_name,
            pg_total_relation_size(c.oid)::bigint as total_bytes,
            pg_table_size(c.oid)::bigint as table_bytes,
            pg_indexes_size(c.oid)::bigint as index_bytes,
            greatest(c.reltuples, 0)::bigint as estimated_rows
          from pg_class c
          join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relkind = 'r'
          order by pg_total_relation_size(c.oid) desc`),
        this.db.execute(sql`
          select
            count(*) filter (where status = 'PENDING')::int as pending,
            count(*) filter (where status = 'PROCESSING')::int as processing,
            count(*) filter (where status = 'FAILED')::int as failed,
            count(*) filter (where dead_lettered_at is not null)::int as dead_lettered,
            count(*) filter (
              where status in ('PENDING', 'PROCESSING') and created_at <= ${at(staleBefore)}::timestamptz
            )::int as stale_pending,
            min(created_at) filter (where status in ('PENDING', 'PROCESSING')) as oldest_pending_at
          from public.outbox_events`),
        this.db.execute(
          sql`select count(*)::int as count from public.idempotency_keys where expires_at <= ${at(now)}::timestamptz`,
        ),
        this.db.execute(
          sql`select count(*)::int as count from public.api_rate_limits where expires_at <= ${at(now)}::timestamptz`,
        ),
        this.db
          .execute(sql`select count(*)::int as count from drizzle.__drizzle_migrations`)
          .catch(() => [{ count: -1 }]),
      ]);

    const outbox = (outboxRows as unknown as readonly Record<string, unknown>[])[0] ?? {};
    const oldestPendingRaw = outbox.oldest_pending_at;
    const oldestPendingAt =
      oldestPendingRaw instanceof Date
        ? oldestPendingRaw.toISOString()
        : typeof oldestPendingRaw === "string"
          ? new Date(oldestPendingRaw).toISOString()
          : null;

    const stalePending = toNumber(outbox.stale_pending);
    const deadLettered = toNumber(outbox.dead_lettered);
    const failed = toNumber(outbox.failed);
    const needsAttention: string[] = [];
    if (stalePending > 0) {
      needsAttention.push(
        `${stalePending} outbox event(s) have been undelivered for over ${OUTBOX_STALE_PENDING_HOURS}h. ` +
          "They are never deleted; check the dispatch scheduler.",
      );
    }
    if (deadLettered > 0) {
      needsAttention.push(
        `${deadLettered} outbox event(s) are dead-lettered and need an explicit manual retry.`,
      );
    }
    if (failed > deadLettered) {
      needsAttention.push(`${failed} outbox event(s) are in retry backoff.`);
    }

    const migrations = toNumber(
      (migrationRows as unknown as readonly { count: number }[])[0]?.count,
    );
    if (migrations <= 0) {
      needsAttention.push("The Drizzle migration ledger could not be read.");
    }

    return {
      checkedAt: now.toISOString(),
      connected: true,
      appliedMigrations: migrations,
      databaseBytes: toNumber(
        (sizeRows as unknown as readonly { bytes: string }[])[0]?.bytes,
      ),
      tables: (tableRows as unknown as readonly Record<string, unknown>[]).map((row) => ({
        table: String(row.table_name),
        totalBytes: toNumber(row.total_bytes),
        tableBytes: toNumber(row.table_bytes),
        indexBytes: toNumber(row.index_bytes),
        estimatedRows: toNumber(row.estimated_rows),
      })),
      outbox: {
        pending: toNumber(outbox.pending),
        processing: toNumber(outbox.processing),
        failed,
        deadLettered,
        oldestPendingAt,
        stalePending,
      },
      expiredIdempotencyKeys: toNumber(
        (idempotencyRows as unknown as readonly { count: number }[])[0]?.count,
      ),
      expiredRateLimits: toNumber(
        (rateLimitRows as unknown as readonly { count: number }[])[0]?.count,
      ),
      needsAttention,
    };
  }
}
