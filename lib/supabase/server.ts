import "server-only";

import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

import { getOptionalPublicEnvironment } from "@/lib/env/public";
import { SUPABASE_AUTH_COOKIE_OPTIONS } from "./cookie-options";

/**
 * Request-scoped Supabase Auth/Realtime client. Staff routes use this provider
 * whenever public Supabase configuration exists; legacy auth is selected only
 * by the centralized compatibility layer when Supabase is entirely absent.
 */
export async function createSupabaseServerClient(): Promise<SupabaseClient | null> {
  const environment = getOptionalPublicEnvironment();
  if (!environment) return null;
  const cookieStore = await cookies();

  return createServerClient(
    environment.supabaseUrl,
    environment.supabasePublishableKey,
    {
      cookieOptions: SUPABASE_AUTH_COOKIE_OPTIONS,
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Server Components cannot write cookies. A request proxy/Route
            // Handler must own refresh persistence when Supabase Auth is enabled.
          }
        },
      },
    },
  );
}
