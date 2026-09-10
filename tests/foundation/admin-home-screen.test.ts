import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  adminAppForPath,
  adminParentForPath,
} from "../../components/admin/admin-navigation";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const dashboard = read("components/admin/dashboard-view.tsx");
const dashboardModule = read("components/admin/dashboard-module.tsx");
const shell = read("components/admin/admin-shell.tsx");
const styles = read("app/globals.css");

function launcherBlock(): string {
  return dashboard.slice(
    dashboard.indexOf("export const HOME_APP_SHORTCUTS"),
    dashboard.indexOf("export function greetingForHour"),
  );
}

test("the Home Screen exposes exactly the eight approved apps in order", () => {
  const apps = [...launcherBlock().matchAll(/label: "([^"]+)", href: "([^"]+)"/g)]
    .map((match) => ({ label: match[1], href: match[2] }));
  assert.deepEqual(apps, [
    { label: "Masalar", href: "/admin/tables" },
    { label: "Siparişler", href: "/admin/orders" },
    { label: "Kasa", href: "/admin/cash-registers" },
    { label: "Raporlar", href: "/admin/reports" },
    { label: "Personel", href: "/admin/staff" },
    { label: "Menü", href: "/admin/menu" },
    { label: "Stok", href: "/admin/inventory" },
    { label: "Ayarlar", href: "/admin/settings" },
  ]);
  assert.match(dashboard, /HOME_APP_SHORTCUTS\.map\(\(app\) =>/);
});

test("Stok is only a Home shortcut and remains canonically under Daha Fazla", () => {
  assert.equal(adminAppForPath("/admin/inventory")?.id, "more");
  assert.deepEqual(adminParentForPath("/admin/inventory"), {
    href: "/admin/erp",
    label: "Daha Fazla",
  });
  assert.match(launcherBlock(), /label: "Stok", href: "\/admin\/inventory"/);
});

test("the root is a Home Screen rather than a classic dashboard module", () => {
  assert.match(dashboard, /data-admin-home/);
  assert.equal((dashboard.match(/<h1\b/g) ?? []).length, 1);
  assert.doesNotMatch(dashboard, /AdminPageHeader|AdminPanel|<TodayPanel|<table\b|Hızlı işlemler|Açık siparişler/);
  assert.doesNotMatch(dashboardModule, /AdminModuleWindow/);
  assert.match(dashboardModule, /return <DashboardView \/>/);
});

test("live figures retain their authoritative sources and distinct meanings", () => {
  assert.match(dashboard, /overview\.data\.today\.sales/);
  assert.match(dashboard, /collections\.data\.netCollected/);
  assert.match(dashboard, /overview\.data\?\.today\.openOrders/);
  assert.match(dashboard, /staffApi\.tables\(signal\)/);
  assert.match(dashboard, /filter\(\(table\) => isTableOpen\(table\.status\)\)/);
  assert.match(dashboard, /collections\.data\.openShiftCount/);
  assert.match(dashboard, /Satış ve tahsilat aynı şey değildir/);
  assert.doesNotMatch(dashboard, /reduce\([^)]*(?:payment|amount)/i);
});

test("mobile keeps a compact two-column snapshot and a four-by-two launcher", () => {
  assert.match(dashboard, /grid grid-cols-2 gap-2\.5 md:hidden/);
  assert.match(dashboard, /min-h-\[78px\]/);
  assert.match(dashboard, /grid grid-cols-4 gap-x-2 gap-y-2\.5/);
  assert.match(dashboard, /size-14[^\n]*sm:size-\[72px\]/);
  assert.match(dashboard, /min-h-\[82px\]/);
  assert.doesNotMatch(dashboard, /grid-cols-1/);
});

test("app icons are large, solid and visually differentiated", () => {
  const colours = [...launcherBlock().matchAll(/iconClassName: "([^"]+)"/g)].map((match) => match[1]);
  assert.equal(colours.length, 8);
  assert.equal(new Set(colours).size, 8);
  assert.ok(colours.every((colour) => /bg-\[#[0-9a-f]{6}\]/i.test(colour)));
  assert.ok(!colours.some((colour) => /gray|grey|muted/.test(colour)));
});

test("attention is truthful, prioritized and visibly bounded", () => {
  assert.equal(dashboard.indexOf('key: "late-orders"') < dashboard.indexOf('key: "bill-requests"'), true);
  assert.equal(dashboard.indexOf('key: "bill-requests"') < dashboard.indexOf("const overviewWarnings"), true);
  assert.match(dashboard, /warningsFor\(overview\.data\)/);
  assert.match(dashboard, /slice\(0, HOME_ATTENTION_LIMIT\)/);
  assert.match(dashboard, /export const HOME_ATTENTION_LIMIT = 3/);
  assert.match(dashboard, /Şu anda dikkat gerektiren bir konu yok/);
  assert.doesNotMatch(dashboard, /yazıcı.*(?:offline|çevrimdışı)/i);
});

test("the greeting is timezone-aware and hydration-safe", () => {
  assert.match(dashboard, /useStaffSession\(\)/);
  assert.match(dashboard, /restaurantTimezone/);
  assert.match(dashboard, /Intl\.DateTimeFormat\("tr-TR"/);
  assert.match(dashboard, /useSyncExternalStore\(NEVER_CHANGES, \(\) => true, \(\) => false\)/);
  assert.match(dashboard, /hour >= 5 && hour < 12/);
  assert.match(dashboard, /hour >= 12 && hour < 18/);
});

test("Home styling is scoped, legible without blur and honors accessibility modes", () => {
  const homeStyles = styles.slice(styles.indexOf(".admin-home {"), styles.indexOf("/* Admin is an operational surface"));
  assert.match(homeStyles, /\.admin-home-material/);
  assert.match(homeStyles, /background: rgb\(255 250 244 \/ 80%\)/);
  assert.match(homeStyles, /@supports \(backdrop-filter: blur\(1px\)\)/);
  assert.match(homeStyles, /@media \(forced-colors: active\)/);
  assert.match(dashboard, /focus-visible:ring-2/);
  assert.match(dashboard, /motion-reduce:transition-none/);
});

test("N2 remains sidebarless and keeps the mobile dock clear of content", () => {
  assert.doesNotMatch(shell, /<aside\b|<Sheet\b|SidebarRail|SidebarContent/);
  assert.match(shell, /<MobileDock pathname=\{pathname\}/);
  assert.match(shell, /pb-\[calc\(4\.5rem\+env\(safe-area-inset-bottom\)\)\] md:pb-0/);
});
