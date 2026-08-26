import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { isDomainError } from "@/lib/api/domain-error";
import { getOptionalPublicEnvironment } from "@/lib/env/public";
import { createLogger } from "@/lib/security/logger";
import { assertTrustedMutationOrigin } from "@/lib/security/origin";
import { enforceRateLimit } from "@/lib/security/rate-limit.server";
import { retryAfterHeader } from "@/lib/security/rate-limit-response";

export const runtime = "nodejs";

/**
 * Completes onboarding: the holder of a one-time setup link chooses their own
 * password.
 *
 * The recovery token is redeemed on a client built with
 * `persistSession: false`, so the session it produces lives only inside this
 * request and no auth cookie is ever written. That matters here more than
 * anywhere else: `resolveStaffPrincipal` turns *any* valid Supabase session for
 * an active profile into a full staff principal, so a recovery session that
 * reached the browser would be a way into the panels without ever setting a
 * password. It cannot, because it never leaves this function.
 *
 * The request carries a token and a new password and nothing else. Role,
 * restaurant and account state are never read from it, so this route cannot
 * change who someone is — only what they know.
 */
const INVALID_LINK =
  "Bağlantı geçersiz veya süresi dolmuş. Yöneticinizden yeni bir kurulum bağlantısı isteyin.";
const UNAVAILABLE = "Şifre belirlenemedi. Lütfen tekrar deneyin.";
const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-cache, no-store, must-revalidate, max-age=0",
  Expires: "0",
  Pragma: "no-cache",
} as const;

/** Long enough to be worth having; the provider enforces its own policy too. */
const MINIMUM_PASSWORD_LENGTH = 10;
const MAXIMUM_PASSWORD_LENGTH = 1024;

const logger = createLogger("staff.set-password");

export async function POST(request: Request): Promise<NextResponse> {
  try {
    assertTrustedMutationOrigin(request);

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const tokenHash = body?.tokenHash;
    const password = body?.password;

    if (
      typeof tokenHash !== "string" ||
      tokenHash.trim().length === 0 ||
      tokenHash.length > 512 ||
      typeof password !== "string"
    ) {
      // Never says which half was wrong: the token is a credential.
      return NextResponse.json(
        { error: INVALID_LINK },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }

    if (password.length < MINIMUM_PASSWORD_LENGTH || password.length > MAXIMUM_PASSWORD_LENGTH) {
      return NextResponse.json(
        { error: `Şifre en az ${MINIMUM_PASSWORD_LENGTH} karakter olmalıdır.` },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }

    // Keyed on the token so a stolen link cannot be brute-forced through this
    // route, and so one person's attempts never lock out another's.
    await enforceRateLimit(request, "STAFF_PASSWORD_RESET", { identifier: tokenHash });

    const environment = getOptionalPublicEnvironment();
    if (!environment) {
      logger.error("staff.set_password.unconfigured", "Supabase is not configured.");
      return NextResponse.json(
        { error: UNAVAILABLE },
        { status: 503, headers: NO_STORE_HEADERS },
      );
    }

    // The publishable key, never the service role: this route redeems a token
    // the caller already holds, it does not act on anyone's behalf.
    const supabase = createClient(environment.supabaseUrl, environment.supabasePublishableKey, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    });

    const verified = await supabase.auth.verifyOtp({ type: "recovery", token_hash: tokenHash });
    if (verified.error || !verified.data.session) {
      // Invalid, already used and expired all answer the same way.
      logger.warn("staff.set_password.rejected", "Setup link was rejected.", {
        reason: "INVALID_OR_EXPIRED_TOKEN",
      });
      return NextResponse.json(
        { error: INVALID_LINK },
        { status: 401, headers: NO_STORE_HEADERS },
      );
    }

    // Only the password. Nothing in this call can touch the role, the
    // restaurant, the email or the account's active state.
    const updated = await supabase.auth.updateUser({ password });
    if (updated.error) {
      logger.warn("staff.set_password.refused", "Provider refused the new password.", {
        reason: "PASSWORD_REJECTED",
      });
      // The link is gone either way: verifyOtp above already redeemed it, and a
      // one-time token cannot be handed back. Saying otherwise would send the
      // holder round a loop that can no longer succeed. Common causes are a
      // password the provider considers too weak, or the one already in use.
      await supabase.auth.signOut().catch(() => undefined);
      return NextResponse.json(
        {
          error:
            "Şifre kabul edilmedi; farklı ve daha güçlü bir şifre gerekiyor. " +
            "Bu kurulum bağlantısı kullanıldı, yöneticinizden yeni bir bağlantı isteyin.",
        },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }

    // The in-memory session has done its job; end it rather than let it idle.
    await supabase.auth.signOut().catch(() => undefined);

    logger.info("staff.set_password.completed", "Staff password was set from a setup link.");
    return NextResponse.json(
      { redirectTo: "/staff/login" },
      { status: 200, headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    if (isDomainError(error)) {
      return NextResponse.json(
        { error: error.code === "RATE_LIMITED" ? error.message : INVALID_LINK },
        {
          status: error.httpStatus,
          headers: { ...NO_STORE_HEADERS, ...retryAfterHeader(error) },
        },
      );
    }
    logger.error("staff.set_password.unavailable", "Password setup could not be completed.", {
      error,
    });
    return NextResponse.json(
      { error: UNAVAILABLE },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }
}
