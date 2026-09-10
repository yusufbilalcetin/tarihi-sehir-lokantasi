import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { DomainError } from "../../lib/api/domain-error";
import { PAYMENT_ROLES } from "../../lib/domain/financial-operations";
import type { RestaurantPrincipal } from "../../lib/domain/restaurant-scope";
import type { USER_ROLES } from "../../lib/domain/status";
import type {
  StaffOrderListFilters,
  StaffOrderListRecord,
  StaffOrderRepository,
  StaffOrderTransactionRepository,
} from "../../lib/repositories/staff-order-repository";
import { StaffOrderService } from "../../lib/services/staff-order-service";

/**
 * Who may read what an order has taken.
 *
 * `withBalance=true` makes the open-orders list carry money. The list itself is
 * readable by every operational role — a cook needs the pass, a waiter needs the
 * floor — so without its own check the flag handed the restaurant's takings to
 * anyone who typed it into the query string. "The UI does not send it" is not an
 * authorization boundary.
 *
 * The policy is not invented here: it is `PAYMENT_ROLES`, the same set the
 * ledger endpoint and payment collection already enforce.
 */

type Role = (typeof USER_ROLES)[number];

function principal(role: Role): RestaurantPrincipal {
  return { userId: `staff-${role}`, restaurantId: "restaurant-a", role, isActive: true };
}

const record: StaffOrderListRecord = {
  version: 1,
  id: "order-1",
  orderNumber: "ORD-000001",
  status: "SERVED",
  tableId: "table-1",
  tableName: "Masa 1",
  tableNumber: 1,
  channel: "DINE_IN",
  subtotal: "1000.00",
  serviceChargeTotal: "0.00",
  taxTotal: "0.00",
  total: "1000.00",
  notes: null,
  createdAt: new Date("2026-09-08T18:00:00.000Z"),
  updatedAt: new Date("2026-09-08T18:00:00.000Z"),
  items: [],
  payments: [{ amount: "800.00", refundedAmount: "0.00", status: "COMPLETED" }],
};

class FakeRepository implements StaffOrderRepository {
  public seen: StaffOrderListFilters | null = null;
  async listOrders(_restaurantId: string, filters: StaffOrderListFilters) {
    this.seen = filters;
    return [{ ...record, payments: filters.withBalance ? record.payments : null }];
  }
  transaction<TResult>(
    work: (repository: StaffOrderTransactionRepository) => Promise<TResult>,
  ): Promise<TResult> {
    return work({} as StaffOrderTransactionRepository);
  }
}

const service = () => new StaffOrderService(new FakeRepository());

// ------------------------------------------------- 1: the roles that may not

test("a waiter or a cook cannot pull the takings out of the orders list", async () => {
  for (const role of ["WAITER", "KITCHEN"] as const) {
    await assert.rejects(
      () => service().listOrders(principal(role), { withBalance: true, limit: 50 }),
      (error: unknown) =>
        error instanceof DomainError && error.code === "FORBIDDEN" && error.httpStatus === 403,
      `${role} obtained order balances by asking for them`,
    );
  }
});

test("the same roles still get the order list they work from", async () => {
  for (const role of ["WAITER", "KITCHEN"] as const) {
    const orders = await service().listOrders(principal(role), { openOnly: true, limit: 50 });
    assert.equal(orders.length, 1, `${role} lost the list it needs`);
    assert.equal(orders[0]?.outstanding, null, "and it carries no money");
  }
});

// ---------------------------------------------------- 2: the roles that may

test("the till and management may read a balance", async () => {
  for (const role of PAYMENT_ROLES) {
    const orders = await service().listOrders(principal(role), { withBalance: true, limit: 50 });
    assert.equal(orders[0]?.outstanding, "200.00", `${role} could not read the balance`);
  }
  assert.deepEqual([...PAYMENT_ROLES], ["ADMIN", "MANAGER", "CASHIER"]);
});

test("the policy is the one the ledger already enforces, not a second matrix", () => {
  const payments = readFileSync(
    new URL("../../lib/services/payment-service.ts", import.meta.url),
    "utf8",
  );
  const staffOrders = readFileSync(
    new URL("../../lib/services/staff-order-service.ts", import.meta.url),
    "utf8",
  );
  const financial = readFileSync(
    new URL("../../lib/domain/financial-operations.ts", import.meta.url),
    "utf8",
  );
  // One definition, in the financial domain, reached by both services. A local
  // copy in a service is how one surface ends up more permissive than the rest.
  assert.match(financial, /export const PAYMENT_ROLES = \["ADMIN", "MANAGER", "CASHIER"\]/);
  assert.doesNotMatch(payments, /const PAYMENT_ROLES = \[/);
  assert.match(
    payments,
    /import \{\s*PAYMENT_ROLES/,
    "payment-service stopped importing the shared policy",
  );
  assert.match(
    staffOrders,
    /canRoleReadOrderBalance/,
    "the orders list gates the balance on something of its own",
  );
});

// ------------------------------------------- 3: need-to-know minimisation

test("the list hands over the balance and nothing else about the money", async () => {
  const orders = await service().listOrders(principal("CASHIER"), {
    withBalance: true,
    limit: 50,
  });
  const [order] = orders;
  assert.ok(order);
  // What the counter reads.
  assert.equal(order.outstanding, "200.00");
  // What it does not, and therefore must not be given: the takings, the refunds
  // and the individual collections behind them.
  const serialised = JSON.stringify(order);
  for (const leak of ["paidTotal", "refundedTotal", "payableTotal", "settled", "800.00"]) {
    assert.ok(!serialised.includes(leak), `the list response still carries ${leak}`);
  }
  assert.ok(!("balance" in order), "the whole balance object is still on the wire");
  assert.ok(!("payments" in order), "raw payment rows reached the client");
});

test("a balance that was never asked for is absent, not zero", async () => {
  const [order] = await service().listOrders(principal("CASHIER"), { limit: 50 });
  assert.equal(order?.outstanding, null, "\"not requested\" must not read as \"nothing owed\"");
});

test("the repository is only asked for payments when a balance is wanted", async () => {
  const repository = new FakeRepository();
  const scoped = new StaffOrderService(repository);
  await scoped.listOrders(principal("KITCHEN"), { openOnly: true, limit: 50 });
  assert.notEqual(repository.seen?.withBalance, true, "the pass paid for a payments read");
});
