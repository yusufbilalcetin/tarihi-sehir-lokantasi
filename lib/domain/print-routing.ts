import type { PrintDocumentType } from "./print-document";

/**
 * Which printer a document goes to, and when a failed job may be tried again.
 *
 * Pure decisions only — no database, no clock beyond what is handed in — so the
 * awkward cases (a category with two printers, a category with none, a printer
 * that has been retired) are settled here and tested without infrastructure.
 */

export interface RouteCandidate {
  readonly id: string;
  readonly printerId: string;
  readonly printerName: string;
  readonly categoryId: string | null;
  readonly copies: number;
  readonly isActive: boolean;
  readonly printerIsActive: boolean;
}

export interface ResolvedRoute {
  readonly printerId: string;
  readonly printerName: string;
  readonly copies: number;
}

/**
 * Routes for one category: its own if it has any, otherwise the document's
 * default (a route with no category). A category may legitimately fan out to
 * several printers — a grill item going to both the grill and the expediter —
 * so this returns a list, de-duplicated by printer.
 *
 * A retired printer is never a destination. Returning an empty list is a
 * normal, expected answer: the caller records that and carries on rather than
 * failing the order.
 */
export function resolveRoutes(
  candidates: readonly RouteCandidate[],
  categoryId: string | null,
): readonly ResolvedRoute[] {
  const usable = candidates.filter(
    (route) => route.isActive && route.printerIsActive,
  );
  const specific = categoryId
    ? usable.filter((route) => route.categoryId === categoryId)
    : [];
  const chosen = specific.length > 0
    ? specific
    : usable.filter((route) => route.categoryId === null);

  const byPrinter = new Map<string, ResolvedRoute>();
  for (const route of chosen) {
    if (byPrinter.has(route.printerId)) continue;
    byPrinter.set(route.printerId, {
      printerId: route.printerId,
      printerName: route.printerName,
      copies: route.copies,
    });
  }
  return [...byPrinter.values()];
}

export interface RoutableLine<TLine> {
  readonly categoryId: string | null;
  readonly line: TLine;
}

export interface PrinterBatch<TLine> {
  readonly printerId: string;
  readonly printerName: string;
  readonly copies: number;
  readonly lines: readonly TLine[];
}

/**
 * Splits an order's lines across the printers they route to. A ticket carries
 * only the lines that belong to its own station: the grill never sees the
 * drinks, and the bar never sees the kebabs.
 */
export function groupLinesByPrinter<TLine>(
  items: readonly RoutableLine<TLine>[],
  candidates: readonly RouteCandidate[],
): {
  readonly batches: readonly PrinterBatch<TLine>[];
  /** Lines that route nowhere; reported, never silently dropped. */
  readonly unrouted: readonly TLine[];
} {
  const batches = new Map<string, { route: ResolvedRoute; lines: TLine[] }>();
  const unrouted: TLine[] = [];

  for (const item of items) {
    const routes = resolveRoutes(candidates, item.categoryId);
    if (routes.length === 0) {
      unrouted.push(item.line);
      continue;
    }
    for (const route of routes) {
      const existing = batches.get(route.printerId);
      if (existing) existing.lines.push(item.line);
      else batches.set(route.printerId, { route, lines: [item.line] });
    }
  }

  return {
    batches: [...batches.values()].map((entry) => ({
      printerId: entry.route.printerId,
      printerName: entry.route.printerName,
      copies: entry.route.copies,
      lines: entry.lines,
    })),
    unrouted,
  };
}

/**
 * The key that makes a repeated enqueue harmless.
 *
 * It is deterministic in exactly the things that identify one printed
 * occurrence: the document, its source, the printer, and a discriminator for
 * documents that legitimately recur (an order's second round of items). A
 * reprint deliberately has no dedupe key — it is a new occurrence by
 * definition.
 */
export function buildDedupeKey(input: {
  readonly documentType: PrintDocumentType;
  readonly sourceId: string;
  readonly printerId: string;
  readonly discriminator?: string;
}): string {
  const parts = [
    input.documentType,
    input.sourceId,
    input.printerId,
    input.discriminator ?? "",
  ];
  return parts.join("|").slice(0, 160);
}

export const PRINT_RETRY = {
  maxAttempts: 6,
  baseDelayMs: 10_000,
  maximumDelayMs: 10 * 60_000,
  /** How long a claimed job stays leased before another worker may take it. */
  leaseMs: 60_000,
} as const;

/**
 * Exponential backoff, capped. A printer that is switched off must not cause
 * hundreds of database round trips a second while it stays off.
 */
export function retryDelayMs(attemptCount: number): number {
  const exponent = Math.max(0, Math.min(attemptCount, 10));
  return Math.min(PRINT_RETRY.baseDelayMs * 2 ** exponent, PRINT_RETRY.maximumDelayMs);
}

export function isTerminalAttempt(attemptCount: number): boolean {
  return attemptCount >= PRINT_RETRY.maxAttempts;
}

/** Agent presence, so the admin screen can say something honest about it. */
export const AGENT_ONLINE_THRESHOLD_MS = 90_000;

export type AgentPresence = "ONLINE" | "OFFLINE" | "UNKNOWN";

export function agentPresence(lastSeenAt: Date | null, now: Date): AgentPresence {
  if (!lastSeenAt) return "UNKNOWN";
  return now.getTime() - lastSeenAt.getTime() <= AGENT_ONLINE_THRESHOLD_MS
    ? "ONLINE"
    : "OFFLINE";
}

/** Delivery failures the agent can report, kept as a closed set. */
export const PRINT_ERROR_CODES = [
  "PRINTER_AGENT_OFFLINE",
  "PRINTER_DEVICE_NOT_FOUND",
  "PRINTER_CONNECTION_FAILED",
  "PRINTER_WRITE_FAILED",
  "PRINT_JOB_LEASE_EXPIRED",
  "PRINT_ROUTE_MISSING",
  "UNSUPPORTED_PRINT_PAYLOAD",
  "UNSUPPORTED_PRINTER_ENCODING",
] as const;

export type PrintErrorCode = (typeof PRINT_ERROR_CODES)[number];

export function isPrintErrorCode(value: string): value is PrintErrorCode {
  return (PRINT_ERROR_CODES as readonly string[]).includes(value);
}
