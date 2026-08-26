import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { establishCustomerTableSession } from "@/lib/auth/menu-gate.server";
import { VALIDATED_TABLE_NUMBER_HEADER } from "@/lib/auth/menu-gate";
import { isProtectedStaffPath } from "@/lib/auth/role-access";
import { SESSION_COOKIE, readSessionRole } from "@/lib/auth/session";
import { isDomainError } from "@/lib/api/domain-error";
import { getOptionalPublicEnvironment } from "@/lib/env/public";
import { SUPABASE_AUTH_COOKIE_OPTIONS } from "@/lib/supabase/cookie-options";
import {
  CUSTOMER_TABLE_SESSION_COOKIE,
  CUSTOMER_TABLE_SESSION_TTL_SECONDS,
} from "@/lib/security/customer-session";
import { createLogger } from "@/lib/security/logger";
import { enforceRateLimit } from "@/lib/security/rate-limit.server";

const INVALID_MENU_PATH = "/menu/invalid";
const logger = createLogger("proxy");

/** Next.js reads the nonce back out of the request's own CSP header. */
export const CSP_NONCE_HEADER = "x-nonce";

/**
 * The exact Supabase origin when it is configured, and only then the wildcard.
 * Narrowing this is the point: with `strict-dynamic` an injected script still
 * needs somewhere to talk to, and `*.supabase.co` is every project on the
 * platform rather than this restaurant's.
 */
function supabaseOrigins(): string {
  const configured = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const wildcard = " https://*.supabase.co wss://*.supabase.co";
  if (!configured) return wildcard;
  try {
    const url = new URL(configured);
    const websocketProtocol = url.protocol === "http:" ? "ws:" : "wss:";
    return ` ${url.origin} ${websocketProtocol}//${url.host}`;
  } catch {
    return wildcard;
  }
}

/**
 * Built per request because the nonce is. `style-src` deliberately keeps
 * `'unsafe-inline'`: several components still set inline `style` attributes,
 * and tightening it is a separate audit rather than a side effect of this one.
 */
function contentSecurityPolicy(nonce: string): string {
  const development = process.env.NODE_ENV !== "production";
  const supabase = supabaseOrigins();
  return [
    "default-src 'self'",
    // 'strict-dynamic' lets the framework's nonced bootstrap load the chunks it
    // needs without every chunk URL having to be listed here.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob:${supabase}`,
    "font-src 'self' data:",
    `connect-src 'self'${supabase}${development ? " ws://localhost:* ws://127.0.0.1:*" : ""}`,
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "media-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-src 'none'",
    "frame-ancestors 'none'",
    ...(development ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}

function redirectWithCookies(
  request: NextRequest,
  source: NextResponse,
  pathname: string,
): NextResponse {
  const redirect = NextResponse.redirect(new URL(pathname, request.url));
  for (const cookie of source.cookies.getAll()) redirect.cookies.set(cookie);
  for (const header of ["cache-control", "expires", "pragma"] as const) {
    const value = source.headers.get(header);
    if (value) redirect.headers.set(header, value);
  }
  return redirect;
}

/**
 * Refreshes the provider session and performs only a coarse authentication
 * check. Layouts and API handlers still resolve staff_profiles and enforce
 * roles/restaurant scope; proxy is never the authorization boundary.
 */
export async function handleStaffAuth(
  request: NextRequest,
  requestHeaders: Headers,
): Promise<NextResponse> {
  const environment = getOptionalPublicEnvironment();
  const forward = { request: { headers: requestHeaders } };

  if (!environment) {
    const role = await readSessionRole(request.cookies.get(SESSION_COOKIE)?.value);
    const needsAdmin = request.nextUrl.pathname.startsWith("/admin");
    if (!role || (needsAdmin && role !== "admin")) {
      return NextResponse.redirect(new URL("/staff/login", request.url));
    }
    return NextResponse.next(forward);
  }

  let response = NextResponse.next(forward);
  const supabase = createServerClient(
    environment.supabaseUrl,
    environment.supabasePublishableKey,
    {
      cookieOptions: SUPABASE_AUTH_COOKIE_OPTIONS,
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet, headersToSet) => {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next(forward);
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
          for (const [name, value] of Object.entries(headersToSet)) {
            response.headers.set(name, value);
          }
        },
      },
    },
  );

  // getUser verifies the token with Supabase Auth and refreshes it when needed.
  // Do not replace this with getSession()/unverified JWT claims.
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    return redirectWithCookies(request, response, "/staff/login");
  }

  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  return response;
}

function rawTableToken(pathname: string): string | null {
  if (!pathname.startsWith("/menu/") || pathname === INVALID_MENU_PATH) return null;
  const segments = pathname.slice("/menu/".length).split("/");
  return segments.length === 1 && segments[0] ? segments[0] : null;
}

function invalidMenuRedirect(request: NextRequest): NextResponse {
  const response = NextResponse.redirect(new URL(INVALID_MENU_PATH, request.url));
  response.cookies.delete(CUSTOMER_TABLE_SESSION_COOKIE);
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  return response;
}

/**
 * The QR URL credential is exchanged at the network boundary. Downstream UI
 * receives only the non-sensitive table number plus a signed HttpOnly cookie.
 */
export async function handleSecureMenuGate(
  request: NextRequest,
  requestHeaders: Headers,
): Promise<NextResponse> {
  const token = rawTableToken(request.nextUrl.pathname);
  if (!token) return invalidMenuRedirect(request);

  try {
    await enforceRateLimit(request, "QR_VALIDATE");
    const established = await establishCustomerTableSession(token);
    requestHeaders.set(
      VALIDATED_TABLE_NUMBER_HEADER,
      String(established.table.tableNumber),
    );
    const response = NextResponse.next({ request: { headers: requestHeaders } });
    response.cookies.set({
      name: CUSTOMER_TABLE_SESSION_COOKIE,
      value: established.sessionToken,
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: CUSTOMER_TABLE_SESSION_TTL_SECONDS,
    });
    response.headers.set("Cache-Control", "private, no-store, max-age=0");
    return response;
  } catch (error) {
    if (!isDomainError(error) || error.httpStatus >= 500) {
      logger.error("menu_gate.failed", "Secure menu validation failed.", {
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
    }
    return invalidMenuRedirect(request);
  }
}

async function route(
  request: NextRequest,
  requestHeaders: Headers,
): Promise<NextResponse> {
  // `/staff/login` is not a protected prefix, so widening the matcher to carry
  // the nonce everywhere cannot send the login page into a redirect loop.
  if (isProtectedStaffPath(request.nextUrl.pathname)) {
    return handleStaffAuth(request, requestHeaders);
  }

  if (
    request.nextUrl.pathname === "/menu" ||
    (request.nextUrl.pathname.startsWith("/menu/") &&
      request.nextUrl.pathname !== INVALID_MENU_PATH)
  ) {
    return handleSecureMenuGate(request, requestHeaders);
  }

  return NextResponse.next({ request: { headers: requestHeaders } });
}

export async function proxy(request: NextRequest) {
  const nonce = crypto.randomUUID().replaceAll("-", "");
  const policy = contentSecurityPolicy(nonce);

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(CSP_NONCE_HEADER, nonce);
  // Next.js reads the nonce from the *request* header and stamps it onto its
  // own bootstrap and streaming scripts during render.
  requestHeaders.set("Content-Security-Policy", policy);

  // Set once, on the way out, so redirects and the invalid-menu branch are
  // covered as well as the ordinary response.
  const response = await route(request, requestHeaders);
  response.headers.set("Content-Security-Policy", policy);
  return response;
}

export const config = {
  // Everything that renders HTML needs the nonce, so the matcher is an
  // exclusion list. Static assets and image optimisation carry no scripts and
  // are skipped; prefetches are skipped so they cannot be served a stale nonce.
  matcher: [
    {
      source: "/((?!_next/static|_next/image|favicon.ico|icons/|images/).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
