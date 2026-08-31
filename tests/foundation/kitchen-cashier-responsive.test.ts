import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * The kitchen and the counter have to be three genuinely different screens, not
 * one desktop layout squeezed. These tests hold the source structure to that:
 * a phone branch that exists in the markup rather than in arithmetic, a tablet
 * that is not a ribbon, and a pass screen that keeps its lanes.
 *
 * No browser runs in this suite, so nothing here claims a rendered result.
 */

function read(relativePath: string): string {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");
}

const board = read("components/kitchen/kitchen-board.tsx");
const ticket = read("components/kitchen/kitchen-ticket.tsx");
const filters = read("components/kitchen/kitchen-filters.tsx");
const cashier = read("components/cashier/cashier-dashboard.tsx");
const billItems = read("components/cashier/cashier-bill-items.tsx");

/* ================================================================ kitchen == */

test("the phone gets its own kitchen layout, not three squeezed lanes", () => {
  // A real branch in the markup, hidden from lg up.
  assert.match(board, /className="min-h-0 flex-1 px-3 py-3 lg:hidden"/);
  assert.match(board, /<KitchenFilters/);
  assert.match(board, /\{mobileTickets\.map\(/);
  // One column on a phone, two once a tablet has the width for two tickets.
  assert.match(board, /className="grid content-start gap-3 md:grid-cols-2"/);
  assert.doesNotMatch(
    board,
    /lg:hidden[\s\S]{0,400}grid-cols-3/,
    "the phone branch grew lanes",
  );
});

test("the pass screen keeps its three lanes and the phone never sees them", () => {
  assert.match(board, /className="hidden min-h-0 flex-1 px-4 py-3 lg:block"/);
  assert.match(board, /lg:h-full lg:min-h-0 lg:grid-cols-3/);
  // Each lane scrolls alone; tickets flow two-up only on a very wide lane.
  assert.match(board, /lg:min-h-0 lg:flex-1 lg:overflow-y-auto 2xl:grid-cols-2/);
  assert.doesNotMatch(board, /(sm|md):grid-cols-3/, "three lanes before lg is a side-scrolling board");
});

test("the phone filter rail is real navigation over the same board", () => {
  for (const label of ["Tümü", "Yeni", "Hazırlanıyor", "Hazır", "Geciken"]) {
    assert.match(board, new RegExp(`label: "${label}"`), `${label} is missing from the rail`);
  }
  // "Geciken" cuts across the stages rather than pretending to be one.
  assert.match(board, /mobileFilter === "late"/);
  assert.match(board, /resolveTicketUrgency\(entry\.order\.elapsedMinutes\) === "late"/);
  // It filters the board that already exists — no second source of tickets.
  assert.match(board, /const mobileTickets = useMemo/);
  assert.match(board, /sortKitchenTickets\(matching\.map/);
  // And no invented priority field.
  assert.doesNotMatch(board, /\.priority\b|isRush|rushOrder/, "a priority field was invented");
});

test("the rail's own controls clear 44px and are not colour-only", () => {
  assert.match(filters, /min-h-11 shrink-0 items-center/);
  assert.match(filters, /aria-pressed=\{selected\}/);
  assert.match(filters, /\{option\.label\}/, "a filter is a colour with no word");
  assert.match(filters, /\{option\.count\}/);
});

test("the ticket is one component, so all three layouts show the same thing", () => {
  // The board renders KitchenOrderCard in both branches, from one module.
  assert.equal(
    (board.match(/<KitchenOrderCard/g) ?? []).length,
    2,
    "the phone and the pass screen render different tickets",
  );
  assert.match(board, /from "@\/components\/kitchen\/kitchen-ticket"/);
  // Age, table, order note and the primary action all live in that one ticket.
  assert.match(ticket, /\{order\.tableName\}/);
  assert.match(ticket, /formatElapsed\(elapsedMinutes\)/);
  assert.match(ticket, /\{urgency\.label\}/);
  assert.match(ticket, /ticketNotes\.orderNote \?/);
  assert.match(ticket, /Sipariş notu/);
  assert.match(ticket, /className=\{cn\("h-12 w-full text-base font-bold"/);
  assert.doesNotMatch(ticket, /className="h-8 px-2/, "an item control dropped under 44px");
});

test("a late ticket is announced on the bar at every width", () => {
  assert.match(board, /\{lateCount\} geciken/);
  assert.match(board, /lateCount > 0 \? \(/);
  assert.match(board, /aria-label=\{lateCount \+ " geciken sipariş"\}/);
});

/* ================================================================ cashier == */

test("the counter is one step at a time on a phone", () => {
  // The step is derived from the selection that already exists.
  assert.match(cashier, /const mobileShowsDetail = selection\.reason === "explicit"/);
  assert.match(cashier, /mobileShowsDetail && "hidden lg:block"/, "the list never hides");
  assert.match(cashier, /!mobileShowsDetail && "hidden lg:block"/, "the check never hides");
  // And a way back out of the check.
  assert.match(cashier, /className="-ms-2 mb-1 h-11 gap-1\.5 px-2 text-sm font-semibold lg:hidden"/);
  assert.match(cashier, /onClick=\{\(\) => setSelectedTableId\(null\)\}/);
});

test("a phone never scrolls a bill sideways to read it", () => {
  // The 544px four-column table is gone from the phone entirely.
  assert.doesNotMatch(cashier, /min-w-\[34rem\]/, "the horizontal bill table came back");
  assert.match(cashier, /<CashierBillItems items=\{selectedBill\.order\.items\}/);
  // Rows on a phone, the table from sm up.
  assert.match(billItems, /className="divide-y divide-border sm:hidden"/);
  assert.match(billItems, /<Table className="mt-2 hidden sm:table">/);
  assert.doesNotMatch(billItems, /min-w-\[/, "the responsive items grew a minimum width");
  // The line total is never abbreviated away.
  assert.match(billItems, /formatCurrency\(item\.quantity \* item\.unitPrice\)/);
});

test("the counter is master/detail from lg, with the list on the left", () => {
  assert.match(cashier, /lg:grid-cols-\[minmax\(18rem,0\.8fr\)_minmax\(0,1\.5fr\)\]/);
  assert.match(cashier, /aria-label="Açık masa hesapları"/);
});

test("the money button is reachable on a long check and states the amount", () => {
  assert.match(cashier, /sticky bottom-0 -mx-4 mt-4 border-t/);
  assert.match(cashier, /pb-\[max\(0\.75rem,env\(safe-area-inset-bottom\)\)\]/);
  // From lg it returns to the flow rather than floating over a short panel.
  assert.match(cashier, /lg:static lg:m-0 lg:border-0/);
  assert.match(cashier, /\{formatCurrency\(selectedBill\.order\.total\)\} tahsil et/);
  assert.match(cashier, /className="h-12 w-full bg-burgundy/);
});

test("payment methods are large, labelled tiles", () => {
  assert.match(cashier, /min-h-20 items-center gap-3 rounded-xl border/);
  assert.match(cashier, /role="radiogroup"/);
  assert.match(cashier, /aria-checked=\{isActive\}/);
  assert.match(cashier, /\{method\.label\}/, "a method tile is an icon with no word");
});

test("the success state says what was taken and offers the two real next steps", () => {
  assert.match(cashier, /Ödeme alındı/);
  assert.match(cashier, /formatCurrency\(Number\(lastPaid\.amount\)\)/);
  assert.match(cashier, /Makbuz Yazdır/);
  assert.match(cashier, /Hesaplara Dön/);
  // The receipt is a real capability, and failing to print never un-collects.
  assert.match(cashier, /documentType: "PAYMENT_RECEIPT", paymentId/);
  const printer = cashier.slice(cashier.indexOf("async function printReceipt"));
  assert.doesNotMatch(
    printer.slice(0, printer.indexOf("}\n\n")),
    /setLastPaid\(null\)|refetch\(\)/,
    "a failed receipt disturbed the collected payment",
  );
});

test("split and refund stay findable but never outrank taking the money", () => {
  assert.match(cashier, /Hesabı Böl · Kısmi Ödeme · İade/);
  // Secondary by variant and by height; the collect button is the filled one.
  assert.match(cashier, /variant="outline"[\s\S]{0,400}Hesabı Böl · Kısmi Ödeme · İade/);
  assert.match(cashier, /className="mt-2 h-11 w-full font-semibold"/);
  assert.ok(
    cashier.indexOf("tahsil et") < cashier.indexOf("Hesabı Böl · Kısmi Ödeme"),
    "the risky operations sit above the primary collection",
  );
});

test("a closed drawer gates collection in the interface as well as the API", () => {
  assert.match(cashier, /Kasa kapalı\. Tahsilat ve iade için önce kasayı açın\./);
  assert.match(cashier, /disabled=\{collecting \|\| !shiftOpen\}/);
  assert.match(cashier, /disabled=\{!shiftOpen\}/);
});

/* ------------------------------------------------------------- untouched -- */

test("neither operational screen grew personal staff content", () => {
  for (const [name, source] of [["kitchen", board], ["cashier", cashier]] as const) {
    for (const forbidden of ["StaffAttendanceCard", "Yaklaşan vardiya", "Mesaiye Başla"]) {
      assert.ok(!source.includes(forbidden), `${name} grew ${forbidden}`);
    }
  }
});

test("the audio contract on both screens is untouched", () => {
  assert.match(board, /playSound\("new-order"\)/);
  assert.match(board, /newOrderTracker\.current\.update/);
  assert.match(cashier, /playSound\("cashier-notification"\)/);
  assert.match(cashier, /playSound\("payment-success"\)/);
  assert.match(cashier, /notificationTracker\.current\.update/);
});
