"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getOptionalPublicEnvironment } from "@/lib/env/public";
import { SUPABASE_AUTH_COOKIE_OPTIONS } from "./cookie-options";

let browserClient: SupabaseClient | null = null;

/** Build-safe: returns null until both public Supabase variables are configured. */
export function getSupabaseBrowserClient(): SupabaseClient | null {
  if (browserClient) return browserClient;
  const environment = getOptionalPublicEnvironment();
  if (!environment) return null;

  browserClient = createBrowserClient(
    environment.supabaseUrl,
    environment.supabasePublishableKey,
    { cookieOptions: SUPABASE_AUTH_COOKIE_OPTIONS },
  );
  return browserClient;
}
