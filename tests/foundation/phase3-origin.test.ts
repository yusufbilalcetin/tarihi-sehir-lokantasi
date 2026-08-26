import assert from "node:assert/strict";
import test from "node:test";

import { DomainError } from "../../lib/api/domain-error";
import { assertTrustedMutationOrigin } from "../../lib/security/origin";

test("same-origin cookie mutation is accepted", () => {
  const request = new Request("https://menu.example/api/orders", {
    method: "POST",
    headers: { origin: "https://menu.example" },
  });
  assert.doesNotThrow(() => assertTrustedMutationOrigin(request));
});

test("cross-origin and missing-origin mutations fail closed", () => {
  for (const origin of ["https://evil.example", undefined]) {
    const request = new Request("https://menu.example/api/orders", {
      method: "POST",
      ...(origin ? { headers: { origin } } : {}),
    });
    assert.throws(
      () => assertTrustedMutationOrigin(request),
      (error: unknown) => error instanceof DomainError && error.code === "FORBIDDEN",
    );
  }
});

test("origin normalization respects ports and rejects credential URLs", () => {
  assert.doesNotThrow(() =>
    assertTrustedMutationOrigin(
      new Request("http://localhost:3000/api/orders", {
        method: "POST",
        headers: { origin: "http://localhost:3000" },
      }),
    ),
  );
  assert.throws(() =>
    assertTrustedMutationOrigin(
      new Request("https://menu.example/api/orders", {
        method: "POST",
        headers: { origin: "https://user:pass@menu.example" },
      }),
    ),
  );
});
