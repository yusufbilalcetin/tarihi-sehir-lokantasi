import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * The kitchen and the counter have to be genuinely different screens, not one
 * desktop layout squeezed. Since the radical home redesign they are one
 * responsive surface each rather than a phone branch and a pass branch, so
 * these tests hold that surface to the shape it claims: one ticket column on a
 * phone, more of them as the width arrives, and a counter whose landing screen
 * and payment workspace are two states rather than two panes.
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

test("the kitchen is one priority grid at every width, never a lane board", () => {
  // One ticket surface, widening with the screen: 390 -> 1, 768 -> 2, 1280 -> 3.
  assert.match(board, /className="grid content-start gap-4 md:grid-cols-2 xl:grid-cols-3"/);
  assert.match(board, /<KitchenFilters/);
  assert.match(board, /\{mobileTickets\.map\(/);
  // The three-lane Kanban is gone from the top level, at every breakpoint.
  assert.doesNotMatch(board, /(sm|md|lg):grid-cols-3/, "the three-lane board came back");
  assert.doesNotMatch(board, /lg:h-full lg:min-h-0 lg:grid-cols-3/, "the pass lanes came back");
  assert.doesNotMatch(board, /lg:hidden|lg:block/, "the board forked into a phone and a pass layout again");
  // And there is exactly one ticket list, not one per lane.
  assert.equal(
    (board.match(/<KitchenOrderCard/g) ?? []).length,
    1,
    "the board renders more than one ticket list",
  );
});

test("the priority section is what the cook reads first", () => {
  // Urgency ranks the one grid rather than a lane deciding position.
  assert.match(board, /title="Şimdi hazırlanacaklar"/);
  assert.match(board, /sortKitchenTickets\(matching\.map/);
  // The live summary sits above it and carries the same four real states.
  assert.ok(
    board.indexOf('ariaLabel="Canlı mutfak durumu"') < board.indexOf('title="Şimdi hazırlanacaklar"'),
    "the live status fell below the work",
  );
});

test("the mode filters are real navigation over the same board", () => {
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

test("the mode filters clear 44px and are not colour-only", () => {
  // App-like tiles now, so the target is stated in pixels rather than min-h-11.
  assert.match(filters, /min-h-\[76px\] min-w-\[76px\]/);
  assert.match(filters, /aria-pressed=\{selected\}/);
  assert.match(filters, /\{option\.label\}/, "a filter is a colour with no word");
  // The badge is a real number once there is one, and a dash before that.
  assert.match(filters, /\{option\.count \?\? "—"\}/);
});

test("the ticket is one component, so every width shows the same thing", () => {
  assert.match(board, /from "@\/components\/kitchen\/kitchen-ticket"/);
  // Age, table, order note and the primary action all live in that one ticket.
  assert.match(ticket, /\{order\.tableName\}/);
  assert.match(ticket, /formatElapsed\(elapsedMinutes\)/);
  assert.match(ticket, /\{urgency\.label\}/);
  assert.match(ticket, /ticketNotes\.orderNote \?/);
  assert.match(ticket, /Sipariş notu/);
  assert.match(ticket, /className=\{cn\("h-14 w-full rounded-xl text-base font-bold"/);
  assert.doesNotMatch(ticket, /className="h-8 px-2/, "an item control dropped under 44px");
});

test("a late ticket is announced in the live summary at every width", () => {
  assert.match(board, /ariaLabel="Canlı mutfak durumu"/);
  assert.match(board, /label="Geciken" value=\{lateCount\}/);
  assert.match(board, /tone="burgundy"/);
});

/* ================================================================ cashier == */

test("the counter is one step at a time, at every width", () => {
  // Two whole screens rather than two panes: the home returns early, and the
  // payment workspace is the other return. Nothing is hidden with a class.
  assert.match(cashier, /if \(!selectedBill\) \{/, "the counter lost its landing branch");
  assert.match(cashier, /const selectedBill = selectedOrderId \? selection\.bill \?\? undefined : undefined;/);
  assert.doesNotMatch(cashier, /mobileShowsDetail/, "the counter went back to hiding a pane");
  assert.doesNotMatch(cashier, /hidden lg:block/, "a pane is hidden by class instead of by state");
  // And a way back out of the check that names where it goes.
  assert.match(cashier, /Tahsilat ana ekranı/);
  assert.match(cashier, /onClick=\{\(\) => setSelectedOrderId\(null\)\}/);
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

test("the counter's landing is a board of payable cards, not a master/detail pane", () => {
  assert.doesNotMatch(
    cashier,
    /lg:grid-cols-\[minmax\(18rem,0\.8fr\)_minmax\(0,1\.5fr\)\]/,
    "the permanent desktop split pane came back",
  );
  assert.match(cashier, /aria-label="Ödeme bekleyen hesaplar"/);
  // Large cards that widen with the screen, one per payable order.
  assert.match(cashier, /className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3"/);
  assert.match(cashier, /min-h-40 rounded-\[24px\]/, "the payable card is not a large target");
});

test("the money button is reachable on a long check and states the amount", () => {
  assert.match(cashier, /sticky bottom-0 -mx-4 mt-4 border-t/);
  assert.match(cashier, /pb-\[max\(0\.75rem,env\(safe-area-inset-bottom\)\)\]/);
  // From lg it returns to the flow rather than floating over a short panel.
  assert.match(cashier, /lg:static lg:m-0 lg:border-0/);
  assert.match(cashier, /formatCurrency\(Number\(currentLedger\.balance\.outstanding\)\)\} tahsil et/);
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
  assert.match(cashier, /disabled=\{collecting \|\| !shiftOpen \|\| !currentLedger \|\| Boolean\(ledger\.error\)\}/);
  assert.match(cashier, /disabled=\{!shiftOpen \|\| !currentLedger \|\| Boolean\(ledger\.error\)\}/);
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
