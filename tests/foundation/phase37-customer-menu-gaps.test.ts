import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  customerCallStatusTranslationKey,
  matchesCustomerMenuSearch,
  normalizeCustomerMenuSearch,
} from "../../lib/domain/customer-menu";

const customerMenuUi = readFileSync(
  new URL("../../components/menu/menu-experience.tsx", import.meta.url),
  "utf8",
);

test("customer QR menu browses category sections without a search or filter toolbar", () => {
  assert.doesNotMatch(customerMenuUi, /<Input\b/);
  assert.doesNotMatch(customerMenuUi, /<Category(?:Chips|Grid)\b/);
  assert.match(customerMenuUi, /data-customer-menu-content="category-sections"/);
  assert.match(customerMenuUi, /groupedProducts\.map\(\(\{ category, products \}\)/);
  assert.match(customerMenuUi, /getMenuCategoryName\(category, language\)/);
  assert.match(customerMenuUi, /products\.map\(\(product, index\).*<ProductCard/s);
});

test("customer menu search is Turkish-case and diacritic insensitive", () => {
  for (const query of ["mercimek", "Mercimek", "MERCİMEK"]) {
    assert.equal(matchesCustomerMenuSearch(query, ["Mercimek Çorbası"], "tr-TR"), true);
  }
  for (const query of ["çorba", "Çorba", "CORBA"]) {
    assert.equal(matchesCustomerMenuSearch(query, ["Mercimek Çorbası"], "tr-TR"), true);
  }
  assert.equal(matchesCustomerMenuSearch("kofte", ["Izgara Köfte"], "tr-TR"), true);
  assert.equal(matchesCustomerMenuSearch("köfte", ["Izgara Kofte"], "tr-TR"), true);
  assert.equal(normalizeCustomerMenuSearch("Iİıi ŞĞÜÖÇ", "tr-TR"), "iiii sguoc");
});

test("customer search only matches the explicitly supplied visible fields", () => {
  assert.equal(
    matchesCustomerMenuSearch("çorba", ["Mercimek Çorbası", "Tereyağlı ev çorbası", "Çorbalar"]),
    true,
  );
  assert.equal(
    matchesCustomerMenuSearch("internal-product-uuid", ["Mercimek Çorbası", "Tereyağlı", "Çorbalar"]),
    false,
  );
});

test("customer call states map to translated copy keys without raw enums", () => {
  assert.equal(customerCallStatusTranslationKey("WAITER_CALL", "OPEN"), "waiterRequestSent");
  assert.equal(customerCallStatusTranslationKey("BILL_REQUEST", "OPEN"), "billSent");
  assert.equal(customerCallStatusTranslationKey("WAITER_CALL", "ACKNOWLEDGED"), "waiterConfirmed");
  assert.equal(customerCallStatusTranslationKey("BILL_REQUEST", "ACKNOWLEDGED"), "waiterConfirmed");
});

/**
 * The guest reads a menu, not a product catalogue: the search field and the
 * horizontal category filter were removed on purpose, and the content is laid
 * out chapter by chapter the way a printed menu is. These hold that shape.
 */
test("each category is its own titled chapter with a semantic heading", () => {
  // A heading, not a styled div: the section is navigable by screen reader and
  // anchored by a stable id.
  assert.match(customerMenuUi, /<h2 id={`menu-category-\$\{category\.id\}`}/);
  assert.match(customerMenuUi, /aria-labelledby={`menu-category-\$\{category\.id\}`}/);
  // A visible rule under the heading is what separates one chapter from the next.
  assert.match(customerMenuUi, /border-b border-gold\/30/);
});

test("the menu never names a category in code", () => {
  // Order and membership come from the API. A category spelled into the render
  // path would silently outrank whatever the restaurant actually configured.
  for (const category of ["Çorbalar", "Izgaralar", "Ana Yemekler", "Tatlılar", "İçecekler", "Kebaplar"]) {
    assert.ok(
      !customerMenuUi.includes(`"${category}"`),
      `${category} is hardcoded into the menu render path`,
    );
  }
  // Scoped to the category grouping. The screen does sort elsewhere — the
  // guest's own orders are listed newest first — and a file-wide ban on
  // `.sort(` would have banned that too while proving nothing about
  // categories. What must hold is that this grouping walks `menuCategories`
  // in the order the API supplied.
  const grouping = customerMenuUi.slice(
    customerMenuUi.indexOf("const groupedProducts = useMemo"),
    customerMenuUi.indexOf("const featuredProducts = useMemo"),
  );
  assert.ok(grouping.length > 0, "the category grouping moved");
  assert.match(grouping, /menuCategories\s*\.map\(/);
  assert.doesNotMatch(grouping, /\.sort\(/, "the menu re-orders the categories the API sent");
});

test("the search field stays gone in every form", () => {
  for (const remnant of ["Menüde ara", "searchPlaceholder", "setSearch", "hasSearch", "clearSearch"]) {
    assert.ok(!customerMenuUi.includes(remnant), `the removed search surface is back: ${remnant}`);
  }
});

/**
 * Perceived speed, held as structure rather than as class strings.
 *
 * The menu is one long scroll now, so the two things that would make it feel
 * slow are content that waits on JavaScript before it is visible, and
 * scroll-linked work per dish.
 */
test("menu content is visible before any motion runs", () => {
  const globals = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");
  // The reveal is additive: cards paint at full opacity and the animation only
  // adds a settle once observed. Nothing is hidden waiting for an observer.
  assert.match(globals, /html\[data-motion-ready="true"\] \.motion-reveal\[data-reveal-animate="true"\]\[data-revealed="true"\]/);
  assert.match(globals, /@media \(prefers-reduced-motion: reduce\)/);
});

test("the menu does not spend an observer per dish", () => {
  const reveal = readFileSync(new URL("../../lib/motion/use-reveal-once.ts", import.meta.url), "utf8");
  // One shared observer, created once, for every card on the page.
  assert.equal((reveal.match(/new IntersectionObserver/g) ?? []).length, 1);
  assert.match(reveal, /sharedObserver \?\?= new IntersectionObserver/);
  assert.match(reveal, /prefers-reduced-motion: reduce/, "the reduced-motion path was dropped");
});
