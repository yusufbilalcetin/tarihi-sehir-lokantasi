import "server-only";

import type { EnvironmentSource } from "./validation";
import {
  parseServerEnvironment,
  type ServerEnvironment,
  type ServerEnvironmentRequirement,
} from "./validation";

function serverEnvironmentSource(): EnvironmentSource {
  return {
    DATABASE_URL: process.env.DATABASE_URL,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    QR_TOKEN_PEPPER: process.env.QR_TOKEN_PEPPER,
    AUTH_SECRET: process.env.AUTH_SECRET,
    RATE_LIMIT_KEY_SECRET: process.env.RATE_LIMIT_KEY_SECRET,
    OUTBOX_DISPATCH_SECRET: process.env.OUTBOX_DISPATCH_SECRET,
    MAINTENANCE_SECRET: process.env.MAINTENANCE_SECRET,
    PRINTER_AGENT_TOKEN_PEPPER: process.env.PRINTER_AGENT_TOKEN_PEPPER,
    SUPABASE_STORAGE_BUCKET: process.env.SUPABASE_STORAGE_BUCKET,
    LOG_LEVEL: process.env.LOG_LEVEL,
  };
}

/** Lazy, capability-scoped validation; importing this module never reads secrets. */
export function getServerEnvironment(
  requirements: readonly ServerEnvironmentRequirement[] = [],
): ServerEnvironment {
  return parseServerEnvironment(serverEnvironmentSource(), requirements);
}

export function getQrTokenPepper(): string {
  return getServerEnvironment(["qr-token"]).qrTokenPepper!;
}

export function getCustomerSessionSecret(): string {
  return getServerEnvironment(["customer-session"]).authSecret!;
}

export function getPrinterAgentTokenPepper(): string {
  return getServerEnvironment(["printer-agent"]).printerAgentTokenPepper!;
}

export function getSupabaseStorageBucket(): string {
  return getServerEnvironment().supabaseStorageBucket;
}
