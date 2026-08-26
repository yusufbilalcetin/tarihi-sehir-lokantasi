import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { apiFailureFromUnknown } from "@/lib/api/response";
import { SESSION_COOKIE } from "@/lib/auth/session";
import { getOptionalPublicEnvironment } from "@/lib/env/public";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { assertTrustedMutationOrigin } from "@/lib/security/origin";

const AUTH_RESPONSE_HEADERS = {
  "Cache-Control": "private, no-cache, no-store, must-revalidate, max-age=0",
  Expires: "0",
  Pragma: "no-cache",
} as const;

function isSupabaseAuthCookie(name: string): boolean {
  return name.startsWith("sb-") && name.includes("-auth-token");
}

export async function POST(request: Request) {
  try {
    assertTrustedMutationOrigin(request);
  } catch (error) {
    const failure = apiFailureFromUnknown(error);
    return NextResponse.json(failure.body, {
      status: failure.status,
      headers: AUTH_RESPONSE_HEADERS,
    });
  }

  try {
    if (getOptionalPublicEnvironment()) {
      const supabase = await createSupabaseServerClient();
      await supabase?.auth.signOut({ scope: "local" });
    }
  } catch {
    // Cookie deletion below remains authoritative for this browser even when
    // the provider is temporarily unavailable.
  }

  const cookieStore = await cookies();
  const response = NextResponse.json(
    { redirectTo: "/staff/login" },
    { headers: AUTH_RESPONSE_HEADERS },
  );
  response.cookies.delete(SESSION_COOKIE);

  for (const cookie of cookieStore.getAll()) {
    if (isSupabaseAuthCookie(cookie.name)) response.cookies.delete(cookie.name);
  }

  return response;
}
