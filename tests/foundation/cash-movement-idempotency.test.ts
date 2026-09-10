import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { ApiClientError, isUnknownMutationOutcome } from "@/lib/api/client";
import { DomainError } from "@/lib/api/domain-error";
import type { RecordMovementCommand } from "@/lib/services/cashier-shift-service";
import { idempotencyKeySchema } from "@/lib/validation/common";
import {
  FakeShiftRepository,
  openShift,
  principal,
  shiftService,
} from "./phase8a-shift-fixtures";

function setup(overrides: Parameters<typeof openShift>[0] = {}) {
  const repository = new FakeShiftRepository();
  repository.shifts.push(openShift(overrides));
  return { repository, service: shiftService(repository) };
}

function movement(overrides: Partial<RecordMovementCommand> = {}): RecordMovementCommand {
  return {
    shiftId: "shift-1",
    type: "CASH_IN",
    amount: "10.00",
    reason: "Bozuk para",
    note: "Sabah takviyesi",
    idempotencyKey: "movement-key-1",
    ...overrides,
  };
}

function isCode(expected: string) {
  return (error: unknown) => error instanceof DomainError && error.code === expected;
}

function assertNoWrites(repository: FakeShiftRepository) {
  assert.equal(repository.idempotency.size, 0, "idempotency claim persisted");
  assert.equal(repository.movements.length, 0, "movement persisted");
  assert.equal(repository.outbox.length, 0, "outbox event persisted");
  assert.equal(repository.audits.length, 0, "audit entry persisted");
}

test("same movement key and payload replay one movement and no duplicate side effects", async () => {
  const { repository, service } = setup();
  const command = movement();

  const first = await service.recordMovement(principal("CASHIER"), command);
  const replay = await service.recordMovement(principal("CASHIER"), command);

  assert.deepEqual(replay, first);
  assert.equal(repository.movements.length, 1);
  assert.equal(repository.outbox.length, 1);
  assert.equal(repository.audits.length, 1);
  assert.equal(repository.idempotency.size, 1);
  assert.equal([...repository.idempotency.values()][0]?.status, "COMPLETED");
});

test("same movement key with a different amount conflicts", async () => {
  const { repository, service } = setup();
  await service.recordMovement(principal("CASHIER"), movement());

  await assert.rejects(
    () => service.recordMovement(principal("CASHIER"), movement({ amount: "11.00" })),
    isCode("IDEMPOTENCY_CONFLICT"),
  );
  assert.equal(repository.movements.length, 1);
});

test("same movement key with a different movement type conflicts", async () => {
  const { repository, service } = setup();
  await service.recordMovement(principal("CASHIER"), movement());

  await assert.rejects(
    () => service.recordMovement(principal("CASHIER"), movement({ type: "CASH_OUT" })),
    isCode("IDEMPOTENCY_CONFLICT"),
  );
  assert.equal(repository.movements.length, 1);
});

test("reason, note, and actor identity are part of movement intent", async (t) => {
  for (const [name, changed] of [
    ["reason", { reason: "Kasa devri" }],
    ["note", { note: "Akşam takviyesi" }],
  ] as const) {
    await t.test(name, async () => {
      const { repository, service } = setup();
      await service.recordMovement(principal("CASHIER"), movement());
      await assert.rejects(
        () => service.recordMovement(principal("CASHIER"), movement(changed)),
        isCode("IDEMPOTENCY_CONFLICT"),
      );
      assert.equal(repository.movements.length, 1);
    });
  }

  await t.test("actor", async () => {
    const { repository, service } = setup();
    await service.recordMovement(principal("CASHIER"), movement());
    await assert.rejects(
      () => service.recordMovement(principal("MANAGER"), movement()),
      isCode("IDEMPOTENCY_CONFLICT"),
    );
    assert.equal(repository.movements.length, 1);
  });
});

test("concurrent identical movement claims converge on one completed movement", async () => {
  const { repository, service } = setup();
  const command = movement({ idempotencyKey: "movement-concurrent-key" });

  const [first, second] = await Promise.all([
    service.recordMovement(principal("CASHIER"), command),
    service.recordMovement(principal("CASHIER"), command),
  ]);

  assert.equal(first.movement.id, second.movement.id);
  assert.equal(repository.movements.length, 1);
  assert.equal(repository.outbox.length, 1);
  assert.equal(repository.audits.length, 1);
});

test("different movement keys allow the same payload twice", async () => {
  const { repository, service } = setup();
  const first = await service.recordMovement(
    principal("CASHIER"),
    movement({ idempotencyKey: "movement-distinct-key-1" }),
  );
  const second = await service.recordMovement(
    principal("CASHIER"),
    movement({ idempotencyKey: "movement-distinct-key-2" }),
  );

  assert.notEqual(first.movement.id, second.movement.id);
  assert.equal(repository.movements.length, 2);
  assert.equal(repository.outbox.length, 2);
  assert.equal(repository.audits.length, 2);
});

test("movement route requires the existing Idempotency-Key schema", () => {
  const route = readFileSync(
    join(process.cwd(), "app", "api", "cashier", "shifts", "[shiftId]", "movements", "route.ts"),
    "utf8",
  );

  assert.equal(idempotencyKeySchema.safeParse(null).success, false);
  assert.equal(idempotencyKeySchema.safeParse("short").success, false);
  assert.equal(idempotencyKeySchema.safeParse("invalid key with spaces").success, false);
  assert.equal(idempotencyKeySchema.safeParse("movement-valid-key").success, true);
  assert.match(route, /idempotencyKeySchema\.safeParse\(request\.headers\.get\("idempotency-key"\)\)/);
  assert.match(route, /throw validationError\("Geçerli bir Idempotency-Key başlığı gereklidir\."/);
});

test("unauthorized movement attempts never claim a key or write money", async () => {
  for (const actor of [null, principal("WAITER")]) {
    const { repository, service } = setup();
    await assert.rejects(
      () => service.recordMovement(actor, movement()),
      isCode(actor ? "FORBIDDEN" : "AUTHENTICATION_REQUIRED"),
    );
    assertNoWrites(repository);
  }
});

test("wrong-restaurant and inaccessible shifts roll back the claim and all writes", async (t) => {
  await t.test("wrong restaurant", async () => {
    const { repository, service } = setup();
    const foreign = { ...principal("CASHIER"), restaurantId: "restaurant-2" };
    await assert.rejects(
      () => service.recordMovement(foreign, movement()),
      isCode("NOT_FOUND"),
    );
    assertNoWrites(repository);
  });

  await t.test("another cashier's shift", async () => {
    const { repository, service } = setup({ openedByStaffId: "user-manager" });
    await assert.rejects(
      () => service.recordMovement(principal("CASHIER"), movement()),
      isCode("NOT_FOUND"),
    );
    assertNoWrites(repository);
  });
});

test("claim, movement, outbox, audit, and completion roll back as one unit", async () => {
  for (const failAt of ["movement", "outbox", "audit", "complete"] as const) {
    const { repository, service } = setup();
    repository.failAt = failAt;
    await assert.rejects(
      () => service.recordMovement(principal("CASHIER"), movement()),
      new RegExp(`${failAt === "movement" ? "movement insert" : failAt === "complete" ? "idempotency completion" : `${failAt} insert`} failed`),
    );
    assertNoWrites(repository);
  }
});

test("the client retains keys only while a mutation outcome can still be unknown", () => {
  assert.equal(isUnknownMutationOutcome(new ApiClientError("NETWORK_ERROR", "offline", 0)), true);
  assert.equal(isUnknownMutationOutcome(new ApiClientError("INTERNAL_ERROR", "bad gateway", 503)), true);
  assert.equal(isUnknownMutationOutcome(new ApiClientError("INTERNAL_ERROR", "bad response", 201)), true);
  assert.equal(
    isUnknownMutationOutcome(new ApiClientError("IDEMPOTENCY_IN_FLIGHT", "busy", 409)),
    true,
  );
  assert.equal(isUnknownMutationOutcome(new ApiClientError("VALIDATION_ERROR", "bad", 400)), false);
  assert.equal(
    isUnknownMutationOutcome(new ApiClientError("IDEMPOTENCY_CONFLICT", "different", 409)),
    false,
  );

  const panel = readFileSync(join(process.cwd(), "components", "cashier", "shift-panel.tsx"), "utf8");
  assert.match(panel, /movementKeyRef\.current\.intent !== intent/);
  assert.match(panel, /!isUnknownMutationOutcome\(error\)/);
  assert.doesNotMatch(panel, /movementKeyRef\.current = null;\s*if \(done\)/);
});
