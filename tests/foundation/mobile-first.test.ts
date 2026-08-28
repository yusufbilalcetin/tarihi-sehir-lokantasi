import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * The decisions that make this a phone application rather than a desktop one.
 *
 * These are source guards, not pixel snapshots: what they hold is the shape of
 * the code that produces the screen, so a restyle passes and a regression to
 * desktop-first fails. Every one of them was measured in a real browser at
 * 390x844 before it was written down here.
 */

function read(relativePath: string): string {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");
}

const menuExperience = read("components/menu/menu-experience.tsx");
const guestOrder = read("components/guest/guest-order-experience.tsx");
const categoryJump = read("components/menu/category-jump.tsx");
const cartBar = read("components/menu/cart-bar.tsx");
const productCard = read("components/menu/product-card.tsx");
const bottomNavigation = read("components/menu/bottom-navigation.tsx");
const productDetail = read("components/menu/product-detail-sheet.tsx");
const highlightCard = read("components/menu/highlight-card.tsx");
const restaurantHeader = read("components/menu/restaurant-header.tsx");
/** The one body both the guest menu and the admin editor render. */
const menuSectionsSource = read("components/menu/menu-sections.tsx");
const languageSelector = read("components/menu/language-selector.tsx");
const globalsCss = read("app/globals.css");

/* ------------------------------------------------ customer discovery ----- */

test("the customer menu still refuses a search box and a permanent chip rail", () => {
  // Two settled product decisions. A search box asks a guest to name a dish
  // they have not read yet; a chip rail spends a strip of every screen on
  // navigation the guest needs twice a meal.
  for (const [name, source] of [["QR menu", menuExperience], ["public ordering", guestOrder]] as const) {
    assert.equal(source.includes("CategoryChips"), false, `${name} brought the chip rail back`);
    assert.equal(source.includes('t("searchLabel")'), false, `${name} brought the search box back`);
  }
});

test("a long menu can be navigated by category without hiding any dish", () => {
  // The replacement for both: one button, a sheet, and a jump. Nothing is
  // filtered out of the page — every category section still renders in order.
  assert.match(categoryJump, /MenuPrimitive\.Positioner/, "the category list is not anchored to its trigger");
  assert.match(categoryJump, /getElementById\(`menu-category-\$\{categoryId\}`\)/);
  for (const [name, source] of [["QR menu", menuExperience], ["public ordering", guestOrder]] as const) {
    assert.match(source, /<CategoryJump/, `${name} has no category jump control`);
    // The sections themselves are untouched by the control.
    assert.match(
      menuSectionsSource,
      /id=\{`menu-category-\$\{category\.id\}`\}/,
      "the shared menu body lost its category anchors",
    );
  }
});

test("the two sticky bars are one stack that states its own height", () => {
  // The header parks at the top and the category bar parks under it. The
  // header's height is a token both of them read, so the offset cannot drift
  // out of step with the bar it is offsetting from.
  assert.match(restaurantHeader, /sticky top-0 z-\[var\(--z-appbar\)\]/);
  assert.match(restaurantHeader, /h-\[var\(--menu-header-height\)\]/);
  assert.match(categoryJump, /top-\[calc\(env\(safe-area-inset-top\)\+var\(--menu-header-height\)\)\]/);
  assert.match(categoryJump, /h-\[var\(--menu-category-height\)\]/);
  assert.match(categoryJump, /stickyTopClass,/);
  assert.match(globalsCss, /--menu-header-height:/);
  assert.match(globalsCss, /--menu-category-height:/);
  // Header above the category bar, both below any sheet, all from the tokens.
  assert.match(categoryJump, /z-\[var\(--z-sticky\)\]/);
});

test("the header stays put instead of handing over to a second copy of itself", () => {
  // It used to scroll away and fade in a separate fixed strip, so mid-scroll
  // there were two headers on screen and an observer deciding between them.
  assert.doesNotMatch(restaurantHeader, /IntersectionObserver/, "the condensed-header observer came back");
  assert.doesNotMatch(restaurantHeader, /fixed inset-x-0 top-0/, "a second fixed header came back");
  assert.equal((restaurantHeader.match(/<header/g) ?? []).length, 1);
});

test("a jumped-to heading clears the sticky chrome by a measured gap", () => {
  // No hardcoded pixel offset: the sticky top is read back from the computed
  // style, so the safe-area inset and the header token are both accounted for
  // on a notched phone and on a laptop without one.
  assert.match(categoryJump, /getComputedStyle\(bar\)\.top/);
  assert.match(categoryJump, /return stickyTop \+ bar\.getBoundingClientRect\(\)\.height;/);
  assert.match(categoryJump, /- chromeBottom\(\) - HEADING_BREATHING_ROOM/);
  const room = Number(/const HEADING_BREATHING_ROOM = (\d+);/.exec(categoryJump)![1]);
  assert.ok(room >= 12 && room <= 16, `breathing room ${room}px is outside the 12-16px the design asks for`);
  // The callers say where the bar parks; nobody passes a magic number any more.
  assert.doesNotMatch(categoryJump, /scrollOffset/, "the hardcoded scroll offset came back");
  assert.doesNotMatch(guestOrder, /scrollOffset/, "the hardcoded scroll offset came back");
});

test("the jump does not animate for someone who asked motion to stop", () => {
  assert.match(categoryJump, /prefers-reduced-motion: reduce/);
  assert.match(categoryJump, /behavior: reduced \|\| far \? "auto" : "smooth"/);
  // A jump of several thousand pixels is a journey, not a transition.
  assert.match(categoryJump, /const SMOOTH_SCROLL_LIMIT_PX = \d+;/);
});

/* ------------------------------------------------ customer cart ---------- */

test("the cart bar exists only while there is something in the cart", () => {
  // An empty bar is a permanent strip of furniture over the dishes, which is
  // the opposite of what it is for.
  assert.match(cartBar, /if \(count < 1\) return null;/);
  assert.match(menuExperience, /activeTab === "menu" \? \(\s*<CartBar/);
});

test("the bottom of the customer screen is one object, not two arguing", () => {
  // The cart row renders inside the tab bar's own surface. Two independently
  // positioned bars read as two things fighting over the bottom of a phone.
  assert.doesNotMatch(cartBar, /className="[^"]*fixed/, "the cart bar positions itself again");
  assert.match(bottomNavigation, /cartSlot/, "the tab bar does not host the cart row");
  assert.match(bottomNavigation, /fixed inset-x-0 bottom-0/);
  // ...and the category control stays at the top, so there is no third layer.
  assert.match(categoryJump, /"sticky z-\[var\(--z-sticky\)\]/);
  assert.match(categoryJump, /stickyTopClass,/);
  assert.doesNotMatch(categoryJump, /fixed[^"]*bottom-/, "the category control drifted to the bottom stack");
});

test("fixed bottom chrome clears the home indicator", () => {
  // One inset for the whole stack, applied by the surface that owns it.
  assert.match(bottomNavigation, /pb-\[env\(safe-area-inset-bottom\)\]/);
  assert.match(productDetail, /env\(safe-area-inset-bottom\)/, "the dish sheet's button ends under the home indicator");
});

test("the page reserves at least the height of the bottom stack", () => {
  // Measured constants, so this fails if a row grows without the padding
  // following it: 64px of tab bar, and 64px more when the cart row is there
  // (a 56px bar plus its 8px of top padding).
  const tabBar = Number(/TAB_BAR_HEIGHT_PX = (\d+)/.exec(bottomNavigation)![1]);
  const cart = Number(/CART_BAR_HEIGHT_PX = (\d+)/.exec(cartBar)![1]);
  const reserved = /cartCount > 0 \? "pb-\[([\d.]+)rem\]" : "pb-24"/.exec(menuExperience);
  assert.ok(reserved, "the menu no longer switches its bottom padding on the cart");
  assert.ok(
    Number(reserved![1]) * 16 >= tabBar + cart,
    `reserved ${Number(reserved![1]) * 16}px is under the ${tabBar + cart}px the bottom stack takes`,
  );
});

test("the cart CTA names the cart, not an order nobody has sent", () => {
  // "Siparişim" on an unsent basket reads as "the kitchen already has this".
  assert.match(cartBar, /\{t\("cart"\)\}/);
  assert.doesNotMatch(cartBar, /t\("order"\)/);
});

/* ------------------------------------------------ dish detail ------------ */

test("a dish opens from the edge the thumb is at, not the middle of the screen", () => {
  assert.match(productDetail, /<SheetContent\s+side="bottom"/);
  assert.match(productDetail, /max-h-\[90dvh\]/);
  assert.match(productDetail, /rounded-t-2xl/);
  assert.doesNotMatch(productDetail, /DialogContent/, "the dish went back to a centered dialog");
});

test("the button that spends money never scrolls away", () => {
  const footer = productDetail.slice(productDetail.indexOf('className="sticky bottom-0'));
  assert.ok(footer.length > 0, "the dish sheet's action row is no longer sticky");
  assert.match(footer, /t\("addToCart"\)/);
  assert.match(footer, /formatPrice\(product\.price \* quantity\)/, "the button does not say what it costs");
});

/* ------------------------------------------------ discovery -------------- */

test("a recommendation is a few suggestions, not the menu a second time", () => {
  // The rails used to render full product cards, so the top of the menu was a
  // duplicate of dishes appearing again under their own category. The cap now
  // lives with the derivation both the guest menu and the admin preview read,
  // so neither can quietly draw a fourth.
  const sections = read("lib/adapters/customer-menu-sections.ts");
  assert.match(sections, /export const MENU_HIGHLIGHT_LIMIT = 3;/);
  assert.equal((sections.match(/slice\(0, MENU_HIGHLIGHT_LIMIT\)/g) ?? []).length, 2);
  assert.match(menuExperience, /buildCustomerMenuSections\(menuCategories, publicProducts\)/);
  assert.doesNotMatch(menuExperience, /const MENU_HIGHLIGHT_LIMIT/, "the cap was copied back");
  assert.match(menuSectionsSource, /<HighlightCard/);
  assert.doesNotMatch(highlightCard, /<Button/, "the suggestion grew a second add control");
});

/* ------------------------------------------------ header ----------------- */

test("the guest is never shown a placeholder where their table should be", () => {
  assert.match(menuExperience, /Number\.isSafeInteger\(number\) && number > 0/);
  assert.match(restaurantHeader, /tableName: string \| null/);
  assert.match(restaurantHeader, /\{tableName \? \(/);
});

test("the restaurant's own name is not spent on utility controls", () => {
  // Measured at 390: the globe and the two chevrons were costing the name the
  // last twenty pixels and pushing it into an ellipsis.
  assert.match(languageSelector, /hidden size-3\.5 text-copper sm:block/);
  assert.match(languageSelector, /<ChevronDown className="hidden size-3\.5 opacity-70 sm:block"/);
  assert.match(restaurantHeader, /size-9 shrink-0 sm:size-10/);
});

/* ------------------------------------------------ customer product ------- */

test("a dish is a row on a menu, not a card in a dashboard", () => {
  // Sixty-one bordered boxes with drop shadows is what made this read as an
  // admin screen. The row separates by its own warm surface and nothing else.
  assert.doesNotMatch(productCard, /className="[^"]*border[^"]*"[^>]*>\s*$/m);
  assert.doesNotMatch(productCard, /shadow-\[var\(--shadow-raised\)\]/, "the row got its drop shadow back");
  assert.match(productCard, /rounded-xl bg-card p-3/);
  // A square plate at phone size, and the image request agrees with it.
  assert.match(productCard, /size-23 shrink-0 overflow-hidden rounded-lg/);
  assert.match(productCard, /sizes="\(max-width: 640px\) 92px, 112px"/, "the image request disagrees with the frame");
  // A recipe paragraph in the feed is what made the menu twelve thousand pixels long.
  assert.match(productCard, /line-clamp-2/, "the feed description lost its two-line clamp");
});

test("the dish name leads, and the badges do not outrank it", () => {
  // The badges used to be filled pills sitting above the name, so the first
  // thing the eye met on every row was the word "Popüler".
  const nameAt = productCard.indexOf("font-heading");
  const badgeAt = productCard.indexOf("badges.map");
  assert.ok(nameAt !== -1 && badgeAt > nameAt, "the badges are above the dish name again");
  assert.match(productCard, /const badges = product\.tags\.slice\(0, 2\);/, "more than two badges reach a row");
  assert.doesNotMatch(productCard, /bg-copper\/10/, "the badges are filled pills again");
});

test("the dish sheet states facts as lines, not as little tiles", () => {
  assert.match(productDetail, /<dl className="mt-4 border-y/);
  assert.doesNotMatch(productDetail, /rounded-lg bg-muted\/35 p-3/, "the portion and allergen tiles came back");
});

test("the add control is a thumb target and the only filled thing on the card", () => {
  assert.match(productCard, /size-11/, "the add control is under 44px");
  // Exactly one Button on the card, and it is the add action.
  assert.equal((productCard.match(/<Button\b/g) ?? []).length, 1);
  assert.match(productCard, /aria-label=\{`\$\{name\}: \$\{t\("addToCart"\)\}`\}/);
});

/* ------------------------------------------------ operations ------------- */

test("the waiter's floor is one column on a phone", () => {
  // Two columns at 390px truncated the table name to "M…", which is the one
  // thing the card exists to say.
  const grid = read("components/staff/table-grid.tsx");
  assert.match(grid, /grid grid-cols-1 gap-3 sm:grid-cols-2/);
  assert.doesNotMatch(grid, /"grid grid-cols-2/, "the floor went back to two columns on a phone");
});

test("the kitchen board does not force its lanes side by side on a phone", () => {
  const board = read("components/kitchen/kitchen-board.tsx");
  assert.match(board, /className="grid gap-3[^"]*lg:grid-cols-3/);
  assert.doesNotMatch(board, /(sm|md):grid-cols-3/, "three lanes before lg is a side-scrolling board");
});

test("no operational shell keeps a sidebar open on a phone", () => {
  const adminShell = read("components/admin/admin-shell.tsx");
  assert.match(adminShell, /hidden w-\[264px\][^"]*lg:block|hidden[^"]*lg:block/);
  assert.match(adminShell, /aria-label="Yönetim menüsünü aç"/, "there is no way into the menu on a phone");
});

test("the till stacks instead of squeezing a split pane onto a phone", () => {
  const cashier = read("components/cashier/cashier-dashboard.tsx");
  // The two-pane layout is gated at lg; below it the bill list and the payment
  // panel are one column each.
  assert.match(cashier, /lg:grid-cols-\[minmax\(18rem,0\.8fr\)_minmax\(0,1\.5fr\)\]/);
  assert.doesNotMatch(cashier, /(sm|md):grid-cols-\[minmax\(18rem/);
});

/* ------------------------------------------------ category navigation ---- */

test("the category control reads as navigation, not as a form field", () => {
  // It was a rounded pill with a chevron — the shape of something you fill in.
  // Full bleed, one rule underneath, and no bordered capsule around it.
  const trigger = categoryJump.slice(categoryJump.indexOf("<SheetTrigger"), categoryJump.indexOf("</SheetTrigger>"));
  assert.doesNotMatch(trigger, /rounded-full|rounded-xl/, "the trigger is a capsule again");
  assert.doesNotMatch(trigger, /border/, "the trigger drew itself an input border");
  assert.doesNotMatch(trigger, /shadow/, "the trigger floats above the page again");
  assert.match(categoryJump, /border-b border-border\/50 bg-surface/);
});

test("the sticky bar says which category the guest is reading", () => {
  // A bar that shows the same word from soup to dessert is a bar that stopped
  // earning its height.
  assert.match(categoryJump, /const \[activeId, setActiveId\] = useState/);
  assert.match(categoryJump, /const activeName = getMenuCategoryName\(active\.category, language\)/);
  assert.match(categoryJump, /key=\{active\.category\.id\} className="motion-action-label/);
  // The screen reader hears the control and its current answer as one name.
  assert.match(categoryJump, /aria-label=\{`\$\{t\("categories"\)\}: \$\{activeName\}`\}/);
  // aria-haspopup/expanded/controls come from the primitive at runtime — all
  // three were read back from the rendered trigger at 390/430/834/1440 — so
  // what the source has to keep is the primitive that supplies them.
  assert.match(categoryJump, /<MenuPrimitive\.Trigger/, "the trigger stopped being a menu trigger");
  assert.match(categoryJump, /from "@base-ui\/react\/menu"/, "the accessible primitive was swapped out");
});

test("the scrollspy watches a handful of sections, never a scroll event", () => {
  // One observer over the category sections. Sixty-one per-dish observers, or a
  // setState on raw scroll, is how a menu starts dropping frames.
  assert.match(categoryJump, /new IntersectionObserver\(pickActive/);
  assert.match(categoryJump, /querySelector\(`\[aria-labelledby="menu-category-\$\{id\}"\]`\)/);
  assert.doesNotMatch(categoryJump, /addEventListener\("scroll"/, "a scroll listener came back");
  assert.doesNotMatch(categoryJump, /onScroll/, "a scroll handler came back");
  // Written only when the answer changes, so a long category costs no renders.
  assert.match(categoryJump, /setActiveId\(\(previous\) => \(previous === current \? previous : current \?\? null\)\)/);
  // The heading parks below the chrome, and that gap counts as reached.
  assert.match(categoryJump, /chromeBottom\(\) \+ HEADING_BREATHING_ROOM/);
});

test("the category list is anchored to the control, not thrown up from the edge", () => {
  // A full sheet is the right weight for a dish and far too much for picking a
  // section: it covered the menu, dimmed it, and arrived from an edge that had
  // nothing to do with the control that opened it.
  assert.doesNotMatch(categoryJump, /SheetContent/, "the category picker went back to a bottom sheet");
  assert.match(categoryJump, /anchor=\{anchorRef\}/, "the panel is not anchored to the current category");
  assert.match(categoryJump, /side="bottom"\s+align="end"/);
  assert.match(categoryJump, /sideOffset=\{6\}/);
  // The positioner derives the origin from side + align, so it grows out of the
  // words it belongs to rather than appearing in the middle of the screen.
  assert.match(categoryJump, /origin-\(--transform-origin\)/);
  // A small navigation act must not dim the menu behind it.
  assert.match(categoryJump, /modal=\{false\}/);
  assert.doesNotMatch(categoryJump, /Backdrop/, "the category picker grew a backdrop");
  assert.match(categoryJump, /aria-current=\{current \? "true" : undefined\}/);
  assert.match(categoryJump, /<Check/, "the current category is no longer marked");
  assert.doesNotMatch(categoryJump, /bg-burgundy[^"]*rounded-full/, "the current row became a filled pill");
});

/* ------------------------------------------------ motion system ---------- */

test("nothing invents its own timing or easing", () => {
  // Every duration and curve on these surfaces comes from the tokens.
  for (const [name, source] of [
    ["category nav", categoryJump],
    ["cart bar", cartBar],
    ["product row", productCard],
    ["dish sheet", productDetail],
  ] as const) {
    assert.doesNotMatch(source, /transition-all/, `${name} uses transition-all`);
    assert.doesNotMatch(source, /duration-\[\d+ms\]/, `${name} hardcodes a duration`);
    assert.doesNotMatch(source, /cubic-bezier/, `${name} hardcodes an easing curve`);
  }
  assert.match(globalsCss, /--motion-instant: \d+ms;/);
  assert.match(globalsCss, /--ease-out: cubic-bezier/);
});

test("the press language is shared, not re-invented per component", () => {
  for (const [name, source] of [
    ["category nav", categoryJump],
    ["cart bar", cartBar],
    ["product row", productCard],
  ] as const) {
    assert.match(source, /motion-press|motion-card-hover/, `${name} has no press feedback`);
  }
  // Felt more than seen: a compression, not a cartoon.
  const pressScale = Number(/--press-scale: ([\d.]+);/.exec(globalsCss)![1]);
  assert.ok(pressScale >= 0.97, `a press scale of ${pressScale} is exaggerated`);
});

test("no animation dependency was added to reach any of this", () => {
  const pkg = JSON.parse(read("package.json")) as { dependencies: Record<string, string> };
  for (const banned of ["framer-motion", "motion", "gsap", "react-spring", "@react-spring/web", "animejs"]) {
    assert.equal(banned in pkg.dependencies, false, `${banned} was added`);
  }
});
