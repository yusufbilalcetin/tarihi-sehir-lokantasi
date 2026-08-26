import assert from "node:assert/strict";
import test from "node:test";

import { DomainError } from "../../lib/api/domain-error";
import type { RestaurantPrincipal } from "../../lib/domain/restaurant-scope";
import type {
  StaffCallAuditInput,
  StaffCallInsertInput,
  StaffCallListRecord,
  StaffCallOutboxInput,
  StaffCallRepository,
  StaffCallTableRecord,
  StaffCallTransactionRepository,
  StaffCallUpdateInput,
} from "../../lib/repositories/staff-call-repository";
import { StaffCallService } from "../../lib/services/staff-call-service";

const clock = () => new Date("2026-08-14T10:00:00.000Z");

function callRecord(overrides: Partial<StaffCallListRecord> = {}): StaffCallListRecord {
  return {
    id: "call-a",
    type: "WAITER_CALL",
    status: "OPEN",
    requestLabel: null,
    notes: null,
    tableId: "table-a",
    tableName: "Masa 3",
    tableNumber: 3,
    acknowledgedAt: null,
    resolvedAt: null,
    createdAt: clock(),
    updatedAt: clock(),
    ...overrides,
  };
}

/**
 * Models the database contract the real repository relies on: a table row lock
 * plus the partial unique index over (restaurant, table, type) for active rows.
 */
class FakeTransaction implements StaffCallTransactionRepository {
  outbox: StaffCallOutboxInput[] = [];
  audits: StaffCallAuditInput[] = [];
  inserts: StaffCallInsertInput[] = [];
  markedTables: { tableId: string; type: string }[] = [];
  clearedTables: string[] = [];
  /** Simulates another device winning the insert race after our lookup. */
  insertLosesRace = false;

  constructor(
    private readonly table: StaffCallTableRecord | null,
    private active: StaffCallListRecord[] = [],
  ) {}

  async findCallForUpdate(_restaurantId: string, callId: string) {
    return this.active.find((call) => call.id === callId) ?? null;
  }

  async findTableForUpdate() {
    return this.table;
  }

  async findActiveCallForTable(_restaurantId: string, tableId: string, type: string) {
    return (
      this.active.find(
        (call) =>
          call.tableId === tableId &&
          call.type === type &&
          (call.status === "OPEN" || call.status === "ACKNOWLEDGED"),
      ) ?? null
    );
  }

  async insertCall(input: StaffCallInsertInput) {
    this.inserts.push(input);
    if (this.insertLosesRace) {
      // The unique index rejected the row; the winner is now visible.
      this.active.push(callRecord({ id: "call-winner", type: input.type }));
      return null;
    }
    const created = callRecord({
      id: `call-${this.inserts.length}`,
      type: input.type,
      requestLabel: input.requestLabel,
      notes: input.notes,
      tableId: input.tableId,
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
    });
    this.active.push(created);
    return created;
  }

  async markTableForCall(_restaurantId: string, tableId: string, type: string) {
    this.markedTables.push({ tableId, type });
  }

  async updateCallStatus(_restaurantId: string, input: StaffCallUpdateInput) {
    const call = this.active.find((candidate) => candidate.id === input.callId);
    if (!call) return null;
    return { ...call, status: input.nextStatus, resolvedAt: input.at, updatedAt: input.at };
  }

  async countActiveCallsForTable() {
    return 0;
  }

  async clearTableCallStatus(_restaurantId: string, tableId: string) {
    this.clearedTables.push(tableId);
  }

  async insertOutbox(input: StaffCallOutboxInput) {
    this.outbox.push(input);
  }

  async insertAudit(input: StaffCallAuditInput) {
    this.audits.push(input);
  }
}

class FakeRepository implements StaffCallRepository {
  constructor(public readonly transactionRepository: FakeTransaction) {}

  async listCalls() {
    return [];
  }

  transaction<TResult>(
    work: (repository: StaffCallTransactionRepository) => Promise<TResult>,
  ): Promise<TResult> {
    return work(this.transactionRepository);
  }
}

const activeTable: StaffCallTableRecord = {
  id: "table-a",
  name: "Masa 3",
  tableNumber: 3,
  isActive: true,
  qrTokenVersion: 4,
};

function principal(role: RestaurantPrincipal["role"]): RestaurantPrincipal {
  return {
    userId: `user-${role.toLowerCase()}`,
    restaurantId: "restaurant-a",
    role,
    isActive: true,
  };
}

function service(transaction: FakeTransaction) {
  return new StaffCallService(new FakeRepository(transaction), { clock });
}

test("a staff bill request writes the row, table status, outbox and audit", async () => {
  const transaction = new FakeTransaction(activeTable);
  const result = await service(transaction).createCall(principal("WAITER"), {
    tableId: "table-a",
    type: "BILL_REQUEST",
    requestId: "req-1",
  });

  assert.equal(result.created, true);
  assert.equal(result.call.status, "OPEN");
  assert.equal(result.call.table.id, "table-a");
  assert.equal(transaction.inserts.length, 1);
  // The token version is read from the locked table row, never from the client.
  assert.equal(transaction.inserts[0]?.tableTokenVersion, 4);
  assert.deepEqual(transaction.markedTables, [
    { tableId: "table-a", type: "BILL_REQUEST" },
  ]);
  assert.equal(transaction.outbox[0]?.eventType, "BILL_REQUESTED");
  assert.equal(transaction.audits[0]?.action, "waiter_call.created");
  assert.equal(transaction.audits[0]?.actorStaffId, "user-waiter");
  assert.equal(transaction.audits[0]?.requestId, "req-1");
});

test("tapping twice replays the open request instead of duplicating it", async () => {
  const transaction = new FakeTransaction(activeTable);
  const staff = service(transaction);
  const first = await staff.createCall(principal("WAITER"), {
    tableId: "table-a",
    type: "BILL_REQUEST",
  });
  const second = await staff.createCall(principal("WAITER"), {
    tableId: "table-a",
    type: "BILL_REQUEST",
  });

  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(second.call.id, first.call.id);
  assert.equal(transaction.inserts.length, 1);
  assert.equal(transaction.outbox.length, 1);
});

test("losing the insert race returns the winning request, not an error", async () => {
  const transaction = new FakeTransaction(activeTable);
  transaction.insertLosesRace = true;
  const result = await service(transaction).createCall(principal("WAITER"), {
    tableId: "table-a",
    type: "WAITER_CALL",
  });

  assert.equal(result.created, false);
  assert.equal(result.call.id, "call-winner");
  // No second event may be published for a row this request did not create.
  assert.equal(transaction.outbox.length, 0);
});

test("a table note is an annotation and never repaints the table status", async () => {
  const transaction = new FakeTransaction(activeTable);
  const result = await service(transaction).createCall(principal("WAITER"), {
    tableId: "table-a",
    type: "OTHER",
    requestLabel: "Masa notu",
    notes: "  Doğum günü pastası hazır  ",
  });

  assert.equal(result.created, true);
  assert.deepEqual(transaction.markedTables, []);
  assert.equal(transaction.inserts[0]?.notes, "Doğum günü pastası hazır");
  assert.equal(transaction.inserts[0]?.requestLabel, "Masa notu");
  assert.equal(transaction.outbox[0]?.eventType, "TABLE_NOTE_ADDED");
});

test("an over-long note is rejected before any row is written", async () => {
  const transaction = new FakeTransaction(activeTable);
  await assert.rejects(
    () =>
      service(transaction).createCall(principal("WAITER"), {
        tableId: "table-a",
        type: "OTHER",
        notes: "x".repeat(501),
      }),
    (error: unknown) => error instanceof DomainError && error.code === "VALIDATION_ERROR",
  );
  assert.equal(transaction.inserts.length, 0);
});

test("an unknown table id fails closed without revealing anything", async () => {
  const transaction = new FakeTransaction(null);
  await assert.rejects(
    () =>
      service(transaction).createCall(principal("WAITER"), {
        tableId: "table-of-another-restaurant",
        type: "WAITER_CALL",
      }),
    (error: unknown) => error instanceof DomainError && error.code === "NOT_FOUND",
  );
  assert.equal(transaction.inserts.length, 0);
});

test("a deactivated table accepts no new service request", async () => {
  const transaction = new FakeTransaction({ ...activeTable, isActive: false });
  await assert.rejects(
    () =>
      service(transaction).createCall(principal("WAITER"), {
        tableId: "table-a",
        type: "WAITER_CALL",
      }),
    (error: unknown) => error instanceof DomainError && error.code === "TABLE_INACTIVE",
  );
  assert.equal(transaction.inserts.length, 0);
});

test("a cashier may open a bill request but not a waiter call or a note", async () => {
  const billTransaction = new FakeTransaction(activeTable);
  const bill = await service(billTransaction).createCall(principal("CASHIER"), {
    tableId: "table-a",
    type: "BILL_REQUEST",
  });
  assert.equal(bill.created, true);

  for (const type of ["WAITER_CALL", "OTHER"] as const) {
    const transaction = new FakeTransaction(activeTable);
    await assert.rejects(
      () => service(transaction).createCall(principal("CASHIER"), { tableId: "table-a", type }),
      (error: unknown) => error instanceof DomainError && error.code === "FORBIDDEN",
    );
    assert.equal(transaction.inserts.length, 0);
  }
});

test("the kitchen role cannot open a service request from any surface", async () => {
  const transaction = new FakeTransaction(activeTable);
  await assert.rejects(
    () =>
      service(transaction).createCall(principal("KITCHEN"), {
        tableId: "table-a",
        type: "WAITER_CALL",
      }),
    (error: unknown) => error instanceof DomainError && error.code === "FORBIDDEN",
  );
  assert.equal(transaction.inserts.length, 0);
});

test("an anonymous caller is rejected before the transaction opens", async () => {
  const transaction = new FakeTransaction(activeTable);
  await assert.rejects(
    () => service(transaction).createCall(null, { tableId: "table-a", type: "WAITER_CALL" }),
    (error: unknown) =>
      error instanceof DomainError && error.code === "AUTHENTICATION_REQUIRED",
  );
  assert.equal(transaction.inserts.length, 0);
});

test("resolving from the table card is the same transition the calls screen uses", async () => {
  const open = callRecord({ id: "call-a", type: "BILL_REQUEST" });
  const transaction = new FakeTransaction(activeTable, [open]);
  const result = await service(transaction).updateStatus(principal("WAITER"), {
    callId: "call-a",
    nextStatus: "RESOLVED",
  });

  assert.equal(result.status, "RESOLVED");
  assert.equal(transaction.outbox[0]?.eventType, "BILL_REQUEST_RESOLVED");
  assert.deepEqual(transaction.clearedTables, ["table-a"]);
});
