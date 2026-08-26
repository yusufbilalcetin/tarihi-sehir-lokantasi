import { NextResponse } from "next/server";
import { z } from "zod";

import { getDb } from "@/db";
import { apiFailureFromUnknown, apiSuccess } from "@/lib/api/response";
import { validationError } from "@/lib/api/domain-error";
import { requireGuestOrderContext } from "@/lib/auth/guest-order-context";
import { ORDER_CHANNEL_LABELS } from "@/lib/domain/display";
import { DrizzleOrderRepository } from "@/lib/repositories/drizzle-order-repository";
import { createLogger } from "@/lib/security/logger";
import {
  ORDER_TRACKING_COOKIE,
  ORDER_TRACKING_TTL_SECONDS,
} from "@/lib/security/order-tracking-token";
import { issueOrderTrackingToken } from "@/lib/security/order-tracking-token.server";
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

/**
 * Takeaway and courier orders from the public page.
 *
 * The body carries what only the guest can know — what they want, who they
 * are, where it goes. It carries no restaurant, no table, no price and no
 * staff identity, and `.strict()` means sending one is a validation error
 * rather than something quietly ignored. The restaurant comes from the signed
 * guest session; the prices come from the catalogue; the table is null because
 * the channel says so.
 */
const createGuestOrderBodySchema = z
  .object({
    channel: z.enum(["TAKEAWAY", "DELIVERY"]),
    items: z.array(createOrderItemInputSchema).min(1).max(50),
    note: noteSchema,
    customerName: z.string().trim().min(2).max(160),
    contact: z.string().trim().min(7).max(80),
    address: z.string().trim().max(2000).optional(),
    deliveryNotes: z.string().trim().max(500).optional(),
  })
  .strict()
  .superRefine((order, refinement) => {
    if (order.channel === "DELIVERY" && !order.address) {
      refinement.addIssue({
        code: "custom",
        path: ["address"],
        message: "Kurye siparişi için teslimat adresi zorunludur.",
      });
    }
    if (order.channel === "TAKEAWAY" && order.address) {
      refinement.addIssue({
        code: "custom",
        path: ["address"],
        message: "Gel-al siparişinde teslimat adresi bulunmaz.",
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
const logger = createLogger("api.guest.orders");

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
    const context = await requireGuestOrderContext();
    await enforceRateLimit(request, "ORDER_CREATE", {
      restaurantId: context.restaurantId,
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
    const parsed = createGuestOrderBodySchema.safeParse(await readJson(request));
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
    const created = await service.createGuestOrder({
      restaurantId: context.restaurantId,
      channel: parsed.data.channel,
      idempotencyKey: idempotency.data,
      items: parsed.data.items,
      notes: parsed.data.note,
      fulfillment: {
        customerName: parsed.data.customerName,
        contact: parsed.data.contact,
        address: parsed.data.address ?? null,
        deliveryNotes: parsed.data.deliveryNotes ?? null,
      },
    });

    const response = NextResponse.json(
      apiSuccess({
        orderNumber: created.order.orderNumber,
        // The guest is told what kind of order they placed, in their words.
        // The raw channel never leaves the server.
        channelLabel: ORDER_CHANNEL_LABELS[created.order.channel],
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
    // The one thing that lets this guest — and only this guest — watch this
    // order afterwards. It is minted here rather than handed to the page,
    // because a capability the browser never reads is a capability a script on
    // the page cannot steal, and it names the order the server just created
    // rather than one a caller asked for. A replayed order re-issues it, so a
    // retried submit ends with a working tracking cookie either way.
    const tracking = issueOrderTrackingToken({
      restaurantId: context.restaurantId,
      orderId: created.order.id,
    });
    response.cookies.set({
      name: ORDER_TRACKING_COOKIE,
      value: tracking.token,
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: ORDER_TRACKING_TTL_SECONDS,
    });
    return response;
  } catch (error) {
    const failure = apiFailureFromUnknown(error);
    if (failure.status >= 500) {
      // The name only; a guest order body carries a person's phone and address.
      logger.error("create_failed", "Guest order could not be created.", {
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
    }
    return NextResponse.json(failure.body, {
      status: failure.status,
      headers: { ...RESPONSE_HEADERS, ...retryAfterHeader(error) },
    });
  }
}
