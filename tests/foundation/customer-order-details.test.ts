import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * The guest tracking screen answers "where is my food". What they ordered is
 * the second question, so it folds away behind a disclosure instead of pushing
 * the status timeline and the total down the page.
 *
 * There is no DOM renderer in this suite, so these hold the structural and
 * semantic contract of the component rather than rendered output — the same
 * convention the rest of the foundation tests use.
 */

function read(relativePath: string): string {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");
}

const disclosure = read("components/menu/order-details-disclosure.tsx");
const menuExperience = read("components/menu/menu-experience.tsx");
const globals = read("app/globals.css");

test("the details start folded away", () => {
  // The status timeline is the point of the screen; the dishes are opt-in.
  assert.match(disclosure, /useState\(false\)/);
});

test("the trigger is a real button with disclosure semantics", () => {
  assert.match(disclosure, /<button\b/, "a clickable div is not a disclosure trigger");
  assert.match(disclosure, /type="button"/);
  assert.match(disclosure, /aria-expanded=\{open\}/);
  assert.match(disclosure, /aria-controls=\{regionId\}/);
  // The region the trigger names must actually carry that id.
  assert.match(disclosure, /id=\{regionId\}/);
  // Focus must be visible for keyboard use; Enter/Space come free with <button>.
  assert.match(disclosure, /focus-visible:ring/);
  // The whole row is the target, not just the arrow.
  assert.match(disclosure, /min-h-11 w-full/);
});

test("the chevron states the direction it will move", () => {
  assert.match(disclosure, /ChevronDown/);
  // One icon rotated is the same affordance as two icons, with no swap flash.
  assert.match(disclosure, /open && "rotate-180"/);
});

test("it is inline, never an overlay", () => {
  for (const overlay of ["WindowDialog", "DialogContent", "SheetContent", "Popover", "createPortal"]) {
    assert.ok(!disclosure.includes(overlay), `the disclosure became a ${overlay}`);
  }
});

test("each line reads as quantity, dish, price", () => {
  assert.match(disclosure, /\{line\.quantity\} ×/, "quantity must lead the line");
  assert.match(disclosure, /\{line\.productName\}/);
  // The stored snapshot name, so a dish renamed or retired after ordering
  // still reads correctly on the guest's own order.
  assert.match(disclosure, /productName: string/);
  assert.match(disclosure, /formatPrice\(Number\(line\.lineTotal\)\)/);
});

test("prices in the details use the same formatter as the total", () => {
  // A guest reading the menu in euros must never see a line in lira beside a
  // total in euros: both go through the preference-aware formatter.
  assert.match(disclosure, /const \{ formatPrice, language, t \} = useMenuPreferences\(\)/);
  assert.match(menuExperience, /formatPrice\(sessionTotal\)/);
  assert.doesNotMatch(disclosure, /toFixed\(|Intl\.NumberFormat/, "money was formatted by hand");
});

test("a struck-off line is not listed as coming", () => {
  // Same rule the takeaway tracking view already applies.
  assert.match(disclosure, /"CANCELLED" && line\.status !== "VOIDED"/);
});

test("no technical identifier reaches the guest", () => {
  // The id exists in the props for React keys and must never be printed.
  assert.match(disclosure, /key=\{line\.id\}/);
  for (const leak of [
    ">{line.id}",
    "{line.id}<",
    "productId",
    "restaurantId",
    "tableId",
    "sessionNonce",
    "orderId}<",
  ]) {
    assert.ok(!disclosure.includes(leak), `the disclosure renders ${leak}`);
  }
  // No raw lifecycle enum as copy.
  for (const raw of [">PENDING<", ">PREPARING<", ">SERVED<", ">READY<"]) {
    assert.ok(!disclosure.includes(raw), `raw status enum ${raw} rendered`);
  }
});

test("the copy comes from the customer catalogue, not from JSX", () => {
  // 109 locales are generated; a hardcoded Turkish string would ship to all of
  // them. Existing keys are reused rather than inventing one per language.
  assert.match(disclosure, /t\("orderSummary"\)/);
  assert.match(disclosure, /t\("itemCount", \{ count: itemCount \}\)/);
  assert.match(disclosure, /t\("note"\)/);
  assert.doesNotMatch(disclosure, /"(Detay|Sipariş içeriği|Sipariş Özeti|ürün|sipariş)"/, "Turkish copy hardcoded in JSX");
});

test("the tracking screen keeps its timeline, its total and its currency panel", () => {
  assert.match(menuExperience, /<OrderStatusTimeline/);
  assert.match(menuExperience, /t\("total"\)/);
  assert.match(menuExperience, /<OrderCurrencyPanel/);
  // Both tracking cards — the one right after submitting and the one on return.
  assert.equal((menuExperience.match(/<OrderDetailsDisclosure/g) ?? []).length, 2);
});

test("the fold animates a grid row rather than a measured height", () => {
  assert.match(globals, /\.motion-disclosure \{[^}]*grid-template-rows: 0fr/s);
  assert.match(globals, /\.motion-disclosure\[data-open="true"\] \{[^}]*grid-template-rows: 1fr/s);
  // Opening at standard, closing at the quicker exit token.
  assert.match(globals, /\.motion-disclosure \{[^}]*var\(--motion-overlay-exit\)/s);
  assert.match(globals, /\.motion-disclosure\[data-open="true"\] \{[^}]*var\(--motion-standard\)/s);
  // Nothing long, nothing springy.
  assert.doesNotMatch(disclosure, /duration-700|duration-1000|animate-bounce|transition-all/);
});

test("reduced motion keeps the fold working without moving it", () => {
  const reduced = globals.slice(globals.lastIndexOf("@media (prefers-reduced-motion: reduce)"));
  assert.match(reduced, /\.motion-disclosure \{\s*transition: none;/);
});

test("expansion is the guest's state, not the order's", () => {
  // A status refresh must not fold the panel shut under the guest's finger:
  // open/closed is local component state and nothing derives it from status.
  assert.doesNotMatch(disclosure, /useEffect/, "an effect can reset the guest's choice");
  // The one and only writer is the guest pressing the trigger.
  assert.equal((disclosure.match(/setOpen\(/g) ?? []).length, 1);
  assert.match(disclosure, /onClick=\{\(\) => setOpen\(/);
});

test("showing the details costs no extra request", () => {
  // The items already travel with the tracked order the screen is showing.
  for (const fetcher of ["fetch(", "useApiResource", "orderApi.", "useEffect"]) {
    assert.ok(!disclosure.includes(fetcher), `the disclosure fetches (${fetcher}) — N+1`);
  }
  assert.match(menuExperience, /orders=\{sessionOrders\}/);
});
