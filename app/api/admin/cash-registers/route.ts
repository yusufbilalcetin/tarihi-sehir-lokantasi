import type { NextResponse } from "next/server";

import { adminMutation, adminRead, parseBody } from "@/lib/api/admin-route";
import { CashRegisterService } from "@/lib/services/cash-register-service";
import { createCashRegisterBodySchema } from "@/lib/validation/cashier-shift";

export const runtime = "nodejs";

export async function GET(): Promise<NextResponse> {
  return adminRead("api.admin.cash-registers", async ({ principal }) => ({
    registers: await new CashRegisterService().list(principal),
  }));
}

export async function POST(request: Request): Promise<NextResponse> {
  return adminMutation(
    request,
    "api.admin.cash-registers",
    async ({ principal, requestId }) => {
      const body = await parseBody(
        request,
        createCashRegisterBodySchema,
        "Kasa bilgileri geçersiz.",
      );
      return new CashRegisterService().create(principal, { ...body, requestId });
    },
    201,
  );
}
