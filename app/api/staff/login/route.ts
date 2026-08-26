import { NextResponse } from "next/server";

import { isDomainError } from "@/lib/api/domain-error";
import { authenticateStaff } from "@/lib/auth/staff-login";
import {
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
} from "@/lib/auth/session";
import { createLogger } from "@/lib/security/logger";
import { assertTrustedMutationOrigin } from "@/lib/security/origin";
import { enforceRateLimit } from "@/lib/security/rate-limit.server";
import { retryAfterHeader } from "@/lib/security/rate-limit-response";

const INVALID_CREDENTIALS = "Giriş bilgileri geçersiz.";
const LOGIN_UNAVAILABLE = "Giriş yapılamadı. Lütfen tekrar deneyin.";
const AUTH_RESPONSE_HEADERS = {
  "Cache-Control": "private, no-cache, no-store, must-revalidate, max-age=0",
  Expires: "0",
  Pragma: "no-cache",
} as const;
const logger = createLogger("staff-login");

export async function POST(request: Request) {
  try {
    assertTrustedMutationOrigin(request);
    const body = await request.json().catch(() => null);
    const values = (body ?? {}) as Record<string, unknown>;
    const identifier = values.identifier ?? values.email ?? values.code;
    const password = values.password ?? values.pin;

    if (
      typeof identifier !== "string" ||
      typeof password !== "string" ||
      identifier.trim().length === 0 ||
      identifier.length > 320 ||
      password.length === 0 ||
      password.length > 1024
    ) {
      logger.warn("staff.login.rejected", "Staff login was rejected.", {
        reason: "MALFORMED_CREDENTIALS",
      });
      return NextResponse.json(
        { error: INVALID_CREDENTIALS },
        { status: 400, headers: AUTH_RESPONSE_HEADERS },
      );
    }

    await enforceRateLimit(request, "STAFF_LOGIN", {
      identifier: identifier.trim().toLowerCase(),
    });
    const result = await authenticateStaff({
      identifier,
      password,
    });

    if (!result.success) {
      logger.warn("staff.login.rejected", "Staff login was rejected.", {
        reason: "INVALID_CREDENTIALS",
        provider: result.provider,
      });
      return NextResponse.json(
        { error: INVALID_CREDENTIALS },
        { status: 401, headers: AUTH_RESPONSE_HEADERS },
      );
    }

    const response = NextResponse.json(
      { redirectTo: result.redirectTo },
      { headers: AUTH_RESPONSE_HEADERS },
    );
    if (result.provider === "LEGACY_HMAC") {
      response.cookies.set(SESSION_COOKIE, result.legacySessionToken, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: SESSION_TTL_SECONDS,
      });
    } else {
      // Prevent an old compatibility cookie from surviving a Supabase login.
      response.cookies.delete(SESSION_COOKIE);
    }

    return response;
  } catch (error) {
    if (isDomainError(error)) {
      if (error.code === "RATE_LIMITED") {
        logger.warn("staff.login.rate_limited", "Staff login was rate limited.");
      }
      return NextResponse.json(
        { error: error.code === "RATE_LIMITED" ? error.message : INVALID_CREDENTIALS },
        {
          status: error.httpStatus,
          headers: { ...AUTH_RESPONSE_HEADERS, ...retryAfterHeader(error) },
        },
      );
    }
    logger.error("staff.login.unavailable", "Staff login provider is unavailable.", {
      error,
    });
    return NextResponse.json(
      { error: LOGIN_UNAVAILABLE },
      { status: 503, headers: AUTH_RESPONSE_HEADERS },
    );
  }
}
