import assert from "node:assert/strict";
import test from "node:test";

import {
  QR_TOKEN_LENGTH,
  generateQrToken,
  generateRawQrToken,
  hashQrToken,
  isQrTokenFormat,
  qrTokenHashFingerprint,
  verifyQrToken,
} from "../../lib/security/qr-token.ts";

const pepperA = "a".repeat(48);
const pepperB = "b".repeat(48);

test("QR tokens contain 32 random URL-safe bytes", () => {
  const tokens = new Set(Array.from({ length: 64 }, () => generateRawQrToken()));
  assert.equal(tokens.size, 64);
  for (const token of tokens) {
    assert.equal(token.length, QR_TOKEN_LENGTH);
    assert.equal(isQrTokenFormat(token), true);
  }
});
test("only the HMAC digest is persisted and correct token verifies", () => {
  const generated = generateQrToken(pepperA);
  assert.ok(!generated.tokenHash.includes(generated.rawToken));
  assert.equal(verifyQrToken(generated.rawToken, generated.tokenHash, pepperA), true);
  assert.equal(verifyQrToken(generated.rawToken, generated.tokenHash, pepperB), false);
  assert.match(qrTokenHashFingerprint(generated.tokenHash), /^v1:[a-f0-9]{12}$/);
});

test("token and stored digest tampering are rejected", () => {
  const rawToken = generateRawQrToken();
  const tokenHash = hashQrToken(rawToken, pepperA);
  const changedToken = `${rawToken.slice(0, -1)}${rawToken.endsWith("A") ? "B" : "A"}`;
  const changedHash = `${tokenHash.slice(0, -1)}${tokenHash.endsWith("A") ? "B" : "A"}`;

  assert.equal(verifyQrToken(changedToken, tokenHash, pepperA), false);
  assert.equal(verifyQrToken(rawToken, changedHash, pepperA), false);
  assert.equal(verifyQrToken("demo-table", tokenHash, pepperA), false);
  assert.equal(verifyQrToken(rawToken, "v2.invalid", pepperA), false);
});

test("weak peppers and malformed raw tokens fail closed", () => {
  assert.throws(() => generateQrToken("short"), /at least 32 bytes/);
  assert.throws(() => hashQrToken("table-12", pepperA), /invalid format/);
});
