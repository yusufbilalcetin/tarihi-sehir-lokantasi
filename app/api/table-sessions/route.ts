import { NextResponse } from "next/server";
import { z } from "zod";

import { apiFailureFromUnknown, apiSuccess } from "@/lib/api/response";
import { isDomainError, validationError } from "@/lib/api/domain-error";
import { establishCustomerTableSession } from "@/lib/auth/menu-gate.server";
import {
  CUSTOMER_TABLE_SESSION_COOKIE,
  CUSTOMER_TABLE_SESSION_TTL_SECONDS,
} from "@/lib/security/customer-session";
import { tableTokenSchema, validationIssues } from "@/lib/validation/common";
import { createLogger } from "@/lib/security/logger";
import { assertTrustedMutationOrigin } from "@/lib/security/origin";
import { enforceRateLimit } from "@/lib/security/rate-limit.server";
import { retryAfterHeader } from "@/lib/security/rate-limit-response";

export const runtime = "nodejs";

const requestSchema = z.object({ tableToken: tableTokenSchema }).strict();
const NO_STORE_HEADERS = { "Cache-Control": "no-store" } as const;
const logger = createLogger("api.table-sessions");

export async function POST(request: Request): Promise<NextResponse> {
  try {
    assertTrustedMutationOrigin(request);
    await enforceRateLimit(request, "QR_VALIDATE");

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw validationError("Gecersiz JSON govdesi.");
    }

    const parsed = requestSchema.safeParse(body);
    if (!parsed.success) {
      throw validationError("Masa baglantisi gecersiz.", {
        issues: validationIssues(parsed.error).map((issue) => ({
          path: issue.path,
          code: issue.code,
          message: issue.message,
        })),
      });
    }

    const established = await establishCustomerTableSession(parsed.data.tableToken);

    const response = NextResponse.json(
      apiSuccess({
        restaurant: established.restaurant,
        table: established.table,
        session: {
          expiresAt: established.expiresAt,
        },
      }),
      { status: 200, headers: NO_STORE_HEADERS },
    );
    response.cookies.set({
      name: CUSTOMER_TABLE_SESSION_COOKIE,
      value: established.sessionToken,
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: CUSTOMER_TABLE_SESSION_TTL_SECONDS,
    });
    return response;
  } catch (error) {
    if (!isDomainError(error) || error.httpStatus >= 500) {
      logger.error("validation_failed", "Table-session validation failed.", {
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
    }
    const failure = apiFailureFromUnknown(error);
    return NextResponse.json(failure.body, {
      status: failure.status,
      headers: { ...NO_STORE_HEADERS, ...retryAfterHeader(error) },
    });
  }
}
