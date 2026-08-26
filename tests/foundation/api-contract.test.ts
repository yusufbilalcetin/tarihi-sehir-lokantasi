import assert from "node:assert/strict";
import test from "node:test";

import { DomainError, validationError } from "../../lib/api/domain-error";
import { apiFailureFromUnknown, apiSuccess } from "../../lib/api/response";

test("success responses use the common envelope", () => {
  assert.deepEqual(apiSuccess({ id: "order-1" }, { requestId: "req-1" }), {
    success: true,
    data: { id: "order-1" },
    meta: { requestId: "req-1" },
  });
});
test("expected domain errors preserve safe code, message, details, and status", () => {
  const result = apiFailureFromUnknown(
    validationError("İstek geçersiz.", [{ path: "items.0.quantity", message: "En az 1" }]),
  );

  assert.equal(result.status, 400);
  assert.equal(result.body.success, false);
  assert.equal(result.body.error.code, "VALIDATION_ERROR");
  assert.equal(result.body.error.message, "İstek geçersiz.");
  assert.deepEqual(result.body.error.details, [
    { path: "items.0.quantity", message: "En az 1" },
  ]);
});

test("unknown and non-exposed errors do not leak internals", () => {
  const unknown = apiFailureFromUnknown(new Error("database password was rejected"));
  assert.equal(unknown.status, 500);
  assert.deepEqual(unknown.body.error, {
    code: "INTERNAL_ERROR",
    message: "İşlem tamamlanamadı. Lütfen tekrar deneyin.",
  });

  const hidden = apiFailureFromUnknown(
    new DomainError("INTERNAL_ERROR", "secret stack context", {
      httpStatus: 503,
      details: { secret: "never expose" },
      expose: false,
    }),
  );
  assert.equal(hidden.status, 503);
  assert.equal(hidden.body.error.message.includes("secret"), false);
  assert.equal("details" in hidden.body.error, false);
});
