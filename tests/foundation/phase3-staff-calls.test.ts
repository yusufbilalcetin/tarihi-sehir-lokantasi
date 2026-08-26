import assert from "node:assert/strict";
import test from "node:test";

import { DomainError } from "../../lib/api/domain-error";
import type { RestaurantPrincipal } from "../../lib/domain/restaurant-scope";
import type {
  StaffCallAuditInput,
  StaffCallListFilters,
  StaffCallListRecord,
  StaffCallOutboxInput,
  StaffCallRepository,
  StaffCallTransactionRepository,
  StaffCallUpdateInput,
} from "../../lib/repositories/staff-call-repository";
import { StaffCallService } from "../../lib/services/staff-call-service";

const record = {
  id: "call-a",
  type: "BILL_REQUEST" as const,
  status: "OPEN" as const,
  requestLabel: null,
  notes: null,
  tableId: "table-a",
  tableName: "Masa 3",
  tableNumber: 3,
  acknowledgedAt: null,
  resolvedAt: null,
  createdAt: new Date("2026-08-13T12:00:00.000Z"),
  updatedAt: new Date("2026-08-13T12:00:00.000Z"),
};

class FakeTransaction implements StaffCallTransactionRepository {
  outbox: StaffCallOutboxInput[] = [];
  audits: StaffCallAuditInput[] = [];
  clearedTables: string[] = [];
  activeCalls = 0;

  constructor(private readonly current: StaffCallListRecord | null) {}

  async findCallForUpdate() {
    return this.current;
  }

  async findTableForUpdate() {
    return { id: "table-a", name: "Masa 3", tableNumber: 3, isActive: true, qrTokenVersion: 1 };
  }

  async findActiveCallForTable() {
    return this.current;
  }

  async insertCall() {
    return this.current;
  }

  async markTableForCall() {}

  async updateCallStatus(_restaurantId: string, input: StaffCallUpdateInput) {
    if (!this.current) return null;
    return {
      ...this.current,
      status: input.nextStatus,
      acknowledgedAt: input.nextStatus === "ACKNOWLEDGED" ? input.at : this.current.acknowledgedAt,
      resolvedAt: input.nextStatus === "RESOLVED" ? input.at : this.current.resolvedAt,
      updatedAt: input.at,
    };
  }

  async countActiveCallsForTable() {
    return this.activeCalls;
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
  restaurantId: string | null = null;
  filters: StaffCallListFilters | null = null;
  transactionRepository: FakeTransaction;

  constructor(current: StaffCallListRecord | null = record) {
    this.transactionRepository = new FakeTransaction(current);
  }

  async listCalls(restaurantId: string, filters: StaffCallListFilters) {
    this.restaurantId = restaurantId;
    this.filters = filters;
    return [record];
  }

  transaction<TResult>(
    work: (repository: StaffCallTransactionRepository) => Promise<TResult>,
  ): Promise<TResult> {
    return work(this.transactionRepository);
  }
}

function principal(role: RestaurantPrincipal["role"]): RestaurantPrincipal {
  return {
    userId: `user-${role.toLowerCase()}`,
    restaurantId: "restaurant-a",
    role,
    isActive: true,
  };
}

test("staff call reads are scoped to the authenticated restaurant", async () => {
  const repository = new FakeRepository();
  const result = await new StaffCallService(repository).listCalls(
    principal("WAITER"),
    { status: "OPEN", limit: 20 },
  );
  assert.equal(repository.restaurantId, "restaurant-a");
  assert.deepEqual(result[0]?.table, { id: "table-a", name: "Masa 3", number: 3 });
});

test("cashiers can read bill requests but not general waiter calls", async () => {
  const repository = new FakeRepository();
  await new StaffCallService(repository).listCalls(
    principal("CASHIER"),
    { type: "WAITER_CALL", limit: 20 },
  );
  assert.equal(repository.filters?.type, "BILL_REQUEST");
});

test("kitchen role cannot read waiter or bill requests", async () => {
  await assert.rejects(
    () => new StaffCallService(new FakeRepository()).listCalls(
      principal("KITCHEN"),
      { limit: 20 },
    ),
    (error: unknown) => error instanceof DomainError && error.code === "FORBIDDEN",
  );
});

test("waiter acknowledge writes audit and outbox inside the transaction", async () => {
  const repository = new FakeRepository();
  const result = await new StaffCallService(repository).updateStatus(
    principal("WAITER"),
    { callId: "call-a", nextStatus: "ACKNOWLEDGED" },
  );

  assert.equal(result.status, "ACKNOWLEDGED");
  assert.equal(repository.transactionRepository.outbox[0]?.eventType, "BILL_REQUEST_ACKNOWLEDGED");
  assert.equal(repository.transactionRepository.audits[0]?.action, "waiter_call.acknowledged");
  assert.deepEqual(repository.transactionRepository.clearedTables, []);
});

test("resolving the last open call clears the table call badge", async () => {
  const repository = new FakeRepository();
  repository.transactionRepository.activeCalls = 0;
  await new StaffCallService(repository).updateStatus(
    principal("WAITER"),
    { callId: "call-a", nextStatus: "RESOLVED" },
  );
  assert.deepEqual(repository.transactionRepository.clearedTables, ["table-a"]);
});

test("a table with another open call keeps its badge", async () => {
  const repository = new FakeRepository();
  repository.transactionRepository.activeCalls = 1;
  await new StaffCallService(repository).updateStatus(
    principal("WAITER"),
    { callId: "call-a", nextStatus: "RESOLVED" },
  );
  assert.deepEqual(repository.transactionRepository.clearedTables, []);
});

test("a resolved call cannot be acknowledged again", async () => {
  const repository = new FakeRepository({ ...record, status: "RESOLVED" });
  await assert.rejects(
    () => new StaffCallService(repository).updateStatus(
      principal("WAITER"),
      { callId: "call-a", nextStatus: "ACKNOWLEDGED" },
    ),
    (error: unknown) => error instanceof DomainError && error.code === "INVALID_STATUS_TRANSITION",
  );
});

test("kitchen cannot mutate service requests", async () => {
  await assert.rejects(
    () => new StaffCallService(new FakeRepository()).updateStatus(
      principal("KITCHEN"),
      { callId: "call-a", nextStatus: "ACKNOWLEDGED" },
    ),
    (error: unknown) => error instanceof DomainError && error.code === "FORBIDDEN",
  );
});

test("cashiers cannot touch general waiter calls", async () => {
  const repository = new FakeRepository({ ...record, type: "WAITER_CALL" });
  await assert.rejects(
    () => new StaffCallService(repository).updateStatus(
      principal("CASHIER"),
      { callId: "call-a", nextStatus: "ACKNOWLEDGED" },
    ),
    (error: unknown) => error instanceof DomainError && error.code === "FORBIDDEN",
  );
});
