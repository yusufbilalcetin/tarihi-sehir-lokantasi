import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * Phase N4.1 — the three operational screens are Home Screens, not POS panels.
 *
 * The earlier N4 tests hold the *content* of those screens honest: which figure
 * comes from which server contract, which transition a role may make. These
 * hold the *shape*, because the shape is what N4.1 changed and the shape is
 * what silently regresses first — a lane board creeps back into the kitchen, a
 * counter quietly pre-selects a bill again, a home screen grows a second pane.
 *
 * Source assertions, not rendered ones: no browser runs in this suite, so
 * nothing here claims a screenshot passed.
 */

function read(relativePath: string): string {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");
}

const operational = read("components/staff/operational-ui.tsx");
const cockpit = read("components/staff/cockpit/service-cockpit.tsx");
const serviceHome = read("components/staff/cockpit/service-home.tsx");
const attentionQueue = read("components/staff/cockpit/attention-queue.tsx");
const tableCard = read("components/staff/cockpit/service-table-card.tsx");
const kitchen = read("components/kitchen/kitchen-board.tsx");
const filters = read("components/kitchen/kitchen-filters.tsx");
const cashier = read("components/cashier/cashier-dashboard.tsx");

/* =================================================================== garson */

test("1. the waiter lands on a Home Screen, not on the old cockpit", () => {
  // The home canvas, and the greeting-plus-identity hero that opens it.
  assert.match(cockpit, /<OperationalHome role="service"/);
  assert.match(serviceHome, /data-service-home="radical"/);
  assert.match(cockpit, /<OperationalHero/);
  assert.match(cockpit, /person=\{name\}/, "the hero lost the waiter's own name");
  assert.match(cockpit, /function greeting\(hour: number\)/);
  // And the three-pane cockpit it replaced is gone rather than hidden.
  for (const dead of ["TABLET_MEDIA_QUERY", "<ProductBrowser", 'aria-label="Seçili masa"']) {
    assert.ok(!cockpit.includes(dead), `the old cockpit kept ${dead}`);
  }
});

test("2. the waiter's four live metrics are truthful, never fabricated zeros", () => {
  for (const label of ["Açık Masa", "Açık Sipariş", "Hesap Bekleyen", "Geciken"]) {
    assert.match(serviceHome, new RegExp(`label="${label}"`), `${label} left the live status`);
  }
  // 2x2 on a phone, four across only once there is room for four labels.
  assert.match(operational, /grid grid-cols-2 gap-2\.5 lg:grid-cols-4/);
  // Every tile is gated on the first successful read.
  assert.equal(
    (serviceHome.match(/ready=\{dataReady\}/g) ?? []).length,
    4,
    "a live metric renders before its data has arrived",
  );
  // And an ungated metric is a dash, not a zero.
  assert.match(operational, /\{ready \? value : "—"\}/);
  assert.match(operational, /\{loading \? "Yükleniyor" : "Bilgi alınamadı"\}/);
});

test("3. the waiter gets a role launcher and a bottom bar, not a menu tree", () => {
  assert.match(serviceHome, /<OperationalActionGrid ariaLabel="Servis uygulamaları">/);
  for (const label of ["Masalar", "Siparişler", "Hazır Servis", "Çağrılar"]) {
    assert.match(serviceHome, new RegExp(`label="${label}"`), `${label} left the launcher`);
  }
  // The launcher moves the home's own view; only Çağrılar is a route.
  assert.match(serviceHome, /href="\/staff\/calls"/);
  // Four destinations in the bar, each with a branch of its own.
  assert.equal((cockpit.match(/\{ id: "(?:tables|orders|ready|profile)"/g) ?? []).length, 4);
  for (const view of ["tables", "orders", "ready", "profile"]) {
    assert.match(cockpit, new RegExp(`view === "${view}"`), `${view} has no branch`);
  }
});

test("4. the home shows at most three things that need a person", () => {
  assert.match(serviceHome, /attention\.slice\(0, 3\)/);
  // Ranked by what the guest is actually waiting for, in the stated order.
  assert.match(
    cockpit,
    /const WAITER_ATTENTION_RANK = \{\s*"bill-requested": 0,\s*"waiting-too-long": 1,\s*"waiter-call": 2,\s*"order-ready": 3,/,
    "the attention priority order moved",
  );
  assert.match(cockpit, /WAITER_ATTENTION_RANK\[left\.reason\] - WAITER_ATTENTION_RANK\[right\.reason\]/);
  // An empty queue says so rather than leaving a hole.
  assert.match(attentionQueue, /Bekleyen iş yok/);
});

test("5. a table opens its detail as progressive disclosure, not a third pane", () => {
  assert.match(cockpit, /<Sheet open=\{Boolean\(parts\.selectedTable\)\}/);
  assert.match(cockpit, /side="bottom"/);
  assert.match(cockpit, /aria-label="Masa detayını kapat"/);
  // The detail body is still the one TableGrid builds, with its own permissions.
  assert.match(cockpit, /\{parts\.detailBody\}/);
  // Large, app-like tiles rather than a dense list row.
  assert.match(tableCard, /flex h-full min-h-32 w-full flex-col rounded-\[22px\]/);
});

/* =================================================================== mutfak */

test("6. the kitchen is a command centre, and the old three-lane board is gone", () => {
  assert.match(kitchen, /<OperationalHome role="kitchen">/);
  assert.match(kitchen, /<OperationalHero/);
  assert.match(kitchen, /title="Çalışma görünümü"/);
  assert.match(kitchen, /title="Şimdi hazırlanacaklar"/);
  // No lanes, at any breakpoint, and no phone/pass fork to hide them behind.
  assert.doesNotMatch(kitchen, /(?:sm|md|lg):grid-cols-3/, "a three-lane board came back");
  assert.doesNotMatch(kitchen, /lg:hidden|lg:block/, "the board forked into two layouts again");
  assert.doesNotMatch(kitchen, /2xl:grid-cols-2/, "a lane's internal ticket grid came back");
  // One ticket list for every width.
  assert.equal((kitchen.match(/<KitchenOrderCard/g) ?? []).length, 1);
  assert.match(kitchen, /className="grid content-start gap-4 md:grid-cols-2 xl:grid-cols-3"/);
});

test("7. the kitchen's live summary is derived from the real state machine", () => {
  assert.match(kitchen, /label="Yeni" value=\{counts\.confirmed\}/);
  assert.match(kitchen, /label="Hazırlanıyor" value=\{counts\.preparing\}/);
  assert.match(kitchen, /label="Geciken" value=\{lateCount\}/);
  assert.match(kitchen, /label="Hazır" value=\{counts\.ready\}/);
  // Every count comes from the domain, never from a field invented on the board.
  assert.match(kitchen, /deriveKitchenStage\(/);
  assert.match(kitchen, /resolveTicketUrgency\(entry\.order\.elapsedMinutes\) === "late"/);
  assert.doesNotMatch(kitchen, /\.priority\b|isRush|rushOrder/, "a priority field was invented");
  // No status the domain does not have.
  assert.doesNotMatch(kitchen, /"(?:delayed|urgent|rush)"\s*:/, "a new kitchen status appeared");
});

test("8. the kitchen's mode filters are large, counted and labelled", () => {
  for (const label of ["Tümü", "Geciken", "Yeni", "Hazırlanıyor", "Hazır"]) {
    assert.match(kitchen, new RegExp(`label: "${label}"`), `${label} left the filters`);
  }
  assert.match(filters, /min-h-\[76px\] min-w-\[76px\]/);
  assert.match(filters, /aria-pressed=\{selected\}/);
  assert.match(filters, /\{option\.label\}/, "a filter is a colour with no word");
  // Counted only once there is something to count: an unread board badges a
  // dash, never a zero that claims nothing is cooking.
  assert.match(filters, /\{option\.count \?\? "—"\}/);
  assert.match(filters, /readonly count: number \| null;/);
  assert.equal(
    (kitchen.match(/count: dataReady \? /g) ?? []).length,
    5,
    "a filter badge counts before the first read has landed",
  );
  assert.match(kitchen, /\{dataReady \? `\$\{mobileTickets\.length\} sipariş` : "—"\}/);
  // The waiter's board count is gated the same way.
  assert.match(serviceHome, /\{dataReady \? `\$\{visibleCount\}\/\$\{totalCount\}` : "—"\}/);
});

test("9. the kitchen keeps its concurrency, rollback and note contracts", () => {
  assert.match(kitchen, /expectedOrderVersion: order\.version/);
  assert.match(kitchen, /expectedOrderVersion: request\.expectedOrderVersion/);
  assert.match(kitchen, /reasonCode: rollbackReason/);
  assert.match(kitchen, /itemsBlockingOrderStage\(/);
  assert.match(kitchen, /canRoleTransitionOrderStatus\(role,/);
  assert.match(kitchen, /canRoleTransitionOrderItemStatus\(/);
});

/* ==================================================================== kasa  */

test("10. the counter lands on a Cashier Home Screen", () => {
  assert.match(cashier, /<OperationalHome role="cashier">/);
  assert.match(cashier, /title="Kasa"\s+person=\{name\}\s+description="Tahsilat ana ekranı"/);
  assert.match(cashier, /<OperationalSectionHeading id="cashier-apps-title" title="Kasa uygulamaları"/);
  for (const label of ["Bekleyen Hesaplar", "Kasa İşlemleri", "Gün Sonu"]) {
    assert.match(cashier, new RegExp(`label="${label}"`), `${label} left the cashier launcher`);
  }
  // Every launcher target is a section that actually exists on the page.
  for (const anchor of ["cashier-payables", "cashier-shift"]) {
    assert.match(cashier, new RegExp(`href="#${anchor}"`), `${anchor} is not linked`);
    assert.match(cashier, new RegExp(`id="${anchor}"`), `${anchor} is not a real section`);
  }
});

test("11. no payable is ever selected implicitly", () => {
  // The whole point: the domain still reports an "auto" candidate, and the
  // counter deliberately refuses it. A landing screen is not a payment decision.
  assert.match(
    cashier,
    /const selectedBill = selectedOrderId \? selection\.bill \?\? undefined : undefined;/,
    "the counter went back to auto-selecting the top of the queue",
  );
  assert.match(cashier, /useState<string \| null>\(null\)/, "the counter starts with a bill chosen");
  assert.doesNotMatch(
    cashier,
    /selectedBill = selection\.bill\b(?! \?\? undefined : undefined)/,
    "the selection fell through to the queue again",
  );
});

test("12. a payable card is selected by order id and opens the workspace", () => {
  assert.match(cashier, /onClick=\{\(\) => setSelectedOrderId\(order\.id\)\}/);
  assert.match(cashier, /key=\{order\.id\}/);
  assert.match(cashier, /Hesabı aç/);
  assert.match(cashier, /aria-label=\{`\$\{order\.tableName\}, \$\{order\.orderNumber\}, hesabı aç`\}/);
  // Large, app-like cards, and the landing card offers exactly one action.
  assert.match(cashier, /min-h-40 rounded-\[24px\]/);
  for (const risky of ["Hesabı Böl", "İade", "Makbuz Yazdır", "tahsil et"]) {
    const board = cashier.slice(cashier.indexOf('aria-label="Ödeme bekleyen hesaplar"'));
    assert.ok(
      !board.slice(0, board.indexOf("</section>")).includes(risky),
      `${risky} is offered on the landing card`,
    );
  }
});

test("13. the payment workspace only exists after an explicit selection", () => {
  // The home returns first; everything below it is the workspace.
  const homeBranch = cashier.indexOf("if (!selectedBill) {");
  assert.ok(homeBranch > 0, "the counter lost its landing branch");
  const workspace = cashier.slice(cashier.indexOf("Tahsilat ana ekranı", homeBranch + 10));
  assert.match(workspace, /formatCurrency\(Number\(currentLedger\.balance\.outstanding\)\)\} tahsil et/);
  assert.match(workspace, /<BillOperationsSheet/);
  // And no permanent master/detail pane at any width.
  assert.doesNotMatch(cashier, /grid-cols-\[minmax\(18rem/, "the desktop split pane came back");
  assert.doesNotMatch(cashier, /hidden lg:block/, "a pane is hidden by class instead of by state");
});

test("13b. the workspace never labels the gross order total as what is due", () => {
  // `order.total` is the gross payable. After a part payment it is not what is
  // owed, so no heading on the counter may call it "ödenecek". The two figures
  // the screen states are the server's outstanding and the ledger's.
  assert.doesNotMatch(cashier, /formatCurrency\(selectedBill\.order\.total\)/, "the gross total is shown as a payable");
  assert.doesNotMatch(cashier, /Ödenecek toplam/, "a gross figure is labelled as the amount due");
  assert.match(cashier, /formatCurrency\(Number\(selectedBill\.order\.outstanding\)\)\} ödenecek/);
  assert.match(cashier, /formatCurrency\(Number\(currentLedger\.balance\.outstanding\)\)\} tahsil et/);
  // The operations sheet keeps taking the ledger's own payable total.
  assert.match(cashier, /orderTotal=\{currentLedger\.balance\.payableTotal\}/);
});

test("14. returning to the cashier home clears the selection", () => {
  assert.match(cashier, /<ChevronLeft className="size-4" aria-hidden="true" \/>\s*Tahsilat ana ekranı/);
  assert.match(cashier, /onClick=\{\(\) => setSelectedOrderId\(null\)\}/);
  // A completed collection returns there too, rather than falling to another bill.
  assert.match(cashier, /setSelectedOrderId\(null\);\s*await refetch\(\);/);
  // Two mental states, two scroll positions: opening a check must not land the
  // cashier halfway down it, past its name and past the way back out.
  assert.match(
    cashier,
    /window\.scrollTo\(\{ top: 0, behavior: "auto" \}\);\s*\}, \[selectedOrderId\]\)/,
    "the counter carries one scroll position across both states",
  );
});

/* ================================================= cashier money invariants */

test("15. distinct payable orders are never collapsed by the interface", () => {
  // Built from the orders, keyed by the order, listed one row each.
  assert.match(cashier, /buildCashierBills\(tables, orders, billRequestTableIds\)/);
  assert.match(cashier, /visibleBills\.map\(\(\{ table, order, billRequested \}\)/);
  assert.match(cashier, /key=\{order\.id\}/);
  // No grouping by table anywhere on the counter.
  assert.doesNotMatch(cashier, /groupBy|reduce\([^)]*tableId/, "the counter grouped orders by table");
  // A takeaway or courier order has no table and is still listed and payable:
  // the row falls back to a bag icon rather than being filtered out.
  assert.match(cashier, /table \? <ReceiptText[\s\S]{0,120}: <ShoppingBag/);
  assert.match(cashier, /\{order\.tableName\}/, "the row cannot name a tableless order");
});

test("16. the money contracts on the counter are untouched", () => {
  // Server-derived balances only; the counter sums, it never derives.
  assert.match(cashier, /withBalance:\s*true/);
  assert.match(cashier, /summariseCashierMoney\(openBills\)/);
  assert.match(cashier, /ledger\.data\?\.orderId === ledgerOrderId/);
  assert.doesNotMatch(cashier, /reduce\(\(sum, bill\) => sum \+ bill\.order\.total, 0\)/);
  // Idempotency, the double-tap guard, and the closed-drawer refusal.
  assert.match(cashier, /if \(!selectedBill \|\| collecting \|\| !shiftOpen\) return;/);
  assert.match(cashier, /if \(!currentLedger \|\| ledger\.error\) return;/);
  assert.match(cashier, /newIdempotencyKey\(\)/);
  assert.match(cashier, /orderId: bill\.order\.id, method: API_PAYMENT_METHOD\[selectedMethod\]/);
  // Success is only ever signalled after the server has answered.
  const collect = cashier.slice(cashier.indexOf("async function takePayment"));
  assert.ok(
    collect.indexOf('playSound("payment-success")') > collect.indexOf("await paymentApi.collect"),
    "success is signalled before the server answers",
  );
});

test("17. sales and collections stay different words for different figures", () => {
  assert.match(cashier, /label="Bekleyen Hesap"/);
  assert.match(cashier, /label="Vardiya Tahsilatı"/);
  assert.match(cashier, /summary\.netCollected/);
  // There is no authoritative source for a day's sales on this screen, so the
  // screen does not claim one.
  assert.doesNotMatch(cashier, /Bugünkü Satış|Günlük Satış|Toplam Satış/, "the counter claimed a sales figure");
  // Unknown money is a dash, and the shift figures are gated on their own read.
  assert.match(cashier, /money\?\.unpaidCount \?\? "—"/);
  assert.match(cashier, /ready=\{Boolean\(shiftResource\.data\?\.summary\)\}/);
  assert.match(cashier, /!cashierReady \|\| money === null\s*\? "—"/);
});

/* ================================================ shared layer and routing  */

test("18. the shared operational layer is presentation and session chrome only", () => {
  // It knows who is signed in and what the restaurant is called. Nothing else.
  assert.match(operational, /useStaffSession\(\)/);
  for (const forbidden of [
    "staffApi",
    "paymentApi",
    "cashierShiftApi",
    "ledgerApi",
    "printApi",
    "fetch(",
    "useApiResource",
    "repositories",
    "drizzle",
  ]) {
    assert.ok(!operational.includes(forbidden), `the shared layer reached for ${forbidden}`);
  }
  // And it owns no permission decision.
  assert.doesNotMatch(operational, /canRole|resolvePanelAccess|role === "/);
});

test("19. the three homes are one product family", () => {
  for (const [name, source] of [
    ["service", cockpit],
    ["kitchen", kitchen],
    ["cashier", cashier],
  ] as const) {
    assert.match(source, /<OperationalHome role="/, `${name} is not on the shared canvas`);
    assert.match(source, /<OperationalHero/, `${name} has no home hero`);
  }
  for (const [name, source] of [["kitchen", kitchen], ["cashier", cashier]] as const) {
    assert.match(source, /<OperationalBackdrop>/, `${name} lost the shared backdrop`);
    assert.match(source, /<OperationalTopBar/, `${name} lost the shared top bar`);
  }
  // The waiter reaches both through the shell instead of repeating them.
  const shell = read("components/staff/staff-shell.tsx");
  assert.match(shell, /<OperationalBackdrop>/);
  assert.match(shell, /<OperationalTopBar/);
  // One warm cream ground and one espresso ink for all of them.
  assert.match(operational, /bg-\[#F7F0E6\] text-\[#2D2018\]/);
});

test("20. role routing and the server-side guards are exactly where they were", () => {
  assert.match(read("app/staff/layout.tsx"), /resolvePanelAccess\("staff"\)/);
  assert.match(read("app/kitchen/page.tsx"), /resolvePanelAccess\("kitchen"\)/);
  assert.match(read("app/cashier/page.tsx"), /resolvePanelAccess\("cashier"\)/);
  // And no home screen decides access for itself.
  for (const [name, source] of [
    ["service", cockpit],
    ["kitchen", kitchen],
    ["cashier", cashier],
  ] as const) {
    assert.ok(!source.includes("resolvePanelAccess"), `${name} forked the panel guard`);
  }
});

test("21. every home distinguishes loading, error, empty and ready", () => {
  // Kitchen and counter: a skeleton while the first read is in flight, a spoken
  // failure, and an empty state that only claims emptiness once data arrived.
  for (const [name, source] of [["kitchen", kitchen], ["cashier", cashier]] as const) {
    assert.match(source, /animate-pulse/, `${name} has no loading state`);
    assert.match(source, /motion-reduce:animate-none/, `${name} animates under reduced motion`);
    assert.match(source, /role="alert"/, `${name} has no spoken failure`);
    assert.match(
      source,
      /son alınan durum gösteriliyor/,
      `${name} discards its last good data on a refresh failure`,
    );
  }
  // Loading and failure are separate branches, so a first read that failed
  // renders no skeleton AND no "nothing here" — the alert above is the answer.
  assert.match(kitchen, /\{!dataReady \? \(/);
  assert.match(cashier, /\{!cashierReady \? \(/);
  for (const [name, source] of [["kitchen", kitchen], ["cashier", cashier]] as const) {
    assert.match(
      source,
      /resource\.loading \? \([\s\S]{0,500}\) : null/,
      `${name} claims emptiness after a failed first read`,
    );
  }
  // The counter's drawer panel is never a heading over nothing.
  assert.match(cashier, /aria-label="Kasa durumu yükleniyor"/);
  assert.match(cashier, /Kasa durumu alınamadı/);
  // The waiter's board says the same three things.
  assert.match(cockpit, /floor\.error && !floor\.tables\.length/);
  assert.match(cockpit, /floor\.loading && !floor\.tables\.length/);
  assert.match(cockpit, /Masa bulunamadı/);
});

test("22. one h1 per home, and it is the hero", () => {
  assert.equal((operational.match(/<h1\b/g) ?? []).length, 1, "the shared hero grew a second h1");
  for (const [name, source] of [
    ["service", cockpit],
    ["kitchen", kitchen],
    ["cashier", cashier],
  ] as const) {
    assert.ok(!source.includes("<h1"), `${name} rendered an h1 beside the hero's`);
  }
  // Each home hero is rendered exactly once per rendered branch.
  assert.equal((cockpit.match(/<OperationalHero/g) ?? []).length, 1);
  assert.equal((kitchen.match(/<OperationalHero/g) ?? []).length, 1);
  // The counter has two branches, so it has two heroes — one each.
  assert.equal((cashier.match(/<OperationalHero/g) ?? []).length, 2);
});
