import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

/**
 * Phase 40 — usability, guarded structurally.
 *
 * These are properties of the interface a restaurant worker meets: how many
 * choices a screen puts in front of them, whether a refusal explains itself,
 * whether a word on screen is one they use. None of them needs a browser, and
 * none of them is a pixel snapshot — they check the shape of the source that
 * produces the screen, so they survive restyling and fail on a regression.
 */

function read(relativePath: string): string {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");
}

function sourceFiles(): readonly (readonly [string, string])[] {
  const files: [string, string][] = [];
  const walk = (directory: string) => {
    for (const entry of readdirSync(new URL(`../../${directory}`, import.meta.url), { withFileTypes: true })) {
      const next = `${directory}/${entry.name}`;
      if (entry.isDirectory()) walk(next);
      else if (/\.tsx?$/.test(entry.name)) files.push([next, readFileSync(new URL(`../../${next}`, import.meta.url), "utf8")]);
    }
  };
  ["components", "lib", "app"].forEach(walk);
  return files;
}

const adminShell = read("components/admin/admin-shell.tsx");
const todayPanel = read("components/admin/today-panel.tsx");
const dashboardView = read("components/admin/dashboard-view.tsx");
const kitchenBoard = read("components/kitchen/kitchen-board.tsx");
const staffShell = read("components/staff/staff-shell.tsx");
const cashier = read("components/cashier/cashier-dashboard.tsx");

/* ------------------------------------------------ navigation ------------- */

test("the admin sidebar presents sections, not forty links at once", () => {
  const sections = [...adminShell.matchAll(/\{ label: "([^"]+)", items: \w+ \}/g)].map((match) => match[1]);
  assert.ok(sections.length >= 6 && sections.length <= 9, `expected a handful of sections, found ${sections.length}`);
  // Collapsed by default, except the one holding the current page — so the
  // resting state of the menu is the section count, not the link count.
  assert.match(adminShell, /const holdsCurrentPage = items\.some\(\(item\) => isActivePath\(pathname, item\.href\)\)/);
  assert.match(adminShell, /useState\(holdsCurrentPage\)/);
  assert.match(adminShell, /aria-expanded=\{open\}/);
  assert.match(adminShell, /aria-controls=\{panelId\}/);
});

test("no route was deleted to achieve that grouping", () => {
  // Every admin page on disk must still be reachable from the menu.
  const pages = readdirSync(new URL("../../app/admin", import.meta.url), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `/admin/${entry.name}`);
  const missing = pages.filter((href) => !adminShell.includes(`"${href}"`) && !href.includes("["));
  assert.deepEqual(missing, [], "an admin route exists with no way to navigate to it");
});

test("a collapsed section still says it holds the page you are on", () => {
  assert.match(adminShell, /!open && holdsCurrentPage \? <span[^>]*rounded-full/);
});

test("finding a screen does not require knowing which section owns it", () => {
  assert.match(adminShell, /function searchNav\(/);
  assert.match(adminShell, /NAV_SECTIONS/);
  // Discovery searches the menu already in memory. A per-keystroke database
  // query is exactly the unbounded search Phase 39's budget forbids.
  const search = adminShell.slice(adminShell.indexOf("function searchNav("), adminShell.indexOf("function isActivePath("));
  assert.doesNotMatch(search, /fetch\(|useApiResource|await /, "navigation search must not hit the network");
  assert.match(search, /toLocaleLowerCase\("tr"\)/, "Turkish casing, so 'İ' and 'ı' match as a Turkish speaker expects");
});

/* ------------------------------------------------ manager home ----------- */

test("the manager lands on today's work, not on a fortnight of charts", () => {
  const attentionAt = dashboardView.indexOf("<TodayPanel");
  const analyticsAt = dashboardView.indexOf("14 Günlük Ciro");
  assert.ok(attentionAt !== -1, "the manager home does not show today's state");
  assert.ok(analyticsAt !== -1, "the 14-day view was deleted rather than demoted");
  assert.ok(attentionAt < analyticsAt, "the chart still outranks the work");
});

test("both manager screens read one panel and one endpoint, not two copies", () => {
  for (const [name, source] of [["dashboard", dashboardView], ["erp", read("components/admin/erp-operations-manager.tsx")]] as const) {
    assert.match(source, /TodayPanel/, `${name} does not use the shared panel`);
    assert.match(source, /readOverview/, `${name} does not use the shared reader`);
    // The warning rules live in the panel; a screen re-deriving them is how the
    // two start disagreeing about what needs attention.
    assert.doesNotMatch(source, /counts\.criticalStock > 0/, `${name} re-derives a warning`);
  }
  assert.match(todayPanel, /function warningsFor\(/);
});

test("every warning names the screen where the work is actually done", () => {
  const warnings = todayPanel.slice(todayPanel.indexOf("function warningsFor("), todayPanel.indexOf("const quickActions"));
  const entries = [...warnings.matchAll(/href: "(\/admin\/[a-z-]+)", action: "([^"]+)"/g)];
  assert.ok(entries.length >= 5, "the attention list lost its warnings");
  for (const [, href, action] of entries) {
    assert.ok(adminShell.includes(`"${href}"`), `${href} is not a real destination`);
    assert.ok(/git|Aç|İncele/.test(action), `"${action}" does not read as an action`);
  }
});

test("quick actions are entry points, never a second copy of a form", () => {
  const quick = todayPanel.slice(todayPanel.indexOf("const quickActions"), todayPanel.indexOf("export function TodayPanel"));
  assert.match(quick, /href: "\/admin\//);
  assert.doesNotMatch(quick, /command:|fetch\(|POST/, "a quick action must navigate, not mutate");
});

test("manager quick actions land on the requested form", () => {
  for (const target of [
    "/admin/inventory#action-adjust",
    "/admin/waste#action-waste",
    "/admin/purchasing#action-receipt",
    "/admin/reservations#action-reservation",
    "/admin/attendance#action-attendanceCorrection",
  ]) {
    assert.ok(todayPanel.includes(`href: "${target}"`), `${target} is not directly discoverable from Today`);
  }
  const workspace = read("components/admin/erp-workspace-manager.tsx");
  assert.match(workspace, /window\.location\.hash\.startsWith\("#action-"\)/);
  assert.match(workspace, /target\.focus\(\{ preventScroll: true \}\)/);
});

test("high-frequency form choices are human-identifiable and labelled", () => {
  const workspace = read("components/admin/erp-workspace-manager.tsx");
  assert.match(workspace, /function rowOptionLabel\(/);
  assert.match(workspace, /row\.staff/);
  assert.match(workspace, /row\.supplier/);
  assert.doesNotMatch(workspace, /label:String\([^\n]*\?\?"Kayıt"/, "different records must not all be called Kayıt");
  assert.match(workspace, /htmlFor=\{fieldId\}/);
  assert.match(workspace, /id=\{fieldId\}/);
  assert.match(workspace, /role="alert"/);
});

test("waste reuses the product unit the system already knows", () => {
  const workspace = read("components/admin/erp-workspace-manager.tsx");
  const repository = read("lib/repositories/drizzle-erp-workspace-repository.ts");
  assert.match(repository, /base_unit::text as unit from inventory_items/);
  assert.match(workspace, /action\.id === "waste" && key === "inventoryItemId"/);
  assert.match(workspace, /knownUnit \? \{ unit: knownUnit \}/);
});

test("supplier payment shows its financial consequence before writing", () => {
  const workspace = read("components/admin/erp-workspace-manager.tsx");
  assert.match(workspace, /requiresReview:true/);
  for (const label of ["Tedarikçi", "Toplam borç", "Ödeme", "Ödeme sonrası kalan"]) {
    assert.ok(workspace.includes(label), `payment review is missing ${label}`);
  }
  assert.match(workspace, /if \(action\.requiresReview && !reviewing\)/);
  assert.match(workspace, /paymentAmount > debtBefore/);
});

/* ------------------------------------------------ states ----------------- */

test("a figure that has not loaded is not reported as zero", () => {
  assert.match(todayPanel, /const pending = overview === null && !failed;/);
  assert.match(todayPanel, /const placeholder = "—";/);
  assert.match(todayPanel, /value=\{overview \? <Money amount=\{overview\.today\.sales\} \/> : placeholder\}/);
  // The old shape rendered ₺0,00 while the request was still in flight.
  assert.doesNotMatch(todayPanel, /overview\?\.today\.sales \?\? "0\.00"/);
});

test("empty is not dressed up as failure", () => {
  const workspace = read("components/admin/erp-workspace-manager.tsx");
  // Three distinct branches: still loading, actually failed, genuinely empty.
  assert.match(workspace, /resource\.loading&&!data\?<LoadingState/);
  assert.match(workspace, /resource\.error&&!data\?<ErrorState/);
  assert.match(workspace, /!data\.rows\.length\?<ErpEmpty/);
});

/* ------------------------------------------------ error messages --------- */

test("a blocked stock movement explains itself instead of saying 'try again'", () => {
  const erp = read("lib/domain/erp.ts");
  const guard = erp.slice(erp.indexOf("export function evaluateStockBalance"), erp.indexOf("export const STOCK_MOVEMENT_TYPES"));
  // A bare Error is redacted to the generic internal message, which tells the
  // user to retry an operation that will fail identically.
  assert.doesNotMatch(guard, /throw new Error\(/, "the refusal will be redacted into 'try again'");
  assert.match(guard, /throw new DomainError\(\s*"CONFLICT"/);
  assert.match(guard, /Mevcut: \$\{available/, "the message must name what is actually on hand");
  assert.match(guard, /Miktarı azaltın|stok girişi/, "the message must say what to do next");
  // The guard still refuses; only the sentence changed.
  assert.match(guard, /nextAtoms < 0n && policy === "BLOCK"/);
});

test("the shortage message names a real unit where the caller knows one", () => {
  for (const path of ["lib/repositories/drizzle-erp-repository.ts", "lib/repositories/drizzle-erp-workspace-repository.ts"]) {
    assert.match(read(path), /unit: ERP_UNIT_LABELS\[item\.baseUnit\]/, `${path} does not pass a unit`);
  }
});

/* ------------------------------------------------ confirmations ---------- */

test("no screen asks 'emin misiniz' where it could say what will happen", () => {
  for (const [path, source] of sourceFiles()) {
    assert.doesNotMatch(source, /emin misiniz/i, `${path} still asks a generic confirmation`);
  }
});

test("moving an order forward in the kitchen is one tap, with no dialog", () => {
  assert.match(kitchenBoard, /onClick=\{\(\) => onAdvance\(order\.id, action\.nextStatus\)\}/);
  // The only dialog on this screen is the deliberate backwards step, which also
  // collects a reason.
  const dialogs = [...kitchenBoard.matchAll(/<Dialog\s/g)];
  assert.equal(dialogs.length, 1, "the kitchen grew a dialog on the fast path");
  assert.match(kitchenBoard, /rollback !== null/);
});

/* ------------------------------------------------ terminology ------------ */

test("no screen makes a restaurant worker read implementation vocabulary", () => {
  // These are words from the database and the architecture, not from a
  // kitchen. Each has a restaurant word that means the same thing.
  const forbidden = [/\bledger\b/i, /\bidempoten/i, /\boutbox\b/i, /\btenant\b/i, /\bfulfillment\b/i, /\bDTO\b/, /\bpayload\b/i, /\btransaction\b/i, /\baudit\b/i, /\bexact money\b/i, /\bsnapshot\b/i];
  for (const [path, source] of sourceFiles()) {
    if (!path.startsWith("components/")) continue;
    for (const line of source.split("\n")) {
      // Only user-visible text: quoted strings and JSX text, not identifiers.
      const visible = [...line.matchAll(/"([^"]{4,})"|>([^<>{}]{4,})</g)].map((match) => match[1] ?? match[2]);
      for (const text of visible) {
        // Prose only. Paths, class lists, command-object fragments and bare
        // lowercase identifiers (module keys such as "fulfillment") are code —
        // Phase 40 renames what a person reads, never an internal identifier.
        // Prose only. These files are written on very long lines, so anything
        // carrying code punctuation is a fragment of an expression rather than
        // a sentence someone reads. Internal identifiers are renamed by nobody:
        // Phase 40 changes what a person reads, never a module key.
        if (!/\s/.test(text.trim()) || /[;=(){}[\]<>]/.test(text)) continue;
        if (/className|aria-|href|import|@\/|https?:/.test(text)) continue;
        for (const term of forbidden) {
          assert.doesNotMatch(text, term, `${path} shows implementation vocabulary: "${text.trim().slice(0, 70)}"`);
        }
      }
    }
  }
});

test("ERP headings use restaurant language instead of implementation language", () => {
  const copy = `${read("lib/domain/erp-ui.ts")}\n${read("app/admin/inventory/[itemId]/page.tsx")}`;
  for (const term of [/\bledger\b/i, /\bfood cost\b/i, /\bbatch maliyeti\b/i, /\bsnapshot\b/i]) {
    assert.doesNotMatch(copy, term);
  }
});

test("the guest is never shown the channel enum the database stores", () => {
  const guest = read("components/guest/guest-order-experience.tsx");
  for (const raw of [">TAKEAWAY<", ">DELIVERY<", ">DINE_IN<"]) {
    assert.ok(!guest.includes(raw), `the guest screen prints ${raw}`);
  }
});

/* ------------------------------------------------ responsive ------------- */

test("the kitchen board does not squeeze three lanes into a tablet portrait", () => {
  // At 768px three lanes leave roughly 229px per card, which has to hold a
  // quantity chip, a product name, a note and a touch target. The three-lane
  // layout starts at lg (1024px), where a lane is about 314px.
  // Asserted as intent, not as one literal class string: what matters is that
  // the three-lane layout is gated at lg and never earlier.
  assert.match(kitchenBoard, /className="grid gap-3[^"]*lg:grid-cols-3/);
  assert.doesNotMatch(kitchenBoard, /(sm|md):grid-cols-3/);
  assert.doesNotMatch(kitchenBoard, /grid gap-4 md:grid-cols-3/);
});

test("staff surfaces keep touch-sized controls", () => {
  for (const [name, source] of [["kitchen", kitchenBoard], ["cashier", cashier], ["staff shell", staffShell]] as const) {
    assert.match(source, /min-h-1[012]|h-1[124]|size-1[12]/, `${name} has no touch-sized control`);
  }
});

/* ------------------------------------------------ role focus ------------- */

test("a waiter is never asked to navigate ERP concepts", () => {
  const hrefs = [...staffShell.matchAll(/href: "([^"]+)"/g)].map((match) => match[1]);
  assert.ok(hrefs.length <= 5, `a waiter sees ${hrefs.length} destinations`);
  for (const href of hrefs) {
    assert.ok(href.startsWith("/staff/"), `the waiter menu points outside their work: ${href}`);
  }
});

test("the kitchen screen stays about food, not about money or customers", () => {
  for (const term of ["food cost", "supplier", "tedarikçi", "payable", "borç", "address", "adres"]) {
    assert.ok(!kitchenBoard.toLowerCase().includes(term.toLowerCase()), `the kitchen board mentions ${term}`);
  }
});

test("the cashier's common path stays one screen and the rest is behind a sheet", () => {
  // Pick a bill, keep or change the method, collect. No modal in the way.
  assert.match(cashier, /onClick=\{\(\) => void takePayment\(\)\}/);
  assert.match(cashier, /setOperationsOpen\(true\)/);
  assert.match(cashier, /BillOperationsSheet/);
  const collect = cashier.slice(cashier.indexOf("takePayment()"), cashier.indexOf("takePayment()") + 400);
  assert.doesNotMatch(collect, /window\.confirm|<Dialog/, "a normal payment must not require a confirmation");
});
