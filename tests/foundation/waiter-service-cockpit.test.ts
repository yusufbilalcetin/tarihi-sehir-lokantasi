import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  ATTENTION_LABELS,
  LONG_WAIT_MINUTES,
  TABLE_STATUS_LABELS,
  buildAttentionQueue,
  buildReadyQueue,
  resolveTableLabel,
  resolveTableTone,
} from "@/lib/domain/service-attention";
import type { Order, RestaurantTable, TableStatus } from "@/types";

function read(relativePath: string): string {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");
}

const cockpit = read("components/staff/cockpit/service-cockpit.tsx");
const tableCard = read("components/staff/cockpit/service-table-card.tsx");
const attentionQueue = read("components/staff/cockpit/attention-queue.tsx");
const readyQueue = read("components/staff/cockpit/ready-orders-queue.tsx");
const productBrowser = read("components/staff/cockpit/product-browser.tsx");
const tableGrid = read("components/staff/table-grid.tsx");

function table(overrides: Partial<RestaurantTable> & { id: string }): RestaurantTable {
  return {
    name: `M${overrides.id}`,
    status: "occupied",
    seats: 4,
    qrAvailable: true,
    lastActivity: "az önce",
    ...overrides,
  } as RestaurantTable;
}

function order(overrides: Partial<Order> & { id: string; tableId: string }): Order {
  return {
    orderNumber: "#1",
    tableName: "M1",
    createdAt: "19:00",
    elapsedMinutes: 2,
    status: "preparing",
    total: 100,
    items: [],
    ...overrides,
  } as Order;
}

/* ------------------------------------------------------- attention queue -- */

test("the queue ranks plated food over a bill, and a bill over a call", () => {
  const tables = [
    table({ id: "a", status: "waiter-call" }),
    table({ id: "b", status: "bill-requested" }),
    table({ id: "c", status: "occupied" }),
  ];
  const orders = [order({ id: "o1", tableId: "c", status: "ready", elapsedMinutes: 3 })];

  const queue = buildAttentionQueue(tables, orders);
  assert.deepEqual(
    queue.map((entry) => entry.reason),
    ["order-ready", "bill-requested", "waiter-call"],
  );
  assert.equal(queue[0].label, ATTENTION_LABELS["order-ready"]);
  assert.equal(queue[0].orderId, "o1");
});

test("a calm floor produces no work, and a closed table is never an errand", () => {
  const tables = [
    table({ id: "a", status: "available" }),
    table({ id: "b", status: "dining" }),
    table({ id: "c", status: "inactive" }),
  ];
  assert.deepEqual(buildAttentionQueue(tables, []), []);
});

test("an unserved order only becomes an errand once it is genuinely late", () => {
  const tables = [table({ id: "a", status: "waiting" })];
  const fresh = [order({ id: "o", tableId: "a", elapsedMinutes: LONG_WAIT_MINUTES - 1 })];
  const late = [order({ id: "o", tableId: "a", elapsedMinutes: LONG_WAIT_MINUTES })];

  assert.deepEqual(buildAttentionQueue(tables, fresh), []);
  const queue = buildAttentionQueue(tables, late);
  assert.equal(queue.length, 1);
  assert.equal(queue[0].reason, "waiting-too-long");
  assert.equal(queue[0].waitingMinutes, LONG_WAIT_MINUTES);
});

test("one table is one errand, however many reasons it has", () => {
  // Ready food *and* a bill request is still a single walk across the room.
  const tables = [table({ id: "a", status: "bill-requested" })];
  const orders = [order({ id: "o", tableId: "a", status: "ready" })];
  const queue = buildAttentionQueue(tables, orders);
  assert.equal(queue.length, 1, "the same table was queued twice");
  assert.equal(queue[0].reason, "order-ready");
});

test("within one reason the longest wait is served first", () => {
  const tables = [table({ id: "a" }), table({ id: "b" })];
  const orders = [
    order({ id: "o1", tableId: "a", status: "ready", elapsedMinutes: 2 }),
    order({ id: "o2", tableId: "b", status: "ready", elapsedMinutes: 9 }),
  ];
  assert.deepEqual(
    buildAttentionQueue(tables, orders).map((entry) => entry.tableId),
    ["b", "a"],
  );
});

/* ------------------------------------------------------------ ready pass -- */

test("the ready queue lists only plated orders, oldest first, without dropped lines", () => {
  const orders = [
    order({
      id: "o1",
      tableId: "a",
      tableName: "M1",
      status: "ready",
      elapsedMinutes: 1,
      items: [
        { id: "i1", productId: "p1", productName: "Tavuk Şiş", quantity: 2, unitPrice: 10, status: "ready" },
        { id: "i2", productId: "p2", productName: "İptal", quantity: 1, unitPrice: 10, status: "cancelled" },
      ],
    }),
    order({ id: "o2", tableId: "b", tableName: "M2", status: "ready", elapsedMinutes: 6, items: [] }),
    order({ id: "o3", tableId: "c", status: "preparing" }),
  ];

  const queue = buildReadyQueue(orders);
  assert.deepEqual(queue.map((entry) => entry.orderId), ["o2", "o1"]);
  assert.equal(queue[1].summary, "2× Tavuk Şiş", "a cancelled line reached the pass queue");
});

/* --------------------------------------------------------- status labels -- */

test("every table status the API can return has a waiter-facing word", () => {
  const statuses: readonly TableStatus[] = [
    "available",
    "occupied",
    "ordering",
    "waiting",
    "dining",
    "waiter-call",
    "bill-requested",
    "cleaning",
    "inactive",
  ];
  for (const status of statuses) {
    assert.ok(TABLE_STATUS_LABELS[status], `${status} has no label`);
    assert.ok(resolveTableTone(status, false), `${status} has no tone`);
  }
  // Ready food outranks whatever the table itself says.
  assert.equal(resolveTableLabel("occupied", true), "Hazır");
  assert.equal(resolveTableTone("occupied", true), "ready");
  assert.equal(resolveTableLabel("occupied", false), "Aktif");
});

test("state is never carried by colour alone", () => {
  // Each tone is rendered with an icon and a word beside it.
  assert.match(tableCard, /const TONE_ICON/);
  assert.match(tableCard, /\{label\}/, "the table card dropped its status word");
  assert.match(attentionQueue, /const REASON_STYLE/);
  assert.match(attentionQueue, /\{entry\.label\}/, "the queue dropped its reason word");
});

/* ------------------------------------------------------------- structure -- */

test("the cockpit is three columns on a tablet and a tabbed app on a phone", () => {
  assert.match(cockpit, /TABLET_MEDIA_QUERY/);
  // Left rail, middle browser, right table panel.
  assert.match(cockpit, /aria-label="Menü ve masa filtreleri"/);
  assert.match(cockpit, /<ProductBrowser/);
  assert.match(cockpit, /aria-label="Seçili masa"/);
  assert.match(cockpit, /md:hidden/, "the bottom bar follows the tablet to a stand");
  assert.match(cockpit, /grid-cols-4/, "the phone bar is not four tabs");
  for (const label of ["Masalar", "Siparişler", "Hazır", "Profil"]) {
    assert.match(cockpit, new RegExp(`label: "${label}"`), `${label} is missing from the bar`);
  }
});

test("a 768px tablet gets two columns and the third arrives at 1024px", () => {
  // 208px of rail plus a 304px table panel would leave a 176px menu at 768px,
  // narrower than a single product card, so the rail is held back to lg and
  // the categories ride above the grid as chips until then.
  assert.match(cockpit, /hidden w-52 shrink-0 flex-col gap-5 overflow-y-auto lg:flex/);
  assert.doesNotMatch(
    cockpit,
    /w-52[^"]*md:flex/,
    "the left rail came back at 768px and squeezed the menu",
  );
  assert.match(cockpit, /aria-label="Kategoriler"[\s\S]*?lg:hidden|lg:hidden[\s\S]*?aria-label="Kategoriler"/);
  // The table panel is the column a tablet keeps.
  assert.match(cockpit, /w-\[19rem\] shrink-0 flex-col overflow-hidden[^"]*md:flex lg:w-\[21rem\]/);
});

test("the columns scroll independently instead of moving the page", () => {
  assert.match(cockpit, /h-\[calc\(100dvh-8rem\)\][^"]*overflow-hidden/);
  assert.match(productBrowser, /min-h-0 flex-1 overflow-y-auto/);
});

test("touch targets on every waiter control clear 44px", () => {
  // min-h-11 is 44px; min-h-14 is the bottom bar.
  for (const [name, source] of [
    ["table card", tableCard],
    ["attention queue", attentionQueue],
    ["ready queue", readyQueue],
  ] as const) {
    // The card is itself the target (5.25rem); the queues use 56px rows.
    assert.match(
      source,
      /min-h-(?:14|11|\[5\.25rem\])/,
      `${name} has an undersized control`,
    );
  }
  assert.match(cockpit, /min-h-14 w-full flex-col/, "a bottom bar tab is under 44px");
  assert.doesNotMatch(cockpit, /min-h-(?:8|9|10)\b/, "a cockpit control dropped below 44px");
  assert.match(productBrowser, /className="h-11 ps-9"/, "the product search is under 44px");
});

test("the redesign moved the markup and left the behaviour where it was", () => {
  // Every mutation still belongs to table-grid; the cockpit only frames it.
  assert.match(tableGrid, /resolveTableQuickActions/);
  assert.match(tableGrid, /staffApi\.updateOrderStatus/);
  assert.match(tableGrid, /staffApi\.updateCall/);
  assert.match(tableGrid, /staffApi\.createCall/);
  assert.match(tableGrid, /canRoleCancelOrder/);
  assert.doesNotMatch(cockpit, /resolveTableQuickActions/, "the cockpit forked the action rules");
  assert.doesNotMatch(cockpit, /updateOrderStatus|updateCall|createCall/, "the cockpit forked a mutation");

  // The one thing the cockpit does call is the order pad's own contract, with
  // the same replay key discipline, so a double tap cannot double-charge.
  assert.match(cockpit, /canAddItemsToOrder\(toApiOrderStatus\(order\.status\)\)/);
  assert.match(cockpit, /idempotencyKeyRef\.current \?\?= staffApi\.newIdempotencyKey\(\)/);
  assert.match(cockpit, /idempotencyKeyRef\.current = null;/);
  assert.match(cockpit, /if \(addPendingId\) return;/, "a second tap is not guarded");
});

test("the old floor-plan UI is gone rather than left behind the new one", () => {
  for (const dead of [
    "components/staff/staff-tables-view.tsx",
    "components/staff/staff-floor.tsx",
    "components/staff/table-card.tsx",
  ]) {
    assert.throws(() => read(dead), `${dead} is still present`);
  }
  // And nothing imports them.
  const cockpitDir = read("components/staff/tables-module.tsx");
  assert.match(cockpitDir, /<ServiceCockpit \/>/);
  assert.doesNotMatch(tableGrid, /TableCard/, "the removed card is still referenced");
});

test("the product grid is sized to its column, not to the viewport", () => {
  // The middle column is ~376px at 1024px wide, so three product cards there
  // would be 119px each. The grid steps up at xl/2xl, where the column has
  // actually grown, rather than at the viewport breakpoint that has not.
  assert.match(productBrowser, /grid grid-cols-2 gap-2\.5 xl:grid-cols-3 2xl:grid-cols-4/);
  assert.doesNotMatch(
    productBrowser,
    /lg:grid-cols-3/,
    "three product cards at 1024px do not fit the middle column",
  );
});
