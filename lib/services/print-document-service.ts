import "server-only";

import { and, asc, eq } from "drizzle-orm";

import { getDb, type Database } from "@/db";
import {
  cashierShifts,
  orderItems,
  orders,
  printerAgents,
  payments,
  restaurantPrinters,
  restaurantTables,
  restaurants,
  staffProfiles,
} from "@/db/schema";
import { DomainError } from "@/lib/api/domain-error";
import { calculateOrderBalance } from "@/lib/domain/financial-operations";
import { orderPlaceLabel, paymentMethodLabel } from "@/lib/domain/display";
import {
  PRINT_PAYLOAD_VERSION,
  TURKISH_CHARACTER_SAMPLE,
  type BillLine,
  type CustomerBillDocument,
  type PaymentReceiptDocument,
  type TestPrintDocument,
} from "@/lib/domain/print-document";

/**
 * Builds print documents from the database.
 *
 * The client never supplies a payload: it asks for "the bill for order X", and
 * the server reads order X and composes the snapshot. That is what keeps a
 * printed total honest, and it is why totals here come from the same
 * `calculateOrderBalance` the cashier screen uses rather than from arithmetic
 * invented for printing.
 */

function orderNotFound(): DomainError {
  return new DomainError("ORDER_NOT_FOUND", "Sipariş bulunamadı.", { httpStatus: 404 });
}

export class PrintDocumentService {
  constructor(private readonly db: Database = getDb()) {}

  private async orderContext(restaurantId: string, orderId: string) {
    const [order] = await this.db
      .select({
        id: orders.id,
        orderNumber: orders.orderNumber,
        createdAt: orders.createdAt,
        subtotal: orders.subtotal,
        discountTotal: orders.discountTotal,
        serviceChargeTotal: orders.serviceChargeTotal,
        taxTotal: orders.taxTotal,
        total: orders.total,
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
    if (!order) throw orderNotFound();
    return order;
  }

  /** The ledger of one order, as the cashier screen sees it. */
  private async balanceOf(restaurantId: string, orderId: string, total: string) {
    const ledger = await this.db
      .select({
        amount: payments.amount,
        refundedAmount: payments.refundedAmount,
        status: payments.status,
      })
      .from(payments)
      .where(and(eq(payments.restaurantId, restaurantId), eq(payments.orderId, orderId)));
    return calculateOrderBalance(
      total,
      ledger.map((row) => ({
        amount: row.amount,
        refundedAmount: row.refundedAmount,
        counted: row.status === "COMPLETED",
      })),
    );
  }

  /**
   * The guest's adisyon. Cancelled and written-off lines are excluded: a guest
   * is not shown a line they are not being asked to pay for.
   */
  async customerBill(
    restaurantId: string,
    orderId: string,
    now: Date = new Date(),
  ): Promise<CustomerBillDocument> {
    const order = await this.orderContext(restaurantId, orderId);
    const items = await this.db
      .select({
        productNameSnapshot: orderItems.productNameSnapshot,
        unitPrice: orderItems.unitPrice,
        quantity: orderItems.quantity,
        lineTotal: orderItems.lineTotal,
        notes: orderItems.notes,
        status: orderItems.status,
      })
      .from(orderItems)
      .where(and(eq(orderItems.restaurantId, restaurantId), eq(orderItems.orderId, orderId)))
      .orderBy(asc(orderItems.sortOrder), asc(orderItems.createdAt));

    const billable: BillLine[] = items
      .filter((item) => item.status !== "CANCELLED" && item.status !== "VOIDED")
      .map((item) => ({
        quantity: item.quantity,
        // The name as sold, so a later menu edit cannot rewrite an old bill.
        productName: item.productNameSnapshot,
        unitPrice: item.unitPrice,
        lineTotal: item.lineTotal,
        note: item.notes,
      }));

    const balance = await this.balanceOf(restaurantId, orderId, order.total);
    return {
      type: "CUSTOMER_BILL",
      version: PRINT_PAYLOAD_VERSION,
      restaurantName: order.restaurantName,
      printedAtIso: now.toISOString(),
      tableName: orderPlaceLabel(order.channel, order.tableName),
      orderNumber: order.orderNumber,
      orderId: order.id,
      openedAtIso: order.createdAt.toISOString(),
      lines: billable,
      subtotal: order.subtotal,
      discountTotal: order.discountTotal ?? "0.00",
      serviceChargeTotal: order.serviceChargeTotal ?? "0.00",
      taxTotal: order.taxTotal ?? "0.00",
      total: order.total,
      paidTotal: balance.paidTotal,
      refundedTotal: balance.refundedTotal,
      outstanding: balance.outstanding,
    };
  }

  /**
   * A payment copy. It carries the stored method and nothing else about the
   * instrument: no card number, expiry, CVV or processor reference exists in
   * this system, and none is ever printed.
   */
  async paymentReceipt(
    restaurantId: string,
    paymentId: string,
    now: Date = new Date(),
  ): Promise<PaymentReceiptDocument> {
    const [payment] = await this.db
      .select({
        id: payments.id,
        orderId: payments.orderId,
        amount: payments.amount,
        method: payments.method,
        cashierShiftId: payments.cashierShiftId,
        cashierName: staffProfiles.name,
      })
      .from(payments)
      .leftJoin(
        staffProfiles,
        and(
          eq(staffProfiles.restaurantId, payments.restaurantId),
          eq(staffProfiles.id, payments.createdByUserId),
        ),
      )
      .where(and(eq(payments.restaurantId, restaurantId), eq(payments.id, paymentId)))
      .limit(1);
    if (!payment) {
      throw new DomainError("PAYMENT_NOT_FOUND", "Ödeme bulunamadı.", { httpStatus: 404 });
    }

    const order = await this.orderContext(restaurantId, payment.orderId);
    const balance = await this.balanceOf(restaurantId, payment.orderId, order.total);

    let registerName: string | null = null;
    if (payment.cashierShiftId) {
      const [shift] = await this.db
        .select({ registerName: cashierShifts.registerNameSnapshot })
        .from(cashierShifts)
        .where(
          and(
            eq(cashierShifts.restaurantId, restaurantId),
            eq(cashierShifts.id, payment.cashierShiftId),
          ),
        )
        .limit(1);
      registerName = shift?.registerName ?? null;
    }

    return {
      type: "PAYMENT_RECEIPT",
      version: PRINT_PAYLOAD_VERSION,
      restaurantName: order.restaurantName,
      printedAtIso: now.toISOString(),
      tableName: orderPlaceLabel(order.channel, order.tableName),
      orderNumber: order.orderNumber,
      orderId: order.id,
      paymentId: payment.id,
      amount: payment.amount,
      // The shared helper, not a local copy: a method added to the enum and
      // not to the dictionary would otherwise be printed raw on a receipt.
      method: paymentMethodLabel(payment.method),
      paidTotal: balance.paidTotal,
      refundedTotal: balance.refundedTotal,
      outstanding: balance.outstanding,
      cashierName: payment.cashierName,
      registerName,
    };
  }

  /** Proves the code page before anybody trusts a real ticket. */
  async testPrint(
    restaurantId: string,
    printerId: string,
    now: Date = new Date(),
  ): Promise<{
    readonly document: TestPrintDocument;
    readonly printerId: string;
    readonly printerName: string;
  }> {
    const [printer] = await this.db
      .select({
        id: restaurantPrinters.id,
        name: restaurantPrinters.name,
        encoding: restaurantPrinters.encoding,
        charactersPerLine: restaurantPrinters.charactersPerLine,
        isActive: restaurantPrinters.isActive,
        deletedAt: restaurantPrinters.deletedAt,
        agentName: printerAgents.name,
        restaurantName: restaurants.name,
      })
      .from(restaurantPrinters)
      .innerJoin(restaurants, eq(restaurants.id, restaurantPrinters.restaurantId))
      .innerJoin(
        printerAgents,
        and(
          eq(printerAgents.restaurantId, restaurantPrinters.restaurantId),
          eq(printerAgents.id, restaurantPrinters.printerAgentId),
        ),
      )
      .where(
        and(
          eq(restaurantPrinters.restaurantId, restaurantId),
          eq(restaurantPrinters.id, printerId),
        ),
      )
      .limit(1);
    if (!printer || !printer.isActive || printer.deletedAt) {
      throw new DomainError("NOT_FOUND", "Yazıcı bulunamadı.", { httpStatus: 404 });
    }

    return {
      printerId: printer.id,
      printerName: printer.name,
      document: {
        type: "TEST_PRINT",
        version: PRINT_PAYLOAD_VERSION,
        restaurantName: printer.restaurantName,
        printedAtIso: now.toISOString(),
        printerName: printer.name,
        agentName: printer.agentName ?? "",
        encoding: printer.encoding,
        charactersPerLine: printer.charactersPerLine,
        characterSample: TURKISH_CHARACTER_SAMPLE,
      },
    };
  }
}
