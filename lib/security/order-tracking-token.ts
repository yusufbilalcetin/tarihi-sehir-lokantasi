import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * The capability that lets a guest watch one order they placed.
 *
 * A takeaway or courier guest has no account and no table, and the order
 * number they are shown — ORD-000105 — is a display identifier: sequential,
 * printed on a receipt, and guessable by anyone who ordered ten minutes
 * earlier. So the number is what a person reads, and this is what authorises:
 * a signature over one order in one restaurant, minted when that order is
 * created and never derivable from anything the guest could type.
 *
 * The signing context is its own, distinct from the table session's and the
 * guest ordering session's. All three are signed with the same secret, and
 * that separation is what stops any of them being replayed as another: a
 * tracking token cannot order, an ordering session cannot track, and neither
 * opens a table.
 *
 * It deliberately carries no name, no telephone number, no address and no
 * delivery note. The token travels in a cookie the guest's own browser hands
 * back, and a token that carried those would be a copy of them sitting on the
 * wire and in the browser store for as long as it lives.
 */

export const ORDER_TRACKING_COOKIE = "sehir_order_tracking";

/**
 * One restaurant working day.
 *
 * The ordering session it outlives is an hour, because ordering is one act
 * done once; tracking has to survive the whole life of the food — placed at
 * noon, collected in the evening — and a guest who leaves the page and comes
 * back must not find the capability gone. It stops there rather than becoming
 * a standing customer identity: the day the order belonged to is over, and a
 * token that outlived it would be one more thing to steal.
 */
export const ORDER_TRACKING_TTL_SECONDS = 12 * 60 * 60;
export const ORDER_TRACKING_MAX_TTL_SECONDS = 24 * 60 * 60;

const TOKEN_VERSION = "v1";
const SIGNING_CONTEXT = "tarihi-sehir-lokantasi:order-tracking:v1\0";
const RESOURCE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const SIGNATURE_LENGTH = 43;
const NONCE_LENGTH = 22;
const MAX_TOKEN_LENGTH = 1_024;

export interface OrderTrackingClaims {
  version: 1;
  restaurantId: string;
  orderId: string;
  issuedAt: number;
  expiresAt: number;
  nonce: string;
}

export interface CreateOrderTrackingTokenInput {
  restaurantId: string;
  orderId: string;
  nowSeconds?: number;
  ttlSeconds?: number;
}

function signingSecret(secret: string | Uint8Array): Uint8Array {
  const bytes = typeof secret === "string" ? new TextEncoder().encode(secret) : secret;
  if (bytes.byteLength < 32) {
    throw new Error("Order tracking secret must be at least 32 bytes.");
  }
  return bytes;
}

function signPayload(payload: string, secret: string | Uint8Array): Buffer {
  return createHmac("sha256", signingSecret(secret))
    .update(SIGNING_CONTEXT, "utf8")
    .update(`${TOKEN_VERSION}.${payload}`, "utf8")
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

function isClaims(value: unknown): value is OrderTrackingClaims {
  if (!value || typeof value !== "object") return false;
  const claims = value as Partial<OrderTrackingClaims>;
  return (
    claims.version === 1 &&
    typeof claims.restaurantId === "string" &&
    RESOURCE_ID.test(claims.restaurantId) &&
    typeof claims.orderId === "string" &&
    RESOURCE_ID.test(claims.orderId) &&
    Number.isSafeInteger(claims.issuedAt) &&
    Number.isSafeInteger(claims.expiresAt) &&
    typeof claims.nonce === "string" &&
    claims.nonce.length === NONCE_LENGTH &&
    BASE64URL.test(claims.nonce)
  );
}

export function createOrderTrackingToken(
  input: CreateOrderTrackingTokenInput,
  secret: string | Uint8Array,
): { token: string; claims: OrderTrackingClaims } {
  if (!RESOURCE_ID.test(input.restaurantId)) {
    throw new Error("Restaurant has an invalid identifier.");
  }
  if (!RESOURCE_ID.test(input.orderId)) {
    throw new Error("Order has an invalid identifier.");
  }

  const issuedAt = input.nowSeconds ?? Math.floor(Date.now() / 1_000);
  const ttlSeconds = input.ttlSeconds ?? ORDER_TRACKING_TTL_SECONDS;
  if (!Number.isSafeInteger(issuedAt) || issuedAt < 0) {
    throw new Error("Order tracking issue time is invalid.");
  }
  if (
    !Number.isSafeInteger(ttlSeconds) ||
    ttlSeconds < 60 ||
    ttlSeconds > ORDER_TRACKING_MAX_TTL_SECONDS
  ) {
    throw new Error("Order tracking TTL is outside the allowed range.");
  }

  const claims: OrderTrackingClaims = {
    version: 1,
    restaurantId: input.restaurantId,
    orderId: input.orderId,
    issuedAt,
    expiresAt: issuedAt + ttlSeconds,
    nonce: randomBytes(16).toString("base64url"),
  };
  const payload = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
  const signature = signPayload(payload, secret).toString("base64url");
  return { token: `${TOKEN_VERSION}.${payload}.${signature}`, claims };
}

export function verifyOrderTrackingToken(
  token: unknown,
  secret: string | Uint8Array,
  nowSeconds: number = Math.floor(Date.now() / 1_000),
  clockSkewSeconds = 60,
): OrderTrackingClaims | null {
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
    version !== TOKEN_VERSION ||
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
  if (lifetime < 60 || lifetime > ORDER_TRACKING_MAX_TTL_SECONDS) return null;
  if (claims.issuedAt > nowSeconds + clockSkewSeconds) return null;
  if (claims.expiresAt <= nowSeconds - clockSkewSeconds) return null;
  return claims;
}
