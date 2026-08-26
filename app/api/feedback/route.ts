import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db";
import { validationError } from "@/lib/api/domain-error";
import { apiFailureFromUnknown, apiSuccess } from "@/lib/api/response";
import { requireCustomerTableContext } from "@/lib/auth/customer-table-context";
import { createLogger } from "@/lib/security/logger";
import { assertTrustedMutationOrigin } from "@/lib/security/origin";
import { CustomerFeedbackService } from "@/lib/services/customer-feedback-service";
import { validationIssues } from "@/lib/validation";

const schema = z.object({ orderId: z.uuid().optional().nullable().transform((value) => value ?? null), rating: z.number().int().min(1).max(5), foodRating: z.number().int().min(1).max(5).optional().nullable().transform((value) => value ?? null), serviceRating: z.number().int().min(1).max(5).optional().nullable().transform((value) => value ?? null), cleanlinessRating: z.number().int().min(1).max(5).optional().nullable().transform((value) => value ?? null), comment: z.string().trim().max(1000).optional().nullable().transform((value) => value || null) }).strict();
const headers = { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie, Origin" } as const;
const logger = createLogger("api.customer.feedback");

export async function POST(request: Request) {
  try {
    assertTrustedMutationOrigin(request);
    const context = await requireCustomerTableContext();
    let body: unknown;
    try { body = await request.json(); } catch { throw validationError("Geçersiz JSON gövdesi."); }
    const parsed = schema.safeParse(body);
    if (!parsed.success) throw validationError("Geri bildirim bilgileri geçersiz.", { issues: validationIssues(parsed.error).map((issue) => ({ ...issue })) });
    const result = await new CustomerFeedbackService(getDb()).create({ restaurantId: context.restaurantId, tableId: context.tableId, tokenVersion: context.tokenVersion, ...parsed.data });
    return NextResponse.json(apiSuccess(result), { status: 201, headers });
  } catch (error) {
    const failure = apiFailureFromUnknown(error);
    if (failure.status >= 500) logger.error("create_failed", "Customer feedback could not be recorded.", { errorName: error instanceof Error ? error.name : "UnknownError" });
    return NextResponse.json(failure.body, { status: failure.status, headers });
  }
}
