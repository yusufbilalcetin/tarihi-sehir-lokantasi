import assert from "node:assert/strict";
import test from "node:test";

import { DomainError } from "../../lib/api/domain-error";
import type {
  CreateCustomerWaiterCallRecordInput,
  CustomerCallContextRecord,
  CustomerWaiterCallRecord,
  InsertCustomerCallAuditInput,
  InsertCustomerCallOutboxInput,
  WaiterCallRepository,
  WaiterCallTransactionRepository,
} from "../../lib/repositories/waiter-call-repository";
import { WaiterCallService } from "../../lib/services/waiter-call-service";

const NOW = new Date("2026-08-13T12:00:00.000Z");

function context(
  overrides: Partial<CustomerCallContextRecord> = {},
): CustomerCallContextRecord {
  return {
    restaurantId: "restaurant-a",
    restaurantIsActive: true,
    tableId: "table-a",
    tableName: "Masa 3",
    tableNumber: 3,
    tableIsActive: true,
    tableTokenVersion: 4,
    tableTokenRevokedAt: null,
    waiterCallEnabled: true,
    billRequestEnabled: true,
    waiterCallCooldownSeconds: 30,
    ...overrides,
  };
}

class FakeWaiterCallRepository
  implements WaiterCallRepository, WaiterCallTransactionRepository
{
  currentContext: CustomerCallContextRecord | null = context();
  calls: CustomerWaiterCallRecord[] = [];
  outbox: InsertCustomerCallOutboxInput[] = [];
  audit: InsertCustomerCallAuditInput[] = [];
  tableMarks: Array<{ type: "WAITER_CALL" | "BILL_REQUEST"; at: Date }> = [];
  conflictWinner: CustomerWaiterCallRecord | null = null;
  transactions = 0;

  async transaction<TResult>(
    work: (repository: WaiterCallTransactionRepository) => Promise<TResult>,
  ): Promise<TResult> {
    this.transactions += 1;
    return work(this);
  }

  async findContextForUpdate(
    restaurantId: string,
    tableId: string,
  ): Promise<CustomerCallContextRecord | null> {
    if (
      !this.currentContext ||
      this.currentContext.restaurantId !== restaurantId ||
      this.currentContext.tableId !== tableId
    ) {
      return null;
    }
    return this.currentContext;
  }

  async findActiveCall(
    restaurantId: string,
    tableId: string,
    type: "WAITER_CALL" | "BILL_REQUEST",
  ): Promise<CustomerWaiterCallRecord | null> {
    return (
      this.calls.find(
        (call) =>
          call.restaurantId === restaurantId &&
          call.tableId === tableId &&
          call.type === type &&
          (call.status === "OPEN" || call.status === "ACKNOWLEDGED"),
      ) ?? null
    );
  }

  async findMostRecentCall(
    restaurantId: string,
    tableId: string,
    type: "WAITER_CALL" | "BILL_REQUEST",
  ): Promise<CustomerWaiterCallRecord | null> {
    return (
      [...this.calls]
        .filter(
          (call) =>
            call.restaurantId === restaurantId &&
            call.tableId === tableId &&
            call.type === type,
        )
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null
    );
  }

  async insertCall(
    input: CreateCustomerWaiterCallRecordInput,
  ): Promise<CustomerWaiterCallRecord | null> {
    if (this.conflictWinner) {
      this.calls.push(this.conflictWinner);
      return null;
    }
    const record: CustomerWaiterCallRecord = {
      id: `call-${this.calls.length + 1}`,
      restaurantId: input.restaurantId,
      tableId: input.tableId,
      type: input.type,
      status: "OPEN",
      notes: input.notes,
      tableTokenVersion: input.tableTokenVersion,
      createdAt: input.createdAt,
    };
    this.calls.push(record);
    return record;
  }

  async markTableForCall(
    _restaurantId: string,
    _tableId: string,
    type: "WAITER_CALL" | "BILL_REQUEST",
    at: Date,
  ): Promise<void> {
    this.tableMarks.push({ type, at });
  }

  async insertOutbox(input: InsertCustomerCallOutboxInput): Promise<void> {
    this.outbox.push(input);
  }

  async insertAudit(input: InsertCustomerCallAuditInput): Promise<void> {
    this.audit.push(input);
  }
}

function command() {
  return {
    restaurantId: "restaurant-a",
    tableId: "table-a",
    tableAccessVersion: 4,
  } as const;
}

function expectDomainCode(error: unknown, code: string): boolean {
  assert.ok(error instanceof DomainError);
  assert.equal(error.code, code);
  return true;
}

test("waiter call is created atomically with outbox and audit records", async () => {
  const repository = new FakeWaiterCallRepository();
  const service = new WaiterCallService(repository, { clock: () => NOW });

  const result = await service.createWaiterCall({ ...command(), notes: " Su getirir misiniz? " });

  assert.deepEqual(result, {
    id: "call-1",
    type: "WAITER_CALL",
    status: "OPEN",
    createdAt: NOW.toISOString(),
    replayed: false,
  });
  assert.equal(repository.calls[0]?.notes, "Su getirir misiniz?");
  assert.equal(repository.outbox.length, 1);
  assert.equal(repository.outbox[0]?.eventType, "WAITER_CALLED");
  assert.equal(repository.audit.length, 1);
  assert.equal(repository.audit[0]?.action, "WAITER_CALLED");
  assert.deepEqual(repository.tableMarks.map((entry) => entry.type), ["WAITER_CALL"]);
});

test("an active waiter call is replayed without duplicate side effects", async () => {
  const repository = new FakeWaiterCallRepository();
  repository.calls.push({
    id: "existing-call",
    restaurantId: "restaurant-a",
    tableId: "table-a",
    type: "WAITER_CALL",
    status: "ACKNOWLEDGED",
    notes: null,
    tableTokenVersion: 4,
    createdAt: new Date(NOW.getTime() - 5_000),
  });
  const service = new WaiterCallService(repository, { clock: () => NOW });

  const result = await service.createWaiterCall(command());

  assert.equal(result.id, "existing-call");
  assert.equal(result.replayed, true);
  assert.equal(repository.calls.length, 1);
  assert.equal(repository.outbox.length, 0);
  assert.equal(repository.audit.length, 0);
});

test("an active bill request is replayed instead of duplicated", async () => {
  const repository = new FakeWaiterCallRepository();
  const service = new WaiterCallService(repository, { clock: () => NOW });

  const first = await service.createBillRequest(command());
  const second = await service.createBillRequest(command());

  assert.equal(first.id, second.id);
  assert.equal(first.replayed, false);
  assert.equal(second.replayed, true);
  assert.equal(repository.calls.length, 1);
  assert.equal(repository.outbox[0]?.eventType, "BILL_REQUESTED");
  assert.equal(repository.audit[0]?.action, "BILL_REQUESTED");
});

test("customer active-call read is scoped and returns only minimized outstanding data", async () => {
  const repository = new FakeWaiterCallRepository();
  repository.calls.push(
    {
      id: "waiter-a",
      restaurantId: "restaurant-a",
      tableId: "table-a",
      type: "WAITER_CALL",
      status: "ACKNOWLEDGED",
      notes: "internal note",
      tableTokenVersion: 4,
      createdAt: NOW,
    },
    {
      id: "bill-a",
      restaurantId: "restaurant-a",
      tableId: "table-a",
      type: "BILL_REQUEST",
      status: "OPEN",
      notes: null,
      tableTokenVersion: 4,
      createdAt: new Date(NOW.getTime() - 1_000),
    },
    {
      id: "wrong-table",
      restaurantId: "restaurant-a",
      tableId: "table-b",
      type: "WAITER_CALL",
      status: "OPEN",
      notes: null,
      tableTokenVersion: 1,
      createdAt: NOW,
    },
    {
      id: "wrong-tenant",
      restaurantId: "restaurant-b",
      tableId: "table-a",
      type: "BILL_REQUEST",
      status: "OPEN",
      notes: null,
      tableTokenVersion: 1,
      createdAt: NOW,
    },
  );
  const service = new WaiterCallService(repository, { clock: () => NOW });

  const result = await service.readActiveCalls({
    restaurantId: "restaurant-a",
    tableId: "table-a",
  });

  assert.deepEqual(result, [
    { type: "WAITER_CALL", status: "ACKNOWLEDGED", createdAt: NOW.toISOString() },
    { type: "BILL_REQUEST", status: "OPEN", createdAt: new Date(NOW.getTime() - 1_000).toISOString() },
  ]);
  assert.deepEqual(Object.keys(result[0] ?? {}).sort(), ["createdAt", "status", "type"]);
  assert.equal(JSON.stringify(result).includes("internal note"), false);
  assert.equal(JSON.stringify(result).includes("waiter-a"), false);
  assert.equal(JSON.stringify(result).includes("wrong-table"), false);
  assert.equal(JSON.stringify(result).includes("wrong-tenant"), false);
});

test("the database unique-index race winner is returned without duplicate events", async () => {
  const repository = new FakeWaiterCallRepository();
  repository.conflictWinner = {
    id: "race-winner",
    restaurantId: "restaurant-a",
    tableId: "table-a",
    type: "WAITER_CALL",
    status: "OPEN",
    notes: null,
    tableTokenVersion: 4,
    createdAt: NOW,
  };
  const service = new WaiterCallService(repository, { clock: () => NOW });

  const result = await service.createWaiterCall(command());

  assert.equal(result.id, "race-winner");
  assert.equal(result.replayed, true);
  assert.equal(repository.outbox.length, 0);
  assert.equal(repository.audit.length, 0);
});

test("restaurant and table scope mismatch cannot create a customer call", async () => {
  const repository = new FakeWaiterCallRepository();
  const service = new WaiterCallService(repository, { clock: () => NOW });

  await assert.rejects(
    service.createWaiterCall({ ...command(), restaurantId: "restaurant-b" }),
    (error) => expectDomainCode(error, "TABLE_INACTIVE"),
  );
  assert.equal(repository.calls.length, 0);
});

test("rotated, revoked and inactive table sessions are rejected", async () => {
  const cases: Array<[Partial<CustomerCallContextRecord>, string]> = [
    [{ tableTokenVersion: 5 }, "INVALID_TABLE_TOKEN"],
    [{ tableTokenRevokedAt: NOW }, "INVALID_TABLE_TOKEN"],
    [{ tableIsActive: false }, "TABLE_INACTIVE"],
    [{ restaurantIsActive: false }, "TABLE_INACTIVE"],
  ];
  for (const [override, expectedCode] of cases) {
    const repository = new FakeWaiterCallRepository();
    repository.currentContext = context(override);
    const service = new WaiterCallService(repository, { clock: () => NOW });
    await assert.rejects(
      service.createWaiterCall(command()),
      (error) => expectDomainCode(error, expectedCode),
    );
  }
});

test("a recently resolved call is throttled by the persisted cooldown", async () => {
  const repository = new FakeWaiterCallRepository();
  repository.calls.push({
    id: "resolved-call",
    restaurantId: "restaurant-a",
    tableId: "table-a",
    type: "WAITER_CALL",
    status: "RESOLVED",
    notes: null,
    tableTokenVersion: 4,
    createdAt: new Date(NOW.getTime() - 10_000),
  });
  const service = new WaiterCallService(repository, { clock: () => NOW });

  await assert.rejects(
    service.createWaiterCall(command()),
    (error) => {
      assert.ok(error instanceof DomainError);
      assert.equal(error.code, "RATE_LIMITED");
      assert.deepEqual(error.details, { retryAfterSeconds: 20 });
      return true;
    },
  );
});
