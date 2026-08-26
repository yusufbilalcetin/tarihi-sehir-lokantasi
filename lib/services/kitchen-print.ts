import "server-only";

import { and, asc, eq, inArray, ne } from "drizzle-orm";

import type { Database } from "@/db";
import {
  categories,
  orderItems,
  orders,
  printJobs,
  printerRoutes,
  products,
  restaurantPrinters,
  restaurantTables,
  restaurants,
  type JsonObject,
} from "@/db/schema";
import { renderEscPos } from "@/lib/domain/escpos";
import { orderPlaceLabel } from "@/lib/domain/display";
import {
  PRINT_PAYLOAD_VERSION,
  stationLabelFor,
  type KitchenCancelDocument,
  type KitchenLine,
  type KitchenOrderDocument,
  type PrinterStationType,
} from "@/lib/domain/print-document";
import { buildDedupeKey, groupLinesByPrinter } from "@/lib/domain/print-routing";

/**
 * Kitchen tickets, enqueued inside the very transaction that changed the order.
 *
 * That placement is the point. A ticket is a row insert, never a network call,
 * so the order transaction is never held open waiting for a printer — and
 * because it commits with the order, a confirmation can never succeed while
 * its ticket silently goes missing. If the printer is switched off the job
 * simply waits in the queue; the order is already safe.
 *
 * Repeated delivery of the same event is harmless: the dedupe key makes the
 * second insert a no-op rather than a second ticket at the pass.
 */

type Executor = Database | Parameters<Parameters<Database["transaction"]>[0]>[0];

export interface KitchenPrintLine {
  readonly productId: string;
  readonly productName: string;
  readonly quantity: number;
  readonly note: string | null;
}

export interface KitchenPrintRequest {
  readonly restaurantId: string;
  readonly orderId: string;
  readonly kind: "NEW" | "ADDITION" | "CANCEL";
  /**
   * What makes this occurrence distinct: the confirmation, one specific
   * addition, or one cancelled line. Two deliveries of the same occurrence
   * collapse to one ticket.
   */
  readonly occurrence: string;
  /** Omitted means "every line currently on the order". */
  readonly lines?: readonly KitchenPrintLine[];
  readonly reason?: string | null;
}

export interface KitchenPrintOutcome {
  readonly created: number;
  readonly duplicates: number;
  /** Lines with no printer behind them. Recorded, never a reason to fail. */
  readonly unrouted: number;
}

async function orderContext(executor: Executor, restaurantId: string, orderId: string) {
  const [row] = await executor
    .select({
      orderNumber: orders.orderNumber,
      channel: orders.channel,
      tableName: restaurantTables.name,
      restaurantName: restaurants.name,
    })
    .from(orders)
    // A takeaway or courier order has no table. An inner join here would
    // drop it from this query entirely rather than show it without one.
    .leftJoin(
      restaurantTables,
      and(
        eq(restaurantTables.restaurantId, orders.restaurantId),
        eq(restaurantTables.id, orders.tableId),
      ),
    )
    .innerJoin(restaurants, eq(restaurants.id, orders.restaurantId))
    .where(and(eq(orders.restaurantId, restaurantId), eq(orders.id, orderId)))
    .limit(1);
  return row ?? null;
}

/** Category and station for each product, so a line knows where it belongs. */
async function categoriesOf(
  executor: Executor,
  restaurantId: string,
  productIds: readonly string[],
): Promise<Map<string, { categoryId: string; categoryName: string }>> {
  if (productIds.length === 0) return new Map();
  const rows = await executor
    .select({
      productId: products.id,
      categoryId: products.categoryId,
      categoryName: categories.name,
    })
    .from(products)
    .innerJoin(
      categories,
      and(
        eq(categories.restaurantId, products.restaurantId),
        eq(categories.id, products.categoryId),
      ),
    )
    .where(
      and(
        eq(products.restaurantId, restaurantId),
        inArray(products.id, [...new Set(productIds)]),
      ),
    );
  return new Map(
    rows.map((row) => [
      row.productId,
      { categoryId: row.categoryId, categoryName: row.categoryName },
    ]),
  );
}

/** Everything still on the order, for the ticket that follows a confirmation. */
async function currentLines(
  executor: Executor,
  restaurantId: string,
  orderId: string,
): Promise<readonly KitchenPrintLine[]> {
  const rows = await executor
    .select({
      productId: orderItems.productId,
      productName: orderItems.productNameSnapshot,
      quantity: orderItems.quantity,
      note: orderItems.notes,
    })
    .from(orderItems)
    .where(
      and(
        eq(orderItems.restaurantId, restaurantId),
        eq(orderItems.orderId, orderId),
        ne(orderItems.status, "CANCELLED"),
      ),
    )
    .orderBy(asc(orderItems.sortOrder), asc(orderItems.createdAt));
  return rows.map((row) => ({
    productId: row.productId,
    // The name as sold. A menu rename never rewrites a printed ticket.
    productName: row.productName,
    quantity: row.quantity,
    note: row.note,
  }));
}

export async function enqueueKitchenTickets(
  executor: Executor,
  request: KitchenPrintRequest,
  now: Date = new Date(),
): Promise<KitchenPrintOutcome> {
  const documentType: "KITCHEN_CANCEL" | "KITCHEN_ORDER" =
    request.kind === "CANCEL" ? "KITCHEN_CANCEL" : "KITCHEN_ORDER";

  const candidates = await executor
    .select({
      id: printerRoutes.id,
      printerId: printerRoutes.printerId,
      printerName: restaurantPrinters.name,
      stationType: restaurantPrinters.stationType,
      categoryId: printerRoutes.categoryId,
      copies: printerRoutes.copies,
      isActive: printerRoutes.isActive,
      printerIsActive: restaurantPrinters.isActive,
      printerDeletedAt: restaurantPrinters.deletedAt,
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
        eq(printerRoutes.restaurantId, request.restaurantId),
        eq(printerRoutes.documentType, documentType),
      ),
    );

  const lines = request.lines ?? (await currentLines(executor, request.restaurantId, request.orderId));
  if (lines.length === 0) return { created: 0, duplicates: 0, unrouted: 0 };

  const context = await orderContext(executor, request.restaurantId, request.orderId);
  if (!context) return { created: 0, duplicates: 0, unrouted: 0 };

  const categoryByProduct = await categoriesOf(
    executor,
    request.restaurantId,
    lines.map((line) => line.productId),
  );
  const stationByPrinter = new Map(
    candidates.map((route) => [route.printerId, route.stationType as PrinterStationType]),
  );

  const { batches, unrouted } = groupLinesByPrinter(
    lines.map((line) => {
      const category = categoryByProduct.get(line.productId);
      return {
        categoryId: category?.categoryId ?? null,
        line: {
          quantity: line.quantity,
          productName: line.productName,
          note: line.note,
          categoryName: category?.categoryName ?? null,
        } satisfies KitchenLine,
      };
    }),
    candidates.map((route) => ({
      id: route.id,
      printerId: route.printerId,
      printerName: route.printerName,
      categoryId: route.categoryId,
      copies: route.copies,
      isActive: route.isActive,
      printerIsActive: route.printerIsActive && route.printerDeletedAt === null,
    })),
  );

  if (batches.length === 0) {
    return { created: 0, duplicates: 0, unrouted: unrouted.length };
  }

  const values = batches.map((batch) => {
    const station = stationByPrinter.get(batch.printerId) ?? "GENERAL";
    const header = {
      restaurantName: context.restaurantName,
      printedAtIso: now.toISOString(),
      stationLabel: stationLabelFor(station),
      tableName: orderPlaceLabel(context.channel, context.tableName),
      orderNumber: context.orderNumber,
      orderId: request.orderId,
      version: PRINT_PAYLOAD_VERSION,
    };
    const document: KitchenOrderDocument | KitchenCancelDocument =
      request.kind === "CANCEL"
        ? { ...header, type: "KITCHEN_CANCEL", reason: request.reason ?? null, lines: batch.lines }
        : {
            ...header,
            type: "KITCHEN_ORDER",
            // An addition prints only what is new; the earlier round has
            // already been cooked and must not reappear at the pass.
            isAddition: request.kind === "ADDITION",
            lines: batch.lines,
          };

    // Rendered once here so an unprintable document fails at enqueue time
    // rather than in the agent, where nobody is watching.
    renderEscPos(document, { charactersPerLine: 48, encoding: "CP857", autoCut: true });

    return {
      restaurantId: request.restaurantId,
      printerId: batch.printerId,
      printerNameSnapshot: batch.printerName,
      documentType,
      sourceType: "ORDER",
      sourceId: request.orderId,
      payloadVersion: PRINT_PAYLOAD_VERSION,
      payloadSnapshot: document as unknown as JsonObject,
      copies: batch.copies,
      dedupeKey: buildDedupeKey({
        documentType,
        sourceId: request.orderId,
        printerId: batch.printerId,
        discriminator: request.occurrence,
      }),
    };
  });

  const inserted = await executor
    .insert(printJobs)
    .values(values)
    // The dedupe index decides: a repeated confirmation inserts nothing.
    .onConflictDoNothing()
    .returning({ id: printJobs.id });

  return {
    created: inserted.length,
    duplicates: values.length - inserted.length,
    unrouted: unrouted.length,
  };
}
