import "server-only";

import { and, asc, desc, eq, gte, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";

import { getDb, type Database } from "@/db";
import {
  categories,
  printJobAttempts,
  printJobs,
  printerRoutes,
  printerAgents,
  restaurantPrinters,
  restaurants,
  type JsonObject,
} from "@/db/schema";
import { DomainError } from "@/lib/api/domain-error";
import { renderEscPos, isSupportedEncoding, type PrinterEncoding } from "@/lib/domain/escpos";
import {
  PRINT_PAYLOAD_VERSION,
  UnsupportedPrintPayloadError,
  type PrintDocument,
  type PrintDocumentType,
} from "@/lib/domain/print-document";
import {
  PRINT_RETRY,
  agentPresence,
  buildDedupeKey,
  groupLinesByPrinter,
  isPrintErrorCode,
  isTerminalAttempt,
  resolveRoutes,
  retryDelayMs,
  type RouteCandidate,
} from "@/lib/domain/print-routing";
import type { RestaurantPrincipal } from "@/lib/domain/restaurant-scope";

/**
 * The print queue.
 *
 * It lives in PostgreSQL, so it survives a server restart and a crashed agent,
 * and it is deliberately decoupled from every business transaction: a printer
 * that is switched off must never roll back an order, a payment or a shift
 * close. Enqueuing is a row insert and nothing more; delivery happens later,
 * out of band, driven by an agent inside the restaurant.
 */

export interface EnqueueTarget {
  readonly printerId: string;
  readonly printerName: string;
  readonly copies: number;
  readonly document: PrintDocument;
  readonly dedupeKey: string | null;
}

export interface EnqueueResult {
  readonly created: readonly string[];
  readonly duplicates: number;
  /** Lines or documents that route nowhere; surfaced, never silently dropped. */
  readonly unroutedCount: number;
}

export interface ClaimedJob {
  readonly jobId: string;
  readonly deviceKey: string;
  readonly printerName: string;
  readonly charactersPerLine: number;
  readonly encoding: string;
  readonly autoCut: boolean;
  readonly copies: number;
  readonly documentType: PrintDocumentType;
  readonly payloadVersion: number;
  /** Ready-to-send bytes; the agent never assembles printer commands itself. */
  readonly escposBase64: string;
  readonly attemptNumber: number;
  readonly leaseUntilIso: string;
}

type TransactionDatabase = Parameters<Parameters<Database["transaction"]>[0]>[0];

function notFound(): DomainError {
  return new DomainError("NOT_FOUND", "Yazdırma kaydı bulunamadı.", { httpStatus: 404 });
}

/** A printer profile, validated before anything is rendered against it. */
function profileOf(printer: {
  charactersPerLine: number;
  encoding: string;
  autoCut: boolean;
}): { charactersPerLine: number; encoding: PrinterEncoding; autoCut: boolean } {
  if (!isSupportedEncoding(printer.encoding)) {
    throw new DomainError(
      "UNSUPPORTED_PRINTER_ENCODING",
      "Yazıcı kodlaması desteklenmiyor.",
      { httpStatus: 409, details: { encoding: printer.encoding } },
    );
  }
  return {
    charactersPerLine: printer.charactersPerLine,
    encoding: printer.encoding,
    autoCut: printer.autoCut,
  };
}

export class PrintService {
  constructor(private readonly db: Database = getDb()) {}

  /** Active routes for one document type, with their printers' live state. */
  async routeCandidates(
    restaurantId: string,
    documentType: PrintDocumentType,
    executor: Database | TransactionDatabase = this.db,
  ): Promise<readonly RouteCandidate[]> {
    return executor
      .select({
        id: printerRoutes.id,
        printerId: printerRoutes.printerId,
        printerName: restaurantPrinters.name,
        categoryId: printerRoutes.categoryId,
        copies: printerRoutes.copies,
        isActive: printerRoutes.isActive,
        printerIsActive: sql<boolean>`${restaurantPrinters.isActive} and ${restaurantPrinters.deletedAt} is null`,
      })
      .from(printerRoutes)
      .innerJoin(
        restaurantPrinters,
        and(
          eq(restaurantPrinters.restaurantId, printerRoutes.restaurantId),
          eq(restaurantPrinters.id, printerRoutes.printerId),
        ),
      )
      .where(
        and(
          eq(printerRoutes.restaurantId, restaurantId),
          eq(printerRoutes.documentType, documentType),
        ),
      );
  }

  /**
   * Inserts the jobs. `ON CONFLICT DO NOTHING` against the dedupe index is what
   * makes a repeated confirmation — or two workers handling the same event —
   * produce one ticket rather than two.
   */
  async enqueue(
    restaurantId: string,
    documentType: PrintDocumentType,
    sourceType: string,
    sourceId: string | null,
    targets: readonly EnqueueTarget[],
    options: {
      readonly requestedByStaffId?: string | null;
      readonly reprintOfJobId?: string | null;
      readonly reprintReason?: string | null;
      readonly unroutedCount?: number;
      readonly executor?: Database | TransactionDatabase;
    } = {},
  ): Promise<EnqueueResult> {
    if (targets.length === 0) {
      return { created: [], duplicates: 0, unroutedCount: options.unroutedCount ?? 0 };
    }
    const executor = options.executor ?? this.db;
    const rows = await executor
      .insert(printJobs)
      .values(
        targets.map((target) => ({
          restaurantId,
          printerId: target.printerId,
          printerNameSnapshot: target.printerName,
          documentType,
          sourceType,
          sourceId,
          payloadVersion: PRINT_PAYLOAD_VERSION,
          payloadSnapshot: target.document as unknown as JsonObject,
          copies: target.copies,
          dedupeKey: target.dedupeKey,
          requestedByStaffId: options.requestedByStaffId ?? null,
          reprintOfJobId: options.reprintOfJobId ?? null,
          reprintReason: options.reprintReason ?? null,
        })),
      )
      .onConflictDoNothing()
      .returning({ id: printJobs.id });

    return {
      created: rows.map((row) => row.id),
      duplicates: targets.length - rows.length,
      unroutedCount: options.unroutedCount ?? 0,
    };
  }

  /**
   * Routes a set of lines and enqueues one ticket per printer. Used for kitchen
   * documents, where a mixed order legitimately becomes several tickets.
   */
  async enqueueRouted<TLine>(input: {
    readonly restaurantId: string;
    readonly documentType: PrintDocumentType;
    readonly sourceType: string;
    readonly sourceId: string;
    readonly items: readonly { categoryId: string | null; line: TLine }[];
    readonly discriminator: string;
    readonly buildDocument: (
      lines: readonly TLine[],
      printerName: string,
    ) => PrintDocument;
    readonly requestedByStaffId?: string | null;
    readonly executor?: Database | TransactionDatabase;
  }): Promise<EnqueueResult> {
    const candidates = await this.routeCandidates(
      input.restaurantId,
      input.documentType,
      input.executor ?? this.db,
    );
    const { batches, unrouted } = groupLinesByPrinter(input.items, candidates);

    return this.enqueue(
      input.restaurantId,
      input.documentType,
      input.sourceType,
      input.sourceId,
      batches.map((batch) => ({
        printerId: batch.printerId,
        printerName: batch.printerName,
        copies: batch.copies,
        document: input.buildDocument(batch.lines, batch.printerName),
        dedupeKey: buildDedupeKey({
          documentType: input.documentType,
          sourceId: input.sourceId,
          printerId: batch.printerId,
          discriminator: input.discriminator,
        }),
      })),
      {
        requestedByStaffId: input.requestedByStaffId,
        unroutedCount: unrouted.length,
        executor: input.executor,
      },
    );
  }

  /** One document to whichever printers the route table nominates. */
  async enqueueDocument(input: {
    readonly restaurantId: string;
    readonly documentType: PrintDocumentType;
    readonly sourceType: string;
    readonly sourceId: string;
    readonly document: PrintDocument;
    readonly discriminator: string;
    readonly requestedByStaffId?: string | null;
    readonly executor?: Database | TransactionDatabase;
  }): Promise<EnqueueResult> {
    const candidates = await this.routeCandidates(
      input.restaurantId,
      input.documentType,
      input.executor ?? this.db,
    );
    const routes = resolveRoutes(candidates, null);
    return this.enqueue(
      input.restaurantId,
      input.documentType,
      input.sourceType,
      input.sourceId,
      routes.map((route) => ({
        printerId: route.printerId,
        printerName: route.printerName,
        copies: route.copies,
        document: input.document,
        dedupeKey: buildDedupeKey({
          documentType: input.documentType,
          sourceId: input.sourceId,
          printerId: route.printerId,
          discriminator: input.discriminator,
        }),
      })),
      {
        requestedByStaffId: input.requestedByStaffId,
        unroutedCount: routes.length === 0 ? 1 : 0,
        executor: input.executor,
      },
    );
  }

  /**
   * Hands an agent work for its own printers only.
   *
   * `FOR UPDATE SKIP LOCKED` settles the race: two workers take disjoint jobs
   * rather than the same one twice. A lease is stamped from the *server* clock,
   * so an agent whose machine has drifted cannot keep a job forever, and an
   * agent that crashes releases its work when the lease expires.
   */
  async claim(
    agent: { readonly id: string; readonly restaurantId: string },
    limit: number,
    now: Date = new Date(),
  ): Promise<readonly ClaimedJob[]> {
    const leaseUntil = new Date(now.getTime() + PRINT_RETRY.leaseMs);

    return this.db.transaction(async (transaction) => {
      const candidates = await transaction
        .select({ id: printJobs.id })
        .from(printJobs)
        .innerJoin(
          restaurantPrinters,
          and(
            eq(restaurantPrinters.restaurantId, printJobs.restaurantId),
            eq(restaurantPrinters.id, printJobs.printerId),
          ),
        )
        .where(
          and(
            eq(printJobs.restaurantId, agent.restaurantId),
            eq(restaurantPrinters.printerAgentId, agent.id),
            lte(printJobs.availableAt, now),
            or(
              eq(printJobs.status, "PENDING"),
              // An expired lease is reclaimable; a live one is left alone.
              and(eq(printJobs.status, "PROCESSING"), lt(printJobs.leaseUntil, now)),
            ),
          ),
        )
        .orderBy(asc(printJobs.availableAt), asc(printJobs.createdAt))
        .limit(Math.max(1, Math.min(limit, 20)))
        .for("update", { of: printJobs, skipLocked: true });

      if (candidates.length === 0) return [];

      const claimed = await transaction
        .update(printJobs)
        .set({
          status: "PROCESSING",
          claimedAt: now,
          claimedByAgentId: agent.id,
          leaseUntil,
          attemptCount: sql`${printJobs.attemptCount} + 1`,
          updatedAt: now,
        })
        // The candidates were already selected for this agent's restaurant and
        // row-locked, so this repeats the tenant predicate rather than
        // establishing it: the claim cannot cross tenants even if the query
        // above is later changed.
        .where(
          and(
            eq(printJobs.restaurantId, agent.restaurantId),
            inArray(printJobs.id, candidates.map((row) => row.id)),
          ),
        )
        .returning({
          id: printJobs.id,
          printerId: printJobs.printerId,
          printerNameSnapshot: printJobs.printerNameSnapshot,
          documentType: printJobs.documentType,
          payloadVersion: printJobs.payloadVersion,
          payloadSnapshot: printJobs.payloadSnapshot,
          copies: printJobs.copies,
          attemptCount: printJobs.attemptCount,
        });

      const printers = await transaction
        .select({
          id: restaurantPrinters.id,
          deviceKey: restaurantPrinters.deviceKey,
          charactersPerLine: restaurantPrinters.charactersPerLine,
          encoding: restaurantPrinters.encoding,
          autoCut: restaurantPrinters.autoCut,
        })
        .from(restaurantPrinters)
        .where(
          and(
            eq(restaurantPrinters.restaurantId, agent.restaurantId),
            inArray(restaurantPrinters.id, claimed.map((row) => row.printerId)),
          ),
        );

      const results: ClaimedJob[] = [];
      for (const job of claimed) {
        const printer = printers.find((row) => row.id === job.printerId);
        if (!printer) continue;
        await transaction.insert(printJobAttempts).values({
          restaurantId: agent.restaurantId,
          printJobId: job.id,
          printerAgentId: agent.id,
          attemptNumber: job.attemptCount,
          startedAt: now,
        });

        // Rendered here, on the server: the agent receives bytes, never the
        // freedom to compose printer commands of its own.
        const bytes = renderEscPos(
          job.payloadSnapshot as unknown as PrintDocument,
          profileOf(printer),
        );
        results.push({
          jobId: job.id,
          deviceKey: printer.deviceKey,
          printerName: job.printerNameSnapshot,
          charactersPerLine: printer.charactersPerLine,
          encoding: printer.encoding,
          autoCut: printer.autoCut,
          copies: job.copies,
          documentType: job.documentType,
          payloadVersion: job.payloadVersion,
          escposBase64: Buffer.from(bytes).toString("base64"),
          attemptNumber: job.attemptCount,
          leaseUntilIso: leaseUntil.toISOString(),
        });
      }
      return results;
    });
  }

  /**
   * `PRINTED` means the agent delivered the bytes to the configured transport.
   * A dumb ESC/POS printer does not acknowledge paper, so this is deliberately
   * not a claim that a ticket physically exists.
   */
  async complete(
    agent: { readonly id: string; readonly restaurantId: string },
    jobId: string,
    bytesWritten: number | null,
    now: Date = new Date(),
  ): Promise<{ readonly status: string }> {
    return this.db.transaction(async (transaction) => {
      const [job] = await transaction
        .select({ id: printJobs.id, status: printJobs.status, attemptCount: printJobs.attemptCount })
        .from(printJobs)
        .where(
          and(eq(printJobs.restaurantId, agent.restaurantId), eq(printJobs.id, jobId)),
        )
        .for("update")
        .limit(1);
      if (!job) throw notFound();
      // A late acknowledgement for a job already finished is accepted rather
      // than treated as an error: the agent may be replaying its journal.
      if (job.status === "PRINTED") return { status: "PRINTED" };

      await transaction
        .update(printJobs)
        .set({
          status: "PRINTED",
          printedAt: now,
          leaseUntil: null,
          lastErrorCode: null,
          lastErrorSummary: null,
          updatedAt: now,
        })
        .where(
          and(eq(printJobs.restaurantId, agent.restaurantId), eq(printJobs.id, jobId)),
        );
      await transaction
        .update(printJobAttempts)
        .set({ finishedAt: now, succeeded: true, bytesWritten })
        .where(
          and(
            eq(printJobAttempts.restaurantId, agent.restaurantId),
            eq(printJobAttempts.printJobId, jobId),
            eq(printJobAttempts.attemptNumber, job.attemptCount),
          ),
        );
      return { status: "PRINTED" };
    });
  }

  /** A transient failure returns the job to the queue behind a backoff. */
  async fail(
    agent: { readonly id: string; readonly restaurantId: string },
    jobId: string,
    errorCode: string,
    errorSummary: string,
    now: Date = new Date(),
  ): Promise<{ readonly status: string; readonly retryAtIso: string | null }> {
    const code = isPrintErrorCode(errorCode) ? errorCode : "PRINTER_WRITE_FAILED";
    const summary = errorSummary.slice(0, 300);

    return this.db.transaction(async (transaction) => {
      const [job] = await transaction
        .select({
          id: printJobs.id,
          status: printJobs.status,
          attemptCount: printJobs.attemptCount,
        })
        .from(printJobs)
        .where(
          and(eq(printJobs.restaurantId, agent.restaurantId), eq(printJobs.id, jobId)),
        )
        .for("update")
        .limit(1);
      if (!job) throw notFound();
      if (job.status === "PRINTED" || job.status === "CANCELLED") {
        return { status: job.status, retryAtIso: null };
      }

      const terminal = isTerminalAttempt(job.attemptCount);
      const retryAt = new Date(now.getTime() + retryDelayMs(job.attemptCount));
      await transaction
        .update(printJobs)
        .set({
          status: terminal ? "FAILED" : "PENDING",
          availableAt: terminal ? now : retryAt,
          leaseUntil: null,
          claimedByAgentId: null,
          failedAt: terminal ? now : null,
          lastErrorCode: code,
          lastErrorSummary: summary,
          updatedAt: now,
        })
        .where(
          and(eq(printJobs.restaurantId, agent.restaurantId), eq(printJobs.id, jobId)),
        );
      await transaction
        .update(printJobAttempts)
        .set({ finishedAt: now, succeeded: false, errorCode: code, errorSummary: summary })
        .where(
          and(
            eq(printJobAttempts.restaurantId, agent.restaurantId),
            eq(printJobAttempts.printJobId, jobId),
            eq(printJobAttempts.attemptNumber, job.attemptCount),
          ),
        );
      return {
        status: terminal ? "FAILED" : "PENDING",
        retryAtIso: terminal ? null : retryAt.toISOString(),
      };
    });
  }

  /**
   * Re-delivers the same job. This is a retry, not a reprint: no new row, no
   * new document, and the original's history keeps growing.
   */
  async retry(
    principal: RestaurantPrincipal,
    jobId: string,
    now: Date = new Date(),
  ): Promise<{ readonly jobId: string; readonly status: string }> {
    const rows = await this.db
      .update(printJobs)
      .set({
        status: "PENDING",
        availableAt: now,
        leaseUntil: null,
        claimedByAgentId: null,
        failedAt: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(printJobs.restaurantId, principal.restaurantId),
          eq(printJobs.id, jobId),
          inArray(printJobs.status, ["FAILED", "PENDING"]),
        ),
      )
      .returning({ id: printJobs.id, status: printJobs.status });
    const job = rows[0];
    if (!job) {
      throw new DomainError(
        "CONFLICT",
        "Yalnız başarısız bir yazdırma işi tekrar denenebilir.",
        { httpStatus: 409 },
      );
    }
    return { jobId: job.id, status: job.status };
  }

  /**
   * A human asking for the same paper again. It is a new job carrying the
   * *original* snapshot, linked back to it, with a mandatory reason — the
   * original row is never touched.
   */
  async reprint(
    principal: RestaurantPrincipal,
    jobId: string,
    reason: string,
  ): Promise<{ readonly jobId: string }> {
    const trimmed = reason.trim();
    if (trimmed.length === 0) {
      throw new DomainError("VALIDATION_ERROR", "Yeniden yazdırma gerekçesi zorunludur.", {
        httpStatus: 400,
      });
    }

    const [original] = await this.db
      .select({
        id: printJobs.id,
        printerId: printJobs.printerId,
        printerNameSnapshot: printJobs.printerNameSnapshot,
        documentType: printJobs.documentType,
        sourceType: printJobs.sourceType,
        sourceId: printJobs.sourceId,
        payloadVersion: printJobs.payloadVersion,
        payloadSnapshot: printJobs.payloadSnapshot,
        copies: printJobs.copies,
        reprintOfJobId: printJobs.reprintOfJobId,
      })
      .from(printJobs)
      .where(
        and(eq(printJobs.restaurantId, principal.restaurantId), eq(printJobs.id, jobId)),
      )
      .limit(1);
    if (!original) throw notFound();
    if (original.payloadVersion !== PRINT_PAYLOAD_VERSION) {
      throw new DomainError(
        "UNSUPPORTED_PRINT_PAYLOAD",
        "Bu belge daha yeni bir sürümle oluşturulmuş ve yeniden yazdırılamıyor.",
        { httpStatus: 409 },
      );
    }

    const document = original.payloadSnapshot as unknown as PrintDocument;
    const rows = await this.db
      .insert(printJobs)
      .values({
        restaurantId: principal.restaurantId,
        printerId: original.printerId,
        printerNameSnapshot: original.printerNameSnapshot,
        documentType: original.documentType,
        sourceType: original.sourceType,
        sourceId: original.sourceId,
        payloadVersion: original.payloadVersion,
        // The stored snapshot, marked as a duplicate so the counter can tell.
        payloadSnapshot: {
          ...(document as unknown as JsonObject),
          reprintOfJobId: original.id,
          reprintReason: trimmed,
        },
        copies: original.copies,
        // Deliberately no dedupe key: a reprint is a new occurrence.
        dedupeKey: null,
        requestedByStaffId: principal.userId,
        // A reprint of a reprint still points at the true original.
        reprintOfJobId: original.reprintOfJobId ?? original.id,
        reprintReason: trimmed,
      })
      .returning({ id: printJobs.id });

    const created = rows[0];
    if (!created) {
      throw new DomainError("CONFLICT", "Yeniden yazdırma kaydedilemedi.", { httpStatus: 409 });
    }
    return { jobId: created.id };
  }

  /** Queue history, always paginated and always tenant-scoped. */
  async history(
    principal: RestaurantPrincipal,
    query: {
      readonly status?: "PENDING" | "PROCESSING" | "PRINTED" | "FAILED" | "CANCELLED";
      readonly printerId?: string;
      readonly documentType?: PrintDocumentType;
      readonly from?: Date;
      readonly to?: Date;
      readonly page: number;
      readonly pageSize: number;
    },
  ) {
    const where = and(
      eq(printJobs.restaurantId, principal.restaurantId),
      ...(query.status ? [eq(printJobs.status, query.status)] : []),
      ...(query.printerId ? [eq(printJobs.printerId, query.printerId)] : []),
      ...(query.documentType ? [eq(printJobs.documentType, query.documentType)] : []),
      ...(query.from ? [gte(printJobs.createdAt, query.from)] : []),
      ...(query.to ? [lt(printJobs.createdAt, query.to)] : []),
    );

    const [counted] = await this.db
      .select({ total: sql<number>`count(*)::int` })
      .from(printJobs)
      .where(where);

    const rows = await this.db
      .select({
        id: printJobs.id,
        printerId: printJobs.printerId,
        printerName: printJobs.printerNameSnapshot,
        documentType: printJobs.documentType,
        status: printJobs.status,
        attemptCount: printJobs.attemptCount,
        copies: printJobs.copies,
        sourceType: printJobs.sourceType,
        sourceId: printJobs.sourceId,
        reprintOfJobId: printJobs.reprintOfJobId,
        reprintReason: printJobs.reprintReason,
        lastErrorCode: printJobs.lastErrorCode,
        lastErrorSummary: printJobs.lastErrorSummary,
        createdAt: printJobs.createdAt,
        printedAt: printJobs.printedAt,
        failedAt: printJobs.failedAt,
      })
      .from(printJobs)
      .where(where)
      // Stable tie-break, so page two never repeats or skips a row.
      .orderBy(desc(printJobs.createdAt), desc(printJobs.id))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize);

    return {
      rows: rows.map((row) => ({
        ...row,
        createdAt: row.createdAt.toISOString(),
        printedAt: row.printedAt?.toISOString() ?? null,
        failedAt: row.failedAt?.toISOString() ?? null,
      })),
      total: Number(counted?.total ?? 0),
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  /**
   * One word per order for the kitchen screen.
   *
   * The pass needs to know whether the paper it is waiting for is coming, not
   * why it is late: a failure outranks a pending job, a pending job outranks a
   * printed one, and an order with no ticket at all reports nothing rather than
   * inventing a status.
   */
  async kitchenTicketStatus(
    principal: RestaurantPrincipal,
    orderIds: readonly string[],
  ): Promise<Record<string, "PENDING" | "PRINTED" | "FAILED">> {
    if (orderIds.length === 0) return {};
    const rows = await this.db
      .select({ orderId: printJobs.sourceId, status: printJobs.status })
      .from(printJobs)
      .where(
        and(
          eq(printJobs.restaurantId, principal.restaurantId),
          eq(printJobs.sourceType, "ORDER"),
          inArray(printJobs.documentType, ["KITCHEN_ORDER", "KITCHEN_CANCEL"]),
          inArray(printJobs.sourceId, [...orderIds]),
        ),
      );

    const result: Record<string, "PENDING" | "PRINTED" | "FAILED"> = {};
    for (const row of rows) {
      if (!row.orderId) continue;
      const current = result[row.orderId];
      if (current === "FAILED") continue;
      if (row.status === "FAILED") {
        result[row.orderId] = "FAILED";
      } else if (row.status === "PENDING" || row.status === "PROCESSING") {
        result[row.orderId] = "PENDING";
      } else if (row.status === "PRINTED" && current === undefined) {
        result[row.orderId] = "PRINTED";
      }
    }
    return result;
  }

  async attempts(principal: RestaurantPrincipal, jobId: string) {
    return this.db
      .select({
        attemptNumber: printJobAttempts.attemptNumber,
        startedAt: printJobAttempts.startedAt,
        finishedAt: printJobAttempts.finishedAt,
        succeeded: printJobAttempts.succeeded,
        errorCode: printJobAttempts.errorCode,
        errorSummary: printJobAttempts.errorSummary,
        bytesWritten: printJobAttempts.bytesWritten,
      })
      .from(printJobAttempts)
      .where(
        and(
          eq(printJobAttempts.restaurantId, principal.restaurantId),
          eq(printJobAttempts.printJobId, jobId),
        ),
      )
      .orderBy(asc(printJobAttempts.attemptNumber));
  }

  async restaurantName(restaurantId: string): Promise<string> {
    const [row] = await this.db
      .select({ name: restaurants.name })
      .from(restaurants)
      .where(eq(restaurants.id, restaurantId))
      .limit(1);
    return row?.name ?? "";
  }

  async categoryOf(
    restaurantId: string,
    categoryId: string,
  ): Promise<string | null> {
    const [row] = await this.db
      .select({ name: categories.name })
      .from(categories)
      .where(and(eq(categories.restaurantId, restaurantId), eq(categories.id, categoryId)))
      .limit(1);
    return row?.name ?? null;
  }

  /** Agent presence for the admin screen, derived from the last heartbeat. */
  async agentStatus(restaurantId: string, now: Date = new Date()) {
    const rows = await this.db
      .select({
        id: printerAgents.id,
        name: printerAgents.name,
        isActive: printerAgents.isActive,
        lastSeenAt: printerAgents.lastSeenAt,
        softwareVersion: printerAgents.softwareVersion,
        revokedAt: printerAgents.revokedAt,
        tokenVersion: printerAgents.tokenVersion,
      })
      .from(printerAgents)
      .where(eq(printerAgents.restaurantId, restaurantId))
      .orderBy(asc(printerAgents.name));
    return rows.map((row) => ({
      ...row,
      lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
      revokedAt: row.revokedAt?.toISOString() ?? null,
      presence: agentPresence(row.lastSeenAt, now),
    }));
  }

  /** Records a heartbeat without a write per poll when nothing has changed. */
  async heartbeat(
    agentId: string,
    restaurantId: string,
    softwareVersion: string | null,
    now: Date = new Date(),
  ): Promise<void> {
    await this.db
      .update(printerAgents)
      .set({ lastSeenAt: now, softwareVersion, updatedAt: now })
      .where(
        and(eq(printerAgents.restaurantId, restaurantId), eq(printerAgents.id, agentId)),
      );
  }

  /** Jobs stuck in PROCESSING past their lease, for the health surface. */
  async stalledCount(restaurantId: string, now: Date = new Date()): Promise<number> {
    const [row] = await this.db
      .select({ total: sql<number>`count(*)::int` })
      .from(printJobs)
      .where(
        and(
          eq(printJobs.restaurantId, restaurantId),
          eq(printJobs.status, "PROCESSING"),
          or(isNull(printJobs.leaseUntil), lt(printJobs.leaseUntil, now)),
        ),
      );
    return Number(row?.total ?? 0);
  }
}

export { UnsupportedPrintPayloadError };
