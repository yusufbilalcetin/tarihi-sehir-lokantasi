import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

function read(relativePath: string): string {
  return readFileSync(join(process.cwd(), ...relativePath.split("/")), "utf8");
}

test("the shared Drizzle claim keeps the existing unique-key and row-lock protocol", () => {
  const helper = read("lib/repositories/drizzle-idempotency.ts");

  assert.match(
    helper,
    /target: \[idempotencyKeys\.restaurantId, idempotencyKeys\.scope, idempotencyKeys\.keyHash\]/,
  );
  assert.match(helper, /eq\(idempotencyKeys\.restaurantId, input\.restaurantId\)/);
  assert.match(helper, /eq\(idempotencyKeys\.scope, input\.scope\)/);
  assert.match(helper, /eq\(idempotencyKeys\.keyHash, input\.keyHash\)/);
  assert.match(helper, /\.for\("update"\)/);
});

test("restart and completion preserve the pre-extraction state transitions", () => {
  const helper = read("lib/repositories/drizzle-idempotency.ts");
  const restart = helper.slice(
    helper.indexOf("export async function restartIdempotencyRow"),
    helper.indexOf("export async function completeIdempotencyRow"),
  );
  const complete = helper.slice(helper.indexOf("export async function completeIdempotencyRow"));

  assert.match(restart, /requestHash: input\.requestHash/);
  assert.match(restart, /status: "PROCESSING"/);
  assert.match(restart, /responseStatus: null/);
  assert.match(restart, /responseBody: null/);
  assert.match(restart, /lockedUntil: input\.lockedUntil/);
  assert.match(restart, /expiresAt: input\.expiresAt/);

  assert.match(complete, /status: "COMPLETED"/);
  assert.match(complete, /responseStatus: input\.responseStatus/);
  assert.match(complete, /responseBody: input\.responseBody/);
  assert.match(complete, /lockedUntil: null/);
  assert.match(complete, /eq\(idempotencyKeys\.scope, input\.scope\)/);
});

test("orders and cash movements delegate all three operations to the shared helper", () => {
  for (const repository of [
    read("lib/repositories/drizzle-order-repository.ts"),
    read("lib/repositories/drizzle-cashier-shift-repository.ts"),
  ]) {
    assert.match(repository, /return claimIdempotencyRow\(this\.db, input\)/);
    assert.match(repository, /return restartIdempotencyRow\(this\.db, input\)/);
    assert.match(repository, /return completeIdempotencyRow\(this\.db, input\)/);
  }
});
