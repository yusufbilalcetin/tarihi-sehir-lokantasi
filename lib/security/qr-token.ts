import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const QR_TOKEN_BYTES = 32;
export const QR_TOKEN_LENGTH = 43;
export const QR_TOKEN_HASH_VERSION = "v1";

const QR_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const HASH_CONTEXT = "tarihi-sehir-lokantasi:table-qr:v1\0";
const MINIMUM_PEPPER_BYTES = 32;

export interface GeneratedQrToken {
  /** Deliver once to the QR generator. Never persist or log this value. */
  rawToken: string;
  /** Persist this versioned digest in tables.qr_token_hash. */
  tokenHash: string;
}

function pepperBytes(pepper: string | Uint8Array): Uint8Array {
  const bytes = typeof pepper === "string" ? new TextEncoder().encode(pepper) : pepper;
  if (bytes.byteLength < MINIMUM_PEPPER_BYTES) {
    throw new Error("QR token pepper must be at least 32 bytes.");
  }
  return bytes;
}

function tokenDigest(rawToken: string, pepper: string | Uint8Array): Buffer {
  return createHmac("sha256", pepperBytes(pepper))
    .update(HASH_CONTEXT, "utf8")
    .update(rawToken, "utf8")
    .digest();
}

function parseStoredDigest(storedHash: string): Buffer | null {
  const [version, encoded, ...rest] = storedHash.split(".");
  if (
    rest.length ||
    version !== QR_TOKEN_HASH_VERSION ||
    !encoded ||
    !QR_TOKEN_PATTERN.test(encoded)
  ) {
    return null;
  }

  const decoded = Buffer.from(encoded, "base64url");
  if (decoded.byteLength !== 32 || decoded.toString("base64url") !== encoded) return null;
  return decoded;
}

export function isQrTokenFormat(value: unknown): value is string {
  if (typeof value !== "string" || !QR_TOKEN_PATTERN.test(value)) return false;
  const decoded = Buffer.from(value, "base64url");
  return decoded.byteLength === QR_TOKEN_BYTES && decoded.toString("base64url") === value;
}

export function generateRawQrToken(): string {
  return randomBytes(QR_TOKEN_BYTES).toString("base64url");
}

export function hashQrToken(rawToken: string, pepper: string | Uint8Array): string {
  if (!isQrTokenFormat(rawToken)) {
    throw new Error("QR token has an invalid format.");
  }
  return `${QR_TOKEN_HASH_VERSION}.${tokenDigest(rawToken, pepper).toString("base64url")}`;
}

/**
 * Compares fixed-size HMAC digests with timingSafeEqual. A malformed stored hash
 * is compared against a zero digest before returning false to avoid an early
 * secret-dependent digest comparison.
 */
export function verifyQrToken(
  candidate: unknown,
  storedHash: string,
  pepper: string | Uint8Array,
): boolean {
  const candidateString = typeof candidate === "string" ? candidate : "";
  const candidateIsValid = isQrTokenFormat(candidateString);
  // Do not HMAC an attacker-controlled, unbounded malformed string.
  const candidateDigest = tokenDigest(candidateIsValid ? candidateString : "", pepper);
  const parsedDigest = parseStoredDigest(storedHash);
  const expectedDigest = parsedDigest ?? Buffer.alloc(candidateDigest.byteLength);
  const digestMatches = timingSafeEqual(candidateDigest, expectedDigest);
  return candidateIsValid && parsedDigest !== null && digestMatches;
}

export function generateQrToken(pepper: string | Uint8Array): GeneratedQrToken {
  const rawToken = generateRawQrToken();
  return { rawToken, tokenHash: hashQrToken(rawToken, pepper) };
}

/** Safe correlation value derived from an already-hashed token. */
export function qrTokenHashFingerprint(storedHash: string): string {
  const digest = parseStoredDigest(storedHash);
  return digest ? `${QR_TOKEN_HASH_VERSION}:${digest.toString("hex").slice(0, 12)}` : "invalid";
}
