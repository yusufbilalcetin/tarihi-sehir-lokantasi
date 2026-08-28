import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  matchesAdminTableFilter,
  summarizeAdminTables,
} from "../../lib/domain/admin-table-view";
import { deriveTableStatus } from "../../lib/domain/table-operations";

test("table operational status uses the documented request priority", () => {
  assert.equal(
    deriveTableStatus({
      isActive: true,
      openOrderCount: 1,
      activeCallTypes: ["WAITER_CALL", "BILL_REQUEST"],
      currentStatus: "DINING",
    }),
    "BILL_REQUESTED",
  );
  assert.equal(
    deriveTableStatus({
      isActive: true,
      openOrderCount: 1,
      activeCallTypes: [],
      currentStatus: "WAITING",
    }),
    "WAITING",
  );
  assert.equal(
    deriveTableStatus({
      isActive: true,
      openOrderCount: 0,
      activeCallTypes: [],
      currentStatus: "CLEANING",
    }),
    "CLEANING",
  );
  assert.equal(
    deriveTableStatus({
      isActive: true,
      openOrderCount: 0,
      activeCallTypes: [],
      currentStatus: "DINING",
    }),
    "AVAILABLE",
  );
});

test("summary and filter use the same operational statuses as the cards", () => {
  const tables = [
    { status: "AVAILABLE" },
    { status: "WAITING" },
    { status: "OCCUPIED" },
    { status: "BILL_REQUESTED" },
    { status: "WAITER_CALL" },
    { status: "INACTIVE" },
  ];
  assert.deepEqual(summarizeAdminTables(tables), {
    total: 6,
    available: 1,
    active: 4,
    waiting: 1,
    dining: 1,
    waiterCalls: 1,
    billRequested: 1,
    cleaning: 0,
    inactive: 1,
  });
  assert.deepEqual(
    tables.filter((table) => matchesAdminTableFilter(table, "BILL_REQUESTED")),
    [{ status: "BILL_REQUESTED" }],
  );
});

test("active table reads exclude closed history and expose bounded detail data", async () => {
  const source = await readFile("lib/repositories/drizzle-staff-table-repository.ts", "utf8");
  assert.match(source, /OPEN_ORDER_STATUSES = \["NEW", "CONFIRMED", "PREPARING", "READY", "SERVED"\]/);
  assert.doesNotMatch(source, /OPEN_ORDER_STATUSES[^;]+COMPLETED/s);
  assert.doesNotMatch(source, /OPEN_ORDER_STATUSES[^;]+CANCELLED/s);
  assert.match(source, /Promise\.all\(\[/);
  assert.match(source, /productNameSnapshot/);
  assert.doesNotMatch(source, /for \([^)]*table[^)]*\)[\s\S]{0,200}await this\.db/);
});

test("table detail is responsive and opening it cannot rotate QR", async () => {
  const [manager, detail] = await Promise.all([
    readFile("components/admin/tables-manager.tsx", "utf8"),
    readFile("components/admin/table-detail-sheet.tsx", "utf8"),
  ]);
  assert.match(manager, /grid-cols-1/);
  assert.match(manager, /md:grid-cols-2/);
  assert.match(manager, /xl:grid-cols-4/);
  assert.match(detail, /max-h-\[92dvh\]/);
  assert.match(detail, /side=\{isDesktop \? "right" : "bottom"\}/);
  assert.match(detail, /Aktif sipariş/);
  assert.match(detail, /QR Kodunu Yönet/);
  assert.doesNotMatch(`${manager}\n${detail}`, /rotateTableToken/);
});

test("service toggle and table edits use the authorized admin endpoint without tenant input", async () => {
  const [manager, detail, route] = await Promise.all([
    readFile("components/admin/tables-manager.tsx", "utf8"),
    readFile("components/admin/table-detail-sheet.tsx", "utf8"),
    readFile("app/api/admin/tables/[tableId]/route.ts", "utf8"),
  ]);
  assert.match(manager, /adminApi\.updateTable\(table\.id, \{ isActive \}\)/);
  assert.match(detail, /adminApi\.updateTable\(selectedTable\.id/);
  assert.match(route, /restaurantId: principal\.restaurantId/);
  assert.doesNotMatch(`${manager}\n${detail}`, /restaurantId:/);
});
