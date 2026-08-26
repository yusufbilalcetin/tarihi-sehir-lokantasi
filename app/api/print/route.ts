import type { NextResponse } from "next/server";

import { getDb } from "@/db";
import { parseBody } from "@/lib/api/admin-route";
import { staffMutation } from "@/lib/api/staff-route";
import { PRINT_PAYLOAD_VERSION, type PrintDocument } from "@/lib/domain/print-document";
import type { UserRole } from "@/lib/domain/status";
import { DrizzleCashierShiftRepository } from "@/lib/repositories/drizzle-cashier-shift-repository";
import { CashierReportService } from "@/lib/services/cashier-report-service";
import { PrintDocumentService } from "@/lib/services/print-document-service";
import { PrintService } from "@/lib/services/print-service";
import { printRequestBodySchema } from "@/lib/validation/printing";

export const runtime = "nodejs";

/**
 * Staff ask for a document; the server builds it.
 *
 * The body never carries content — only which document and which source. Every
 * figure on the paper is read from the database here, which is what keeps a
 * printed total and the ledger the same number, and what makes it impossible
 * to smuggle printer commands in through a request.
 */

/** Who may put which document on paper. */
const DOCUMENT_ROLES: Record<string, readonly UserRole[]> = {
  CUSTOMER_BILL: ["ADMIN", "MANAGER", "CASHIER", "WAITER"],
  PAYMENT_RECEIPT: ["ADMIN", "MANAGER", "CASHIER"],
  X_REPORT: ["ADMIN", "MANAGER", "CASHIER"],
  Z_REPORT: ["ADMIN", "MANAGER", "CASHIER"],
  // A test print reaches a physical device on demand, so it stays supervisory.
  TEST_PRINT: ["ADMIN", "MANAGER"],
};

const ALL_PRINT_ROLES: readonly UserRole[] = [
  "ADMIN",
  "MANAGER",
  "CASHIER",
  "WAITER",
  "KITCHEN",
];

export async function POST(request: Request): Promise<NextResponse> {
  const body = await parseBody(request, printRequestBodySchema, "Yazdırma isteği geçersiz.");
  const roles = DOCUMENT_ROLES[body.documentType] ?? [];

  return staffMutation(
    request,
    // The envelope enforces the per-document role list; a KITCHEN member
    // reaching for a payment copy is refused here, not deeper in.
    roles.length > 0 ? roles : ALL_PRINT_ROLES,
    "api.print",
    async ({ principal }) => {
      const db = getDb();
      const documents = new PrintDocumentService(db);
      const printing = new PrintService(db);
      const now = new Date();

      switch (body.documentType) {
        case "CUSTOMER_BILL": {
          const document = await documents.customerBill(
            principal.restaurantId,
            body.orderId,
            now,
          );
          // The discriminator is the moment of asking, so "print the current
          // bill" is always a new document rather than a silent duplicate.
          return printing.enqueueDocument({
            restaurantId: principal.restaurantId,
            documentType: "CUSTOMER_BILL",
            sourceType: "ORDER",
            sourceId: body.orderId,
            document,
            discriminator: now.toISOString(),
            requestedByStaffId: principal.userId,
          });
        }

        case "PAYMENT_RECEIPT": {
          const document = await documents.paymentReceipt(
            principal.restaurantId,
            body.paymentId,
            now,
          );
          return printing.enqueueDocument({
            restaurantId: principal.restaurantId,
            documentType: "PAYMENT_RECEIPT",
            sourceType: "PAYMENT",
            sourceId: body.paymentId,
            document,
            // One receipt per payment; asking twice is a reprint, not a second.
            discriminator: "original",
            requestedByStaffId: principal.userId,
          });
        }

        case "X_REPORT":
        case "Z_REPORT": {
          const reports = new CashierReportService(new DrizzleCashierShiftRepository(db));
          // Ownership is enforced by the Phase 8B service: a cashier reaches
          // only their own shift, whichever printer is involved.
          const report =
            body.documentType === "X_REPORT"
              ? await reports.xReport(principal, body.shiftId)
              : await reports.zReport(principal, body.shiftId);

          const document: PrintDocument = {
            type: body.documentType,
            version: PRINT_PAYLOAD_VERSION,
            restaurantName: report.restaurantNameSnapshot,
            printedAtIso: now.toISOString(),
            // The stored Z is printed verbatim; nothing is recomputed for paper.
            report: report as unknown as Record<string, unknown>,
          };
          return printing.enqueueDocument({
            restaurantId: principal.restaurantId,
            documentType: body.documentType,
            sourceType: "SHIFT",
            sourceId: body.shiftId,
            document,
            discriminator:
              body.documentType === "Z_REPORT" ? "original" : now.toISOString(),
            requestedByStaffId: principal.userId,
          });
        }

        case "TEST_PRINT": {
          const test = await documents.testPrint(
            principal.restaurantId,
            body.printerId,
            now,
          );
          // A test goes to the named printer directly, not through routing.
          return printing.enqueue(
            principal.restaurantId,
            "TEST_PRINT",
            "PRINTER",
            test.printerId,
            [
              {
                printerId: test.printerId,
                printerName: test.printerName,
                copies: 1,
                document: test.document,
                dedupeKey: null,
              },
            ],
            { requestedByStaffId: principal.userId },
          );
        }
      }
    },
    201,
  );
}
