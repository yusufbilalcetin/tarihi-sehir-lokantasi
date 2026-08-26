import { NextResponse } from "next/server";
import { z } from "zod";

import { getDb } from "@/db";
import { apiFailureFromUnknown, apiSuccess } from "@/lib/api/response";
import { validationError } from "@/lib/api/domain-error";
import { requireCustomerTableContext } from "@/lib/auth/customer-table-context";
import { DrizzleWaiterCallRepository } from "@/lib/repositories/drizzle-waiter-call-repository";
import { createLogger } from "@/lib/security/logger";
import { assertTrustedMutationOrigin } from "@/lib/security/origin";
import { enforceRateLimit } from "@/lib/security/rate-limit.server";
import { retryAfterHeader } from "@/lib/security/rate-limit-response";
import { WaiterCallService } from "@/lib/services/waiter-call-service";
import { noteSchema, validationIssues } from "@/lib/validation/common";

export const runtime = "nodejs";

const requestSchema = z.object({ notes: noteSchema }).strict();
const RESPONSE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Vary: "Cookie, Origin",
} as const;
const logger = createLogger("api.customer.bill-requests");

async function readOptionalJson(request: Request): Promise<unknown> {
  const body = await request.text();
  if (!body.trim()) return {};
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw validationError("Geçersiz JSON gövdesi.");
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    assertTrustedMutationOrigin(request);
    const context = await requireCustomerTableContext();
    await enforceRateLimit(request, "BILL_REQUEST", {
      restaurantId: context.restaurantId,
      tableId: context.tableId,
    });
    const parsed = requestSchema.safeParse(await readOptionalJson(request));
    if (!parsed.success) {
      throw validationError("Hesap isteği geçersiz.", {
        issues: validationIssues(parsed.error).map((issue) => ({
          path: issue.path,
          code: issue.code,
          message: issue.message,
        })),
      });
    }
    const service = new WaiterCallService(
      new DrizzleWaiterCallRepository(getDb()),
    );
    const requestResult = await service.createBillRequest({
      restaurantId: context.restaurantId,
      tableId: context.tableId,
      tableAccessVersion: context.tokenVersion,
      notes: parsed.data.notes,
    });
    return NextResponse.json(apiSuccess(requestResult), {
      status: requestResult.replayed ? 200 : 201,
      headers: RESPONSE_HEADERS,
    });
  } catch (error) {
    const failure = apiFailureFromUnknown(error);
    if (failure.status >= 500) {
      logger.error("create_failed", "Bill request could not be created.", {
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
    }
    return NextResponse.json(failure.body, {
      status: failure.status,
      headers: { ...RESPONSE_HEADERS, ...retryAfterHeader(error) },
    });
  }
}
