import { NextRequest, NextResponse } from "next/server";

import { getDb } from "@/db";
import { apiFailureFromUnknown, apiSuccess } from "@/lib/api/response";
import { validationError } from "@/lib/api/domain-error";
import { auditRequestContext } from "@/lib/api/audit-request";
import { requireCurrentStaffPrincipal } from "@/lib/auth/current-staff";
import { USER_ROLES } from "@/lib/domain/status";
import { DrizzleOrderRepository } from "@/lib/repositories/drizzle-order-repository";
import { DrizzleStaffOrderRepository } from "@/lib/repositories/drizzle-staff-order-repository";
import { createLogger } from "@/lib/security/logger";
import { assertTrustedMutationOrigin } from "@/lib/security/origin";
import { OrderService } from "@/lib/services/order-service";
import { StaffOrderService } from "@/lib/services/staff-order-service";
import {
  idempotencyKeySchema,
  staffOrderCreateBodySchema,
  staffOrderListQuerySchema,
  validationIssues,
} from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" } as const;
const MUTATION_HEADERS = {
  "Cache-Control": "no-store",
  Vary: "Cookie, Origin, Idempotency-Key",
} as const;
const logger = createLogger("api.staff.orders");

/**
 * A waiter taking an order at the table. Prices, totals and availability come
 * from the locked product rows inside the same transaction as the guest path;
 * the request body only carries product ids and quantities.
 */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    assertTrustedMutationOrigin(request);
    const principal = await requireCurrentStaffPrincipal();

    const idempotency = idempotencyKeySchema.safeParse(request.headers.get("idempotency-key"));
    if (!idempotency.success) {
      throw validationError("Geçerli bir Idempotency-Key başlığı gereklidir.", {
        issues: validationIssues(idempotency.error).map((issue) => ({ ...issue })),
      });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw validationError("Geçersiz JSON gövdesi.");
    }
    const parsed = staffOrderCreateBodySchema.safeParse(body);
    if (!parsed.success) {
      throw validationError("Sipariş bilgileri geçersiz.", {
        issues: validationIssues(parsed.error).map((issue) => ({ ...issue })),
      });
    }

    const service = new OrderService(new DrizzleOrderRepository(getDb()));
    const created = await service.createStaffOrder(principal, {
      tableId: parsed.data.tableId,
      idempotencyKey: idempotency.data,
      items: parsed.data.items,
      notes: parsed.data.notes,
      requestId: auditRequestContext(request).requestId,
    });
    return NextResponse.json(
      apiSuccess({
        orderId: created.order.id,
        orderNumber: created.order.orderNumber,
        status: created.order.status,
        total: created.amounts.total,
        currency: created.amounts.currency,
        createdAt: created.order.createdAt,
        replayed: created.replayed,
      }),
      { status: created.replayed ? 200 : 201, headers: MUTATION_HEADERS },
    );
  } catch (error) {
    const failure = apiFailureFromUnknown(error);
    if (failure.status >= 500) {
      logger.error("create_failed", "Staff order could not be created.", {
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
    }
    return NextResponse.json(failure.body, {
      status: failure.status,
      headers: MUTATION_HEADERS,
    });
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const principal = await requireCurrentStaffPrincipal(USER_ROLES);
    const parsed = staffOrderListQuerySchema.safeParse(
      Object.fromEntries(request.nextUrl.searchParams.entries()),
    );
    if (!parsed.success) {
      throw validationError("Sipariş filtreleri geçersiz.", {
        issues: validationIssues(parsed.error).map((issue) => ({ ...issue })),
      });
    }

    const service = new StaffOrderService(new DrizzleStaffOrderRepository(getDb()));
    const { open, ...filters } = parsed.data;
    const orders = await service.listOrders(principal, {
      ...filters,
      openOnly: open === "true",
    });
    return NextResponse.json(apiSuccess({ orders }), {
      status: 200,
      headers: NO_STORE_HEADERS,
    });
  } catch (error) {
    const failure = apiFailureFromUnknown(error);
    if (failure.status >= 500) {
      logger.error("read_failed", "Staff order list could not be read.", {
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
    }
    return NextResponse.json(failure.body, {
      status: failure.status,
      headers: NO_STORE_HEADERS,
    });
  }
}
