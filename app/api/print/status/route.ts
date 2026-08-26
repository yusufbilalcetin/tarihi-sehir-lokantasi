import type { NextResponse } from "next/server";
import { z } from "zod";

import { parseParams } from "@/lib/api/admin-route";
import { staffRead } from "@/lib/api/staff-route";
import { PrintService } from "@/lib/services/print-service";
import { entityIdSchema } from "@/lib/validation/common";

export const runtime = "nodejs";

/**
 * Whether the kitchen tickets for these orders reached their printers.
 *
 * Read-only and tenant-scoped: it answers only for orders in the caller's own
 * restaurant, and only with a status word — never with a payload, a printer
 * address or an error trace.
 */
const querySchema = z
  .object({
    orderIds: z
      .string()
      .trim()
      .min(1)
      .transform((value) => value.split(",").filter(Boolean))
      .pipe(z.array(entityIdSchema).min(1).max(60)),
  })
  .strict();

export async function GET(request: Request): Promise<NextResponse> {
  return staffRead(
    ["ADMIN", "MANAGER", "CASHIER", "WAITER", "KITCHEN"],
    "api.print.status",
    async ({ principal }) => {
      const query = parseParams(
        Object.fromEntries(new URL(request.url).searchParams),
        querySchema,
        "Sipariş listesi geçersiz.",
      );
      return {
        statuses: await new PrintService().kitchenTicketStatus(principal, query.orderIds),
      };
    },
  );
}
