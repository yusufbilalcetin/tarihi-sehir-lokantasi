import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const CUSTOMER_TABLE_SESSION_COOKIE = "sehir_table_session";
export const CUSTOMER_TABLE_SESSION_TTL_SECONDS = 4 * 60 * 60;
export const CUSTOMER_TABLE_SESSION_MAX_TTL_SECONDS = 12 * 60 * 60;

const SESSION_VERSION = "v1";
const SIGNING_CONTEXT = "tarihi-sehir-lokantasi:customer-table-session:v1\0";
const RESOURCE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const SIGNATURE_LENGTH = 43;
const NONCE_LENGTH = 22;
const MAX_TOKEN_LENGTH = 1_024;

export interface CustomerTableSessionClaims {
  version: 1;
  restaurantId: string;
  tableId: string;
  /** Increment/rotate in the database to revoke all sessions for a table. */
  accessVersion: number;
  issuedAt: number;
  expiresAt: number;
  nonce: string;
}

export interface CreateCustomerTableSessionInput {
  restaurantId: string;
  tableId: string;
  accessVersion: number;
  nowSeconds?: number;
  ttlSeconds?: number;
}

function signingSecret(secret: string | Uint8Array): Uint8Array {
  const bytes = typeof secret === "string" ? new TextEncoder().encode(secret) : secret;
  if (bytes.byteLength < 32) {
    throw new Error("Customer session secret must be at least 32 bytes.");
  }
  return bytes;
}

function assertResourceId(value: string, label: string): void {
  if (!RESOURCE_ID.test(value)) throw new Error(`${label} has an invalid identifier.`);
}

function signPayload(payload: string, secret: string | Uint8Array): Buffer {
  return createHmac("sha256", signingSecret(secret))
    .update(SIGNING_CONTEXT, "utf8")
    .update(`${SESSION_VERSION}.${payload}`, "utf8")
    .digest();
}

function decodePayload(encoded: string): unknown {
  if (!BASE64URL.test(encoded)) return null;
  const bytes = Buffer.from(encoded, "base64url");
  if (bytes.toString("base64url") !== encoded) return null;
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    return null;
  }
}

function isClaims(value: unknown): value is CustomerTableSessionClaims {
  if (!value || typeof value !== "object") return false;
  const claims = value as Partial<CustomerTableSessionClaims>;
  return (
    claims.version === 1 &&
    typeof claims.restaurantId === "string" &&
    RESOURCE_ID.test(claims.restaurantId) &&
    typeof claims.tableId === "string" &&
    RESOURCE_ID.test(claims.tableId) &&
    Number.isSafeInteger(claims.accessVersion) &&
    claims.accessVersion! >= 0 &&
    Number.isSafeInteger(claims.issuedAt) &&
    Number.isSafeInteger(claims.expiresAt) &&
    typeof claims.nonce === "string" &&
    claims.nonce.length === NONCE_LENGTH &&
    BASE64URL.test(claims.nonce)
  );
}

export function createCustomerTableSession(
  input: CreateCustomerTableSessionInput,
  secret: string | Uint8Array,
): { token: string; claims: CustomerTableSessionClaims } {
  assertResourceId(input.restaurantId, "Restaurant");
  assertResourceId(input.tableId, "Table");
  if (!Number.isSafeInteger(input.accessVersion) || input.accessVersion < 0) {
    throw new Error("Table access version must be a non-negative safe integer.");
  }

  const issuedAt = input.nowSeconds ?? Math.floor(Date.now() / 1_000);
  const ttlSeconds = input.ttlSeconds ?? CUSTOMER_TABLE_SESSION_TTL_SECONDS;
  if (!Number.isSafeInteger(issuedAt) || issuedAt < 0) {
    throw new Error("Customer session issue time is invalid.");
  }
  if (
    !Number.isSafeInteger(ttlSeconds) ||
    ttlSeconds < 60 ||
    ttlSeconds > CUSTOMER_TABLE_SESSION_MAX_TTL_SECONDS
  ) {
    throw new Error("Customer session TTL is outside the allowed range.");
  }

  const claims: CustomerTableSessionClaims = {
    version: 1,
    restaurantId: input.restaurantId,
    tableId: input.tableId,
    accessVersion: input.accessVersion,
    issuedAt,
    expiresAt: issuedAt + ttlSeconds,
    nonce: randomBytes(16).toString("base64url"),
  };
  const payload = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
  const signature = signPayload(payload, secret).toString("base64url");
  return { token: `${SESSION_VERSION}.${payload}.${signature}`, claims };
}

export function verifyCustomerTableSession(
  token: unknown,
  secret: string | Uint8Array,
  nowSeconds: number = Math.floor(Date.now() / 1_000),
  clockSkewSeconds = 60,
): CustomerTableSessionClaims | null {
  if (
    typeof token !== "string" ||
    token.length > MAX_TOKEN_LENGTH ||
    !Number.isSafeInteger(nowSeconds) ||
    !Number.isSafeInteger(clockSkewSeconds) ||
    clockSkewSeconds < 0
  ) {
    return null;
  }

  const [version, payload, encodedSignature, ...rest] = token.split(".");
  if (
    rest.length ||
    version !== SESSION_VERSION ||
    !payload ||
    !encodedSignature ||
    encodedSignature.length !== SIGNATURE_LENGTH ||
    !BASE64URL.test(encodedSignature)
  ) {
    return null;
  }

  const receivedSignature = Buffer.from(encodedSignature, "base64url");
  if (
    receivedSignature.byteLength !== 32 ||
    receivedSignature.toString("base64url") !== encodedSignature
  ) {
    return null;
  }
  const expectedSignature = signPayload(payload, secret);
  if (!timingSafeEqual(receivedSignature, expectedSignature)) return null;

  const claims = decodePayload(payload);
  if (!isClaims(claims)) return null;
  const lifetime = claims.expiresAt - claims.issuedAt;
  if (lifetime < 60 || lifetime > CUSTOMER_TABLE_SESSION_MAX_TTL_SECONDS) return null;
  if (claims.issuedAt > nowSeconds + clockSkewSeconds) return null;
  if (claims.expiresAt <= nowSeconds - clockSkewSeconds) return null;
  return claims;
}
