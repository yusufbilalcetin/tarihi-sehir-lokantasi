import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(relativePath: string): string {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");
}

const operational = read("components/staff/operational-ui.tsx");
const shell = read("components/staff/staff-shell.tsx");
const waiter = read("components/staff/cockpit/service-cockpit.tsx");
const waiterHome = read("components/staff/cockpit/service-home.tsx");
const kitchen = read("components/kitchen/kitchen-board.tsx");
const ticket = read("components/kitchen/kitchen-ticket.tsx");
const cashier = read("components/cashier/cashier-dashboard.tsx");

test("the three role products share presentation chrome, not business logic", () => {
  assert.match(shell, /<OperationalTopBar/);
  assert.match(kitchen, /<OperationalTopBar/);
  assert.match(cashier, /<OperationalTopBar/);
  assert.match(operational, /useStaffSession\(\)/);
  assert.match(operational, /restaurantName\?\.trim\(\)/);
  assert.doesNotMatch(operational, /staffApi|paymentApi|cashierShiftApi|fetch\(/);
});

test("the waiter home is phone-first, truthful and action-oriented", () => {
  for (const label of ["Açık Masa", "Açık Sipariş", "Hesap Bekleyen", "Geciken"]) {
    assert.match(waiterHome, new RegExp(`label="${label}"`));
  }
  assert.match(waiterHome, /dataReady=|ready=\{dataReady\}/);
  assert.match(waiter, /restaurantTimezone/);
  assert.match(waiter, /Intl\.DateTimeFormat\("tr-TR"/);
  // The greeting is the page's one h1; the tag itself lives in the shared hero.
  assert.match(waiter, /<OperationalHero\s+title=\{currentHour === null \? "Hoş geldin" : greeting\(currentHour\)\}/);
  assert.match(operational, /<h1 className=/, "the hero stopped being the page heading");
  assert.match(waiter, /WAITER_ATTENTION_RANK/);
  assert.match(waiterHome, /attention\.slice\(0, 3\)/);
  assert.match(waiter, /board=\{renderBoard\(parts\)\}/);
});

test("the kitchen summary reads the same staged tickets as the board", () => {
  assert.match(kitchen, /label="Geciken" value=\{lateCount\}/);
  assert.match(kitchen, /label="Yeni" value=\{counts\.confirmed\}/);
  assert.match(kitchen, /label="Hazırlanıyor" value=\{counts\.preparing\}/);
  assert.match(kitchen, /label="Hazır" value=\{counts\.ready\}/);
  assert.match(kitchen, /const dataReady = resource\.data !== null/);
  assert.match(kitchen, /role="alert"/);
  assert.match(ticket, /ticketNotes\.orderNote/);
  assert.match(ticket, /className=\{cn\("h-14 w-full rounded-xl text-base font-bold"/);
  assert.match(kitchen, /expectedOrderVersion: order\.version/);
});

test("the cashier summary never confuses sales, collection and payable balance", () => {
  assert.match(cashier, /label="Bekleyen Hesap"/);
  assert.match(cashier, /money\?\.unpaidCount \?\? "—"/);
  assert.match(cashier, /label="Vardiya Tahsilatı"/);
  assert.match(cashier, /summary\.netCollected/);
  assert.match(cashier, /summariseCashierMoney\(openBills\)/);
  assert.match(cashier, /withBalance:\s*true/);
  assert.doesNotMatch(cashier, /label="Bugünkü Satış"/);
  assert.match(cashier, /aria-label="Ödeme bekleyen hesaplar"/);
  assert.match(cashier, /selectedOrderId/);
  assert.match(cashier, /orderId: bill\.order\.id/);
});

test("role routing and server-side access guards remain in their original owners", () => {
  const staffLayout = read("app/staff/layout.tsx");
  const kitchenPage = read("app/kitchen/page.tsx");
  const cashierPage = read("app/cashier/page.tsx");
  assert.match(staffLayout, /resolvePanelAccess\("staff"\)/);
  assert.match(kitchenPage, /resolvePanelAccess\("kitchen"\)/);
  assert.match(cashierPage, /resolvePanelAccess\("cashier"\)/);
  assert.match(kitchenPage, /<KitchenModule \/>/);
  assert.match(cashierPage, /<CashierModule \/>/);
});

test("operational targets, responsive layouts and non-colour labels are explicit", () => {
  assert.match(operational, /min-h-\[4\.75rem\]/);
  assert.match(operational, /focus-visible:ring-2/);
  assert.match(waiter, /min-h-14 w-full flex-col/);
  assert.match(kitchen, /md:grid-cols-2/);
  assert.match(kitchen, /xl:grid-cols-3/);
  assert.match(cashier, /sm:grid-cols-2 xl:grid-cols-3/);
  for (const source of [waiterHome, kitchen, cashier]) {
    assert.match(source, /label=/, "a status surface lost its visible label");
  }
});
