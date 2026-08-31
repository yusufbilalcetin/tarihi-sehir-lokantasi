import { NextResponse } from "next/server";
import { z } from "zod";

import { getDb } from "@/db";
import { apiFailureFromUnknown, apiSuccess } from "@/lib/api/response";
import { validationError } from "@/lib/api/domain-error";
import { requireCustomerTableContext } from "@/lib/auth/customer-table-context";
import { DrizzleOrderRepository } from "@/lib/repositories/drizzle-order-repository";
import { createLogger } from "@/lib/security/logger";
import { assertTrustedMutationOrigin } from "@/lib/security/origin";
import { enforceRateLimit } from "@/lib/security/rate-limit.server";
import { retryAfterHeader } from "@/lib/security/rate-limit-response";
import { OrderService } from "@/lib/services/order-service";
import {
  idempotencyKeySchema,
  noteSchema,
  validationIssues,
} from "@/lib/validation/common";
import { createOrderItemInputSchema } from "@/lib/validation/order";

export const runtime = "nodejs";

const createCustomerOrderBodySchema = z
  .object({
    items: z.array(createOrderItemInputSchema).min(1).max(50),
    note: noteSchema,
    notes: noteSchema,
  })
  .strict()
  .superRefine((order, refinement) => {
    if (order.note !== undefined && order.notes !== undefined) {
      refinement.addIssue({
        code: "custom",
        path: ["notes"],
        message: "Sipariş notu yalnızca bir kez gönderilebilir.",
      });
    }
    const lines = new Set<string>();
    order.items.forEach((item, index) => {
      const lineKey = JSON.stringify([item.productId, item.note ?? ""]);
      if (lines.has(lineKey)) {
        refinement.addIssue({
          code: "custom",
          path: ["items", index],
          message: "Aynı ürün ve not kombinasyonu tekrar edemez.",
        });
      }
      lines.add(lineKey);
    });
  });

const RESPONSE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Vary: "Cookie, Origin, Idempotency-Key",
} as const;
const logger = createLogger("api.customer.orders");

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw validationError("Geçersiz JSON gövdesi.");
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    assertTrustedMutationOrigin(request);
    const context = await requireCustomerTableContext();
    await enforceRateLimit(request, "ORDER_CREATE", {
      restaurantId: context.restaurantId,
      tableId: context.tableId,
    });

    const idempotency = idempotencyKeySchema.safeParse(
      request.headers.get("idempotency-key"),
    );
    if (!idempotency.success) {
      throw validationError("Geçerli bir Idempotency-Key başlığı gereklidir.", {
        issues: validationIssues(idempotency.error).map((issue) => ({
          path: issue.path,
          code: issue.code,
          message: issue.message,
        })),
      });
    }
    const parsed = createCustomerOrderBodySchema.safeParse(
      await readJson(request),
    );
    if (!parsed.success) {
      throw validationError("Sipariş bilgileri geçersiz.", {
        issues: validationIssues(parsed.error).map((issue) => ({
          path: issue.path,
          code: issue.code,
          message: issue.message,
        })),
      });
    }

    const service = new OrderService(new DrizzleOrderRepository(getDb()));
    const created = await service.createOrder({
      restaurantId: context.restaurantId,
      tableId: context.tableId,
      tableAccessVersion: context.tokenVersion,
      // From the verified cookie via `requireCustomerTableContext`. The request
      // body schema is `.strict()` and has no field for this, so a caller
      // cannot name the sitting an order is stamped with.
      sessionNonce: context.sessionNonce,
      idempotencyKey: idempotency.data,
      items: parsed.data.items,
      notes: parsed.data.notes ?? parsed.data.note,
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
      {
        status: created.replayed ? 200 : 201,
        headers: RESPONSE_HEADERS,
      },
    );
  } catch (error) {
    const failure = apiFailureFromUnknown(error);
    if (failure.status >= 500) {
      logger.error("create_failed", "Customer order could not be created.", {
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
    }
    return NextResponse.json(failure.body, {
      status: failure.status,
      headers: { ...RESPONSE_HEADERS, ...retryAfterHeader(error) },
    });
  }
}
