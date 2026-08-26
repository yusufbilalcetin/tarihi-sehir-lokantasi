import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

const REQUIRED_CONFIRMATION = "I_UNDERSTAND_THIS_MUTATES_A_DISPOSABLE_TEST_FIXTURE";
const REQUIRED_TARGET_CLASS = "DISPOSABLE_TEST";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const QR_TOKEN = /^[A-Za-z0-9_-]{43}$/;

export interface HttpE2eStaffCredential {
  readonly identifier: string;
  readonly password: string;
}

export interface HttpE2eEnvironment {
  readonly baseUrl: URL;
  readonly rawTableToken: string;
  readonly productId: string;
  readonly waiter: HttpE2eStaffCredential;
  readonly kitchen: HttpE2eStaffCredential;
  readonly cashier: HttpE2eStaffCredential;
  readonly otherTenantStaff: HttpE2eStaffCredential;
  /** Optional: only the Phase 4 admin CRUD flow needs it. */
  readonly admin: HttpE2eStaffCredential | null;
}

export type HttpE2eReadiness =
  | { readonly ready: true; readonly environment: HttpE2eEnvironment }
  | { readonly ready: false; readonly reason: string };

function loopback(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname.endsWith(".localhost")
  );
}

function credential(prefix: string): HttpE2eStaffCredential | null {
  const identifier = process.env[`SEHIR_HTTP_E2E_${prefix}_IDENTIFIER`]?.trim();
  const password = process.env[`SEHIR_HTTP_E2E_${prefix}_PASSWORD`];
  return identifier && password ? { identifier, password } : null;
}

/**
 * HTTP E2E never falls back to an application's ordinary deployment values.
 * The target origin must be repeated verbatim and classified as disposable,
 * preventing an incomplete config from silently targeting a live restaurant.
 */
export function readHttpE2eEnvironment(): HttpE2eReadiness {
  if (process.env.RUN_SEHIR_HTTP_E2E_TESTS !== "true") {
    return {
      ready: false,
      reason:
        "HTTP E2E is opt-in; set RUN_SEHIR_HTTP_E2E_TESTS=true only for a dedicated running test deployment.",
    };
  }
  if (
    process.env.NODE_ENV === "production" ||
    process.env.VERCEL_ENV === "production"
  ) {
    return {
      ready: false,
      reason: "HTTP E2E mutations are disabled in production environments.",
    };
  }
  if (
    process.env.SEHIR_HTTP_E2E_CONFIRM !== REQUIRED_CONFIRMATION ||
    process.env.SEHIR_HTTP_E2E_TARGET_CLASS !== REQUIRED_TARGET_CLASS
  ) {
    return {
      ready: false,
      reason:
        "HTTP E2E requires the disposable-target confirmation and target classification.",
    };
  }

  const baseUrlValue = process.env.SEHIR_HTTP_E2E_BASE_URL?.trim();
  const allowedOrigin = process.env.SEHIR_HTTP_E2E_ALLOWED_ORIGIN?.trim();
  const rawTableToken = process.env.SEHIR_HTTP_E2E_QR_TOKEN?.trim();
  const productId = process.env.SEHIR_HTTP_E2E_PRODUCT_ID?.trim();
  const waiter = credential("WAITER");
  const kitchen = credential("KITCHEN");
  const cashier = credential("CASHIER");
  const otherTenantStaff = credential("OTHER_TENANT");
  const admin = credential("ADMIN");
  const missing = [
    !baseUrlValue && "SEHIR_HTTP_E2E_BASE_URL",
    !allowedOrigin && "SEHIR_HTTP_E2E_ALLOWED_ORIGIN",
    !rawTableToken && "SEHIR_HTTP_E2E_QR_TOKEN",
    !productId && "SEHIR_HTTP_E2E_PRODUCT_ID",
    !waiter && "SEHIR_HTTP_E2E_WAITER_IDENTIFIER/PASSWORD",
    !kitchen && "SEHIR_HTTP_E2E_KITCHEN_IDENTIFIER/PASSWORD",
    !cashier && "SEHIR_HTTP_E2E_CASHIER_IDENTIFIER/PASSWORD",
    !otherTenantStaff && "SEHIR_HTTP_E2E_OTHER_TENANT_IDENTIFIER/PASSWORD",
  ].filter((name): name is string => Boolean(name));
  if (missing.length > 0) {
    return {
      ready: false,
      reason: `Missing dedicated HTTP E2E configuration: ${missing.join(", ")}.`,
    };
  }

  let baseUrl: URL;
  try {
    baseUrl = new URL(baseUrlValue!);
  } catch {
    return { ready: false, reason: "SEHIR_HTTP_E2E_BASE_URL must be an absolute URL." };
  }
  if (
    baseUrl.username ||
    baseUrl.password ||
    baseUrl.search ||
    baseUrl.hash ||
    (baseUrl.pathname !== "/" && baseUrl.pathname !== "")
  ) {
    return {
      ready: false,
      reason: "SEHIR_HTTP_E2E_BASE_URL must contain only a deployment origin.",
    };
  }
  if (!loopback(baseUrl.hostname) && baseUrl.protocol !== "https:") {
    return {
      ready: false,
      reason: "Remote HTTP E2E deployments must use HTTPS.",
    };
  }
  if (allowedOrigin !== baseUrl.origin) {
    return {
      ready: false,
      reason: "SEHIR_HTTP_E2E_ALLOWED_ORIGIN must exactly repeat the target origin.",
    };
  }

  const productionHost = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (productionHost && baseUrl.host === productionHost.replace(/^https?:\/\//, "")) {
    return {
      ready: false,
      reason: "HTTP E2E refuses the Vercel project production hostname.",
    };
  }
  if (!QR_TOKEN.test(rawTableToken!)) {
    return { ready: false, reason: "SEHIR_HTTP_E2E_QR_TOKEN has an invalid format." };
  }
  if (!UUID.test(productId!)) {
    return { ready: false, reason: "SEHIR_HTTP_E2E_PRODUCT_ID must be a UUID." };
  }

  return {
    ready: true,
    environment: {
      baseUrl,
      rawTableToken: rawTableToken!,
      productId: productId!,
      waiter: waiter!,
      kitchen: kitchen!,
      cashier: cashier!,
      otherTenantStaff: otherTenantStaff!,
      admin,
    },
  };
}

export const HTTP_E2E_CONFIRMATION = REQUIRED_CONFIRMATION;
