import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

const REQUIRED_CONFIRMATION = "I_UNDERSTAND_TEMPORARY_DATA_WILL_BE_CREATED";

export interface SupabaseIntegrationEnvironment {
  readonly url: string;
  readonly anonKey: string;
  readonly serviceRoleKey: string;
  readonly databaseUrl?: string;
  readonly projectRef: string;
}

export type SupabaseIntegrationReadiness =
  | {
      readonly ready: true;
      readonly environment: SupabaseIntegrationEnvironment;
    }
  | {
      readonly ready: false;
      readonly reason: string;
    };

function isLoopbackHostname(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname.endsWith(".localhost")
  );
}

function remoteProjectRef(url: URL): string | null {
  const match = /^([a-z0-9-]+)\.supabase\.co$/i.exec(url.hostname);
  return match?.[1] ?? null;
}

function hostnameOf(value: string | undefined): string | null {
  if (!value?.trim()) return null;
  try {
    return new URL(value.trim()).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** `user@host`, the pair that actually decides which rows a connection reaches. */
function databaseIdentityOf(value: string | undefined): string | null {
  if (!value?.trim()) return null;
  try {
    const parsed = new URL(value.trim());
    if (!parsed.hostname) return null;
    return `${parsed.username}@${parsed.hostname}`.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * A deliberate statement that the shared target holds nothing worth keeping.
 *
 * It exists for the one legitimate case the collision rule would otherwise
 * block: a developer whose own `.env.local` already points the application at
 * the disposable TEST project. It is a separate variable with an exact value,
 * so it cannot be satisfied by copying live credentials, and it is powerless on
 * its own — every other opt-in, the confirmation token and the production
 * markers are still enforced.
 */
function declaresDisposableTarget(): boolean {
  return (
    process.env.SUPABASE_INTEGRATION_TEST_TARGET_CLASS?.trim() === "DISPOSABLE_TEST"
  );
}

/**
 * The remaining way to lose real data: point the dedicated test variables at the
 * project the application itself uses. Every other check here only proves the
 * test variables agree with each other, which a copy-paste of the live values
 * satisfies perfectly.
 *
 * A shared loopback stack is exempt: running the app and the suite against the
 * same local Supabase is the documented development setup, and nothing there is
 * production data.
 */
function collidesWithApplicationTarget(
  url: URL,
  databaseUrl: string | undefined,
): string | null {
  if (declaresDisposableTarget()) return null;

  if (!isLoopbackHostname(url.hostname)) {
    const applicationHost = hostnameOf(process.env.NEXT_PUBLIC_SUPABASE_URL);
    if (applicationHost && applicationHost === url.hostname.toLowerCase()) {
      return "SUPABASE_INTEGRATION_TEST_URL points at the same Supabase project as NEXT_PUBLIC_SUPABASE_URL. Integration tests write orders, payments and audit history; use a disposable project.";
    }
  }

  const testIdentity = databaseIdentityOf(databaseUrl);
  if (!testIdentity) return null;

  const testHost = testIdentity.split("@")[1] ?? "";
  if (isLoopbackHostname(testHost)) return null;

  const applicationIdentity = databaseIdentityOf(process.env.DATABASE_URL);
  if (applicationIdentity && applicationIdentity === testIdentity) {
    return "SUPABASE_INTEGRATION_TEST_DATABASE_URL resolves to the same database identity as DATABASE_URL. Integration tests write orders, payments and audit history; use a disposable database.";
  }
  return null;
}

/**
 * Integration tests intentionally use their own variables instead of falling
 * back to application production secrets. Running them requires two explicit
 * opt-ins, and remote projects additionally require their project ref to be
 * repeated. This makes an accidental production execution substantially less
 * likely while still supporting local Supabase.
 */
export function readSupabaseIntegrationEnvironment(options: {
  readonly requireDatabaseUrl?: boolean;
} = {}): SupabaseIntegrationReadiness {
  if (process.env.RUN_SUPABASE_INTEGRATION_TESTS !== "true") {
    return {
      ready: false,
      reason:
        "Supabase integration tests are opt-in; set RUN_SUPABASE_INTEGRATION_TESTS=true for a dedicated test project.",
    };
  }

  if (
    process.env.NODE_ENV === "production" ||
    process.env.VERCEL_ENV === "production"
  ) {
    return {
      ready: false,
      reason: "Supabase integration tests are disabled in production environments.",
    };
  }

  if (process.env.SUPABASE_INTEGRATION_TEST_CONFIRM !== REQUIRED_CONFIRMATION) {
    return {
      ready: false,
      reason:
        `Set SUPABASE_INTEGRATION_TEST_CONFIRM=${REQUIRED_CONFIRMATION} after selecting a disposable test project.`,
    };
  }

  const urlValue = process.env.SUPABASE_INTEGRATION_TEST_URL?.trim();
  const anonKey = process.env.SUPABASE_INTEGRATION_TEST_ANON_KEY?.trim();
  const serviceRoleKey =
    process.env.SUPABASE_INTEGRATION_TEST_SERVICE_ROLE_KEY?.trim();
  const databaseUrl =
    process.env.SUPABASE_INTEGRATION_TEST_DATABASE_URL?.trim();

  const missing = [
    !urlValue && "SUPABASE_INTEGRATION_TEST_URL",
    !anonKey && "SUPABASE_INTEGRATION_TEST_ANON_KEY",
    !serviceRoleKey && "SUPABASE_INTEGRATION_TEST_SERVICE_ROLE_KEY",
    options.requireDatabaseUrl &&
      !databaseUrl &&
      "SUPABASE_INTEGRATION_TEST_DATABASE_URL",
  ].filter((name): name is string => Boolean(name));

  if (missing.length > 0) {
    return {
      ready: false,
      reason: `Missing dedicated integration-test configuration: ${missing.join(", ")}.`,
    };
  }

  let url: URL;
  try {
    url = new URL(urlValue!);
  } catch {
    return {
      ready: false,
      reason: "SUPABASE_INTEGRATION_TEST_URL must be an absolute URL.",
    };
  }

  const projectRef = remoteProjectRef(url);
  if (!isLoopbackHostname(url.hostname)) {
    if (!projectRef) {
      return {
        ready: false,
        reason:
          "Remote integration targets must be an explicit <project-ref>.supabase.co test project.",
      };
    }
    if (process.env.SUPABASE_INTEGRATION_TEST_PROJECT_REF !== projectRef) {
      return {
        ready: false,
        reason:
          "SUPABASE_INTEGRATION_TEST_PROJECT_REF must exactly match the dedicated remote test project URL.",
      };
    }
  }

  if (anonKey === serviceRoleKey) {
    return {
      ready: false,
      reason: "The anonymous and service-role integration keys must be different.",
    };
  }

  if (databaseUrl) {
    let parsedDatabaseUrl: URL;
    try {
      parsedDatabaseUrl = new URL(databaseUrl);
    } catch {
      return {
        ready: false,
        reason: "SUPABASE_INTEGRATION_TEST_DATABASE_URL must be a PostgreSQL URL.",
      };
    }
    if (!['postgres:', 'postgresql:'].includes(parsedDatabaseUrl.protocol)) {
      return {
        ready: false,
        reason: "SUPABASE_INTEGRATION_TEST_DATABASE_URL must use postgres:// or postgresql://.",
      };
    }

    if (projectRef) {
      const databaseIdentity = `${parsedDatabaseUrl.username}@${parsedDatabaseUrl.hostname}`;
      if (!databaseIdentity.includes(projectRef)) {
        return {
          ready: false,
          reason:
            "The integration database URL does not match SUPABASE_INTEGRATION_TEST_PROJECT_REF.",
        };
      }
    } else if (!isLoopbackHostname(parsedDatabaseUrl.hostname)) {
      return {
        ready: false,
        reason: "Local Supabase integration tests require a loopback database URL.",
      };
    }
  }

  const collision = collidesWithApplicationTarget(url, databaseUrl);
  if (collision) {
    return { ready: false, reason: collision };
  }

  return {
    ready: true,
    environment: {
      url: url.toString().replace(/\/$/, ""),
      anonKey: anonKey!,
      serviceRoleKey: serviceRoleKey!,
      databaseUrl,
      projectRef: projectRef ?? "local",
    },
  };
}

export const SUPABASE_INTEGRATION_CONFIRMATION = REQUIRED_CONFIRMATION;
