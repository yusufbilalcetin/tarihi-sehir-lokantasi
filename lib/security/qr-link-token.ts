import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * The stable, re-derivable QR credential.
 *
 * The original credential is 32 random bytes whose HMAC is all the database
 * keeps, which is the right shape for a secret but the wrong shape for a code
 * that is printed once and glued to a table: nobody — administrator included —
 * can ever look at it again, so "show me this table's QR" could only be
 * answered by minting a new one and silently voiding the printed card.
 *
 * This credential is derived instead of drawn. It carries the two facts the
 * server needs to find the row (the restaurant's public slug and the table
 * number printed on the card itself, never a database identifier) plus an HMAC
 * over those facts and the table's current access version. Nothing new is
 * stored, no plaintext token exists anywhere, and the same table always yields
 * the same string until its access version moves — which is exactly what
 * rotation and revocation already do.
 *
 * It stands beside the random token rather than replacing it: cards printed
 * from the old scheme keep working until their table is explicitly rotated.
 */

export const QR_LINK_TOKEN_VERSION = "l1";
export const QR_LINK_MAC_LENGTH = 43;

const SIGNING_CONTEXT = "tarihi-sehir-lokantasi:table-qr-link:v1\0";
const MINIMUM_PEPPER_BYTES = 32;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAC_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const MAX_SLUG_LENGTH = 120;
const MAX_TABLE_NUMBER = 1_000_000;

export interface QrLinkClaims {
  /** The restaurant's public slug. Already visible to every guest. */
  readonly restaurantSlug: string;
  /** The number printed on the table card. Not a database identifier. */
  readonly tableNumber: number;
  /** `restaurant_tables.qr_token_version`; bumped by rotation and revocation. */
  readonly accessVersion: number;
}

export interface ParsedQrLinkToken {
  readonly restaurantSlug: string;
  readonly tableNumber: number;
  readonly mac: string;
}

function pepperBytes(pepper: string | Uint8Array): Uint8Array {
  const bytes = typeof pepper === "string" ? new TextEncoder().encode(pepper) : pepper;
  if (bytes.byteLength < MINIMUM_PEPPER_BYTES) {
    throw new Error("QR token pepper must be at least 32 bytes.");
  }
  return bytes;
}

function assertClaims(claims: QrLinkClaims): void {
  if (
    typeof claims.restaurantSlug !== "string" ||
    claims.restaurantSlug.length > MAX_SLUG_LENGTH ||
    !SLUG_PATTERN.test(claims.restaurantSlug)
  ) {
    throw new Error("QR link claims carry an invalid restaurant slug.");
  }
  if (
    !Number.isSafeInteger(claims.tableNumber) ||
    claims.tableNumber < 1 ||
    claims.tableNumber > MAX_TABLE_NUMBER
  ) {
    throw new Error("QR link claims carry an invalid table number.");
  }
  if (!Number.isSafeInteger(claims.accessVersion) || claims.accessVersion < 1) {
    throw new Error("QR link claims carry an invalid access version.");
  }
}

function linkMac(claims: QrLinkClaims, pepper: string | Uint8Array): Buffer {
  return createHmac("sha256", pepperBytes(pepper))
    .update(SIGNING_CONTEXT, "utf8")
    .update(
      `${claims.restaurantSlug}\0${claims.tableNumber}\0${claims.accessVersion}`,
      "utf8",
    )
    .digest();
}

/** Splits a candidate without touching the pepper, so malformed input is cheap. */
export function parseQrLinkToken(value: unknown): ParsedQrLinkToken | null {
  if (typeof value !== "string") return null;
  const parts = value.split(".");
  if (parts.length !== 4) return null;
  const [version, restaurantSlug, tableNumber, mac] = parts;
  if (
    version !== QR_LINK_TOKEN_VERSION ||
    restaurantSlug.length > MAX_SLUG_LENGTH ||
    !SLUG_PATTERN.test(restaurantSlug) ||
    !/^[1-9][0-9]{0,6}$/.test(tableNumber) ||
    !MAC_PATTERN.test(mac)
  ) {
    return null;
  }
  const parsedNumber = Number(tableNumber);
  if (parsedNumber > MAX_TABLE_NUMBER) return null;
  return { restaurantSlug, tableNumber: parsedNumber, mac };
}

export function isQrLinkTokenFormat(value: unknown): value is string {
  return parseQrLinkToken(value) !== null;
}

export function deriveQrLinkToken(
  claims: QrLinkClaims,
  pepper: string | Uint8Array,
): string {
  assertClaims(claims);
  const mac = linkMac(claims, pepper).toString("base64url");
  return `${QR_LINK_TOKEN_VERSION}.${claims.restaurantSlug}.${claims.tableNumber}.${mac}`;
}

/**
 * Constant-time comparison against the MAC the claims imply. The caller reads
 * the claims from the database row the token pointed at, so a token whose slug
 * or table number was edited simply fails to match.
 */
export function verifyQrLinkToken(
  candidate: unknown,
  claims: QrLinkClaims,
  pepper: string | Uint8Array,
): boolean {
  const parsed = parseQrLinkToken(candidate);
  if (!parsed) return false;
  let expected: Buffer;
  try {
    assertClaims(claims);
    expected = linkMac(claims, pepper);
  } catch {
    return false;
  }
  const supplied = Buffer.from(parsed.mac, "base64url");
  if (supplied.byteLength !== expected.byteLength) return false;
  return (
    timingSafeEqual(supplied, expected) &&
    parsed.restaurantSlug === claims.restaurantSlug &&
    parsed.tableNumber === claims.tableNumber
  );
}
