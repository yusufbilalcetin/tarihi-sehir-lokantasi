import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { getServerEnvironment } from "@/lib/env/server";

let adminClient: SupabaseClient | null = null;

/** Service-role client. Never import this module from UI or expose it to users. */
export function getSupabaseAdminClient(): SupabaseClient {
  if (adminClient) return adminClient;
  const environment = getServerEnvironment(["supabase-admin"]);
  adminClient = createClient(
    environment.supabaseUrl!,
    environment.supabaseServiceRoleKey!,
    {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
    },
  );
  return adminClient;
}
