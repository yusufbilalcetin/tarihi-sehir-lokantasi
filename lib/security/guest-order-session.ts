import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * The ordering context for a guest who is not sitting at a table.
 *
 * Takeaway and courier orders arrive from a public page, so there is no QR
 * token to identify the restaurant. What identifies it is this: the server
 * resolves the restaurant from the public slug in the URL, checks it is
 * active, and mints a short-lived signed cookie. Every subsequent request
 * reads the restaurant from that cookie — never from the request body, which
 * is the one thing a caller can freely rewrite.
 *
 * The signing context is deliberately different from the table session's. A
 * table token must never validate here and an ordering token must never open
 * a table, even though both are signed with the same secret: domain
 * separation is what keeps one from being replayed as the other.
 *
 * It is shorter-lived than a table session because a person ordering takeaway
 * is doing one thing once, not sitting down for an evening.
 */

export const GUEST_ORDER_SESSION_COOKIE = "sehir_guest_order";
export const GUEST_ORDER_SESSION_TTL_SECONDS = 60 * 60;
export const GUEST_ORDER_SESSION_MAX_TTL_SECONDS = 2 * 60 * 60;

const SESSION_VERSION = "v1";
const SIGNING_CONTEXT = "tarihi-sehir-lokantasi:guest-order-session:v1\0";
const RESOURCE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const SIGNATURE_LENGTH = 43;
const NONCE_LENGTH = 22;
const MAX_TOKEN_LENGTH = 1_024;

export interface GuestOrderSessionClaims {
  version: 1;
  restaurantId: string;
  issuedAt: number;
  expiresAt: number;
  nonce: string;
}

export interface CreateGuestOrderSessionInput {
  restaurantId: string;
  nowSeconds?: number;
  ttlSeconds?: number;
}

function signingSecret(secret: string | Uint8Array): Uint8Array {
  const bytes = typeof secret === "string" ? new TextEncoder().encode(secret) : secret;
  if (bytes.byteLength < 32) {
    throw new Error("Guest order session secret must be at least 32 bytes.");
  }
  return bytes;
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

function isClaims(value: unknown): value is GuestOrderSessionClaims {
  if (!value || typeof value !== "object") return false;
  const claims = value as Partial<GuestOrderSessionClaims>;
  return (
    claims.version === 1 &&
    typeof claims.restaurantId === "string" &&
    RESOURCE_ID.test(claims.restaurantId) &&
    Number.isSafeInteger(claims.issuedAt) &&
    Number.isSafeInteger(claims.expiresAt) &&
    typeof claims.nonce === "string" &&
    claims.nonce.length === NONCE_LENGTH &&
    BASE64URL.test(claims.nonce)
  );
}

export function createGuestOrderSession(
  input: CreateGuestOrderSessionInput,
  secret: string | Uint8Array,
): { token: string; claims: GuestOrderSessionClaims } {
  if (!RESOURCE_ID.test(input.restaurantId)) {
    throw new Error("Restaurant has an invalid identifier.");
  }

  const issuedAt = input.nowSeconds ?? Math.floor(Date.now() / 1_000);
  const ttlSeconds = input.ttlSeconds ?? GUEST_ORDER_SESSION_TTL_SECONDS;
  if (!Number.isSafeInteger(issuedAt) || issuedAt < 0) {
    throw new Error("Guest order session issue time is invalid.");
  }
  if (
    !Number.isSafeInteger(ttlSeconds) ||
    ttlSeconds < 60 ||
    ttlSeconds > GUEST_ORDER_SESSION_MAX_TTL_SECONDS
  ) {
    throw new Error("Guest order session TTL is outside the allowed range.");
  }

  const claims: GuestOrderSessionClaims = {
    version: 1,
    restaurantId: input.restaurantId,
    issuedAt,
    expiresAt: issuedAt + ttlSeconds,
    nonce: randomBytes(16).toString("base64url"),
  };
  const payload = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
  const signature = signPayload(payload, secret).toString("base64url");
  return { token: `${SESSION_VERSION}.${payload}.${signature}`, claims };
}

export function verifyGuestOrderSession(
  token: unknown,
  secret: string | Uint8Array,
  nowSeconds: number = Math.floor(Date.now() / 1_000),
  clockSkewSeconds = 60,
): GuestOrderSessionClaims | null {
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
  if (lifetime < 60 || lifetime > GUEST_ORDER_SESSION_MAX_TTL_SECONDS) return null;
  if (claims.issuedAt > nowSeconds + clockSkewSeconds) return null;
  if (claims.expiresAt <= nowSeconds - clockSkewSeconds) return null;
  return claims;
}
