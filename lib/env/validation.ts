import { EnvironmentConfigurationError, type EnvironmentIssue } from "./errors";

export type EnvironmentSource = Readonly<Record<string, string | undefined>>;

export const DEFAULT_SUPABASE_STORAGE_BUCKET = "product-images";

export interface PublicEnvironment {
  supabaseUrl: string;
  supabasePublishableKey: string;
}

export type ServerEnvironmentRequirement =
  | "database"
  | "supabase-admin"
  | "qr-token"
  | "customer-session"
  | "outbox-dispatch"
  | "maintenance"
  | "printer-agent";

export interface ServerEnvironment {
  databaseUrl?: string;
  supabaseUrl?: string;
  supabasePublishableKey?: string;
  supabaseServiceRoleKey?: string;
  qrTokenPepper?: string;
  authSecret?: string;
  rateLimitKeySecret?: string;
  outboxDispatchSecret?: string;
  maintenanceSecret?: string;
  printerAgentTokenPepper?: string;
  supabaseStorageBucket: string;
  logLevel: "debug" | "info" | "warn" | "error";
}

export type ValidationResult<T> =
  | { success: true; data: T }
  | { success: false; issues: readonly EnvironmentIssue[] };

const encoder = new TextEncoder();
const LOG_LEVELS = new Set(["debug", "info", "warn", "error"]);

function trimmed(source: EnvironmentSource, name: string): string | undefined {
  const value = source[name]?.trim();
  return value || undefined;
}

function issue(issues: EnvironmentIssue[], name: string, reason: string): void {
  issues.push({ name, reason });
}

function isLocalHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function validateSupabaseUrl(
  value: string | undefined,
  issues: EnvironmentIssue[],
): string | undefined {
  if (!value) return undefined;

  try {
    const url = new URL(value);
    const secure = url.protocol === "https:";
    const localDevelopment = url.protocol === "http:" && isLocalHostname(url.hostname);
    if (!secure && !localDevelopment) {
      issue(issues, "NEXT_PUBLIC_SUPABASE_URL", "must use HTTPS (HTTP is allowed only for localhost)");
      return undefined;
    }
    if (url.username || url.password || url.search || url.hash) {
      issue(issues, "NEXT_PUBLIC_SUPABASE_URL", "must not contain credentials, query parameters, or a fragment");
      return undefined;
    }
    return url.toString().replace(/\/$/, "");
  } catch {
    issue(issues, "NEXT_PUBLIC_SUPABASE_URL", "must be a valid absolute URL");
    return undefined;
  }
}

function validateSecret(
  value: string | undefined,
  name: string,
  issues: EnvironmentIssue[],
  minimumBytes: number,
): string | undefined {
  if (!value) return undefined;
  if (encoder.encode(value).byteLength < minimumBytes) {
    issue(issues, name, `must be at least ${minimumBytes} bytes`);
    return undefined;
  }
  return value;
}

function validateStorageBucket(
  value: string | undefined,
  issues: EnvironmentIssue[],
): string {
  const bucket = value ?? DEFAULT_SUPABASE_STORAGE_BUCKET;
  if (!/^[a-z0-9](?:[a-z0-9_-]{0,61}[a-z0-9])?$/.test(bucket)) {
    issue(
      issues,
      "SUPABASE_STORAGE_BUCKET",
      "must be 1-63 lowercase letters, numbers, hyphens, or underscores and have alphanumeric ends",
    );
  }
  return bucket;
}

function publicKey(source: EnvironmentSource): string | undefined {
  return (
    trimmed(source, "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY") ??
    trimmed(source, "NEXT_PUBLIC_SUPABASE_ANON_KEY")
  );
}

function publicEnvironmentPresence(source: EnvironmentSource): boolean {
  return Boolean(
    trimmed(source, "NEXT_PUBLIC_SUPABASE_URL") ||
      trimmed(source, "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY") ||
      trimmed(source, "NEXT_PUBLIC_SUPABASE_ANON_KEY"),
  );
}

export function validatePublicEnvironment(
  source: EnvironmentSource,
): ValidationResult<PublicEnvironment> {
  const issues: EnvironmentIssue[] = [];
  const supabaseUrl = validateSupabaseUrl(
    trimmed(source, "NEXT_PUBLIC_SUPABASE_URL"),
    issues,
  );
  const supabasePublishableKey = publicKey(source);

  if (!supabaseUrl && !issues.some((item) => item.name === "NEXT_PUBLIC_SUPABASE_URL")) {
    issue(issues, "NEXT_PUBLIC_SUPABASE_URL", "is required");
  }
  if (!supabasePublishableKey) {
    issue(
      issues,
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      "is required (NEXT_PUBLIC_SUPABASE_ANON_KEY is accepted during migration)",
    );
  } else if (supabasePublishableKey.length < 20) {
    issue(issues, "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "is not a valid Supabase public key");
  }

  if (issues.length || !supabaseUrl || !supabasePublishableKey) {
    return { success: false, issues };
  }
  return { success: true, data: { supabaseUrl, supabasePublishableKey } };
}

/** Returns null when Supabase is entirely unconfigured, but rejects partial config. */
export function validateOptionalPublicEnvironment(
  source: EnvironmentSource,
): ValidationResult<PublicEnvironment | null> {
  if (!publicEnvironmentPresence(source)) return { success: true, data: null };
  return validatePublicEnvironment(source);
}

export function parseOptionalPublicEnvironment(
  source: EnvironmentSource,
): PublicEnvironment | null {
  const result = validateOptionalPublicEnvironment(source);
  if (!result.success) throw new EnvironmentConfigurationError(result.issues);
  return result.data;
}

export function validateServerEnvironment(
  source: EnvironmentSource,
  requirements: readonly ServerEnvironmentRequirement[] = [],
): ValidationResult<ServerEnvironment> {
  const required = new Set(requirements);
  const issues: EnvironmentIssue[] = [];
  const databaseUrl = trimmed(source, "DATABASE_URL");
  const supabaseUrl = validateSupabaseUrl(trimmed(source, "NEXT_PUBLIC_SUPABASE_URL"), issues);
  const supabasePublishableKey = publicKey(source);
  const supabaseServiceRoleKey = trimmed(source, "SUPABASE_SERVICE_ROLE_KEY");
  const qrTokenPepper = validateSecret(
    trimmed(source, "QR_TOKEN_PEPPER"),
    "QR_TOKEN_PEPPER",
    issues,
    32,
  );
  const authSecret = validateSecret(
    trimmed(source, "AUTH_SECRET"),
    "AUTH_SECRET",
    issues,
    32,
  );
  const rateLimitKeySecret = validateSecret(
    trimmed(source, "RATE_LIMIT_KEY_SECRET"),
    "RATE_LIMIT_KEY_SECRET",
    issues,
    32,
  );
  const outboxDispatchSecret = validateSecret(
    trimmed(source, "OUTBOX_DISPATCH_SECRET"),
    "OUTBOX_DISPATCH_SECRET",
    issues,
    32,
  );
  const maintenanceSecret = validateSecret(
    trimmed(source, "MAINTENANCE_SECRET"),
    "MAINTENANCE_SECRET",
    issues,
    32,
  );
  const printerAgentTokenPepper = validateSecret(
    trimmed(source, "PRINTER_AGENT_TOKEN_PEPPER"),
    "PRINTER_AGENT_TOKEN_PEPPER",
    issues,
    32,
  );
  const supabaseStorageBucket = validateStorageBucket(
    trimmed(source, "SUPABASE_STORAGE_BUCKET"),
    issues,
  );
  const rawLogLevel = trimmed(source, "LOG_LEVEL")?.toLowerCase();
  const logLevel = LOG_LEVELS.has(rawLogLevel ?? "")
    ? (rawLogLevel as ServerEnvironment["logLevel"])
    : "info";

  if (rawLogLevel && !LOG_LEVELS.has(rawLogLevel)) {
    issue(issues, "LOG_LEVEL", "must be one of debug, info, warn, or error");
  }

  if (required.has("database")) {
    if (!databaseUrl) {
      issue(issues, "DATABASE_URL", "is required");
    } else {
      try {
        const protocol = new URL(databaseUrl).protocol;
        if (protocol !== "postgres:" && protocol !== "postgresql:") {
          issue(issues, "DATABASE_URL", "must use the postgres or postgresql protocol");
        }
      } catch {
        issue(issues, "DATABASE_URL", "must be a valid PostgreSQL connection URL");
      }
    }
  }

  if (required.has("supabase-admin")) {
    if (!supabaseUrl && !issues.some((item) => item.name === "NEXT_PUBLIC_SUPABASE_URL")) {
      issue(issues, "NEXT_PUBLIC_SUPABASE_URL", "is required for the Supabase admin client");
    }
    if (!supabaseServiceRoleKey) {
      issue(issues, "SUPABASE_SERVICE_ROLE_KEY", "is required for the Supabase admin client");
    } else if (supabaseServiceRoleKey.length < 20) {
      issue(issues, "SUPABASE_SERVICE_ROLE_KEY", "is not a valid service role key");
    }
  }

  if (required.has("qr-token") && !qrTokenPepper) {
    if (!issues.some((item) => item.name === "QR_TOKEN_PEPPER")) {
      issue(issues, "QR_TOKEN_PEPPER", "is required");
    }
  }
  if (required.has("customer-session") && !authSecret) {
    if (!issues.some((item) => item.name === "AUTH_SECRET")) {
      issue(issues, "AUTH_SECRET", "is required");
    }
  }
  if (required.has("outbox-dispatch") && !outboxDispatchSecret) {
    if (!issues.some((item) => item.name === "OUTBOX_DISPATCH_SECRET")) {
      issue(issues, "OUTBOX_DISPATCH_SECRET", "is required");
    }
  }
  if (required.has("maintenance")) {
    if (!maintenanceSecret) {
      if (!issues.some((item) => item.name === "MAINTENANCE_SECRET")) {
        issue(issues, "MAINTENANCE_SECRET", "is required");
      }
      // A shared credential would let an outbox scheduler leak escalate into
      // data deletion, so the two purposes must never carry the same value.
    } else if (maintenanceSecret === outboxDispatchSecret) {
      issue(issues, "MAINTENANCE_SECRET", "must differ from OUTBOX_DISPATCH_SECRET");
    }
  }

  if (required.has("printer-agent") && !printerAgentTokenPepper) {
    if (!issues.some((item) => item.name === "PRINTER_AGENT_TOKEN_PEPPER")) {
      issue(issues, "PRINTER_AGENT_TOKEN_PEPPER", "is required");
    }
  }

  if (issues.length) return { success: false, issues };
  return {
    success: true,
    data: {
      databaseUrl,
      supabaseUrl,
      supabasePublishableKey,
      supabaseServiceRoleKey,
      qrTokenPepper,
      authSecret,
      rateLimitKeySecret,
      outboxDispatchSecret,
      maintenanceSecret,
      printerAgentTokenPepper,
      supabaseStorageBucket,
      logLevel,
    },
  };
}

export function parseServerEnvironment(
  source: EnvironmentSource,
  requirements: readonly ServerEnvironmentRequirement[] = [],
): ServerEnvironment {
  const result = validateServerEnvironment(source, requirements);
  if (!result.success) throw new EnvironmentConfigurationError(result.issues);
  return result.data;
}
