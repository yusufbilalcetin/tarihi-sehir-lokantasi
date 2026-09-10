import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(relativePath: string): string {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");
}

const productCard = read("components/menu/product-card.tsx");
const highlightCard = read("components/menu/highlight-card.tsx");
const menuSections = read("components/menu/menu-sections.tsx");
const cartItem = read("components/menu/cart-item.tsx");
const productDetail = read("components/menu/product-detail-sheet.tsx");
const categoryJump = read("components/menu/category-jump.tsx");
const loadingSkeleton = read("components/menu/menu-loading-skeleton.tsx");
const menuExperience = read("components/menu/menu-experience.tsx");

test("product rows stretch together and reserve matching content lanes", () => {
  // grid-cols-1 is load-bearing: without it the implicit auto track floors at the
  // card's min-content width (366px) and clips the add button at 360px.
  assert.match(menuSections, /grid grid-cols-1 items-stretch gap-2 md:grid-cols-2 md:gap-3/);
  assert.match(menuSections, /className="h-full">\{card\}/);
  assert.match(productCard, /relative flex h-full gap-3/);
  assert.match(productCard, /line-clamp-2 min-h-10 font-heading/);
  assert.match(productCard, /line-clamp-2 min-h-10 text-xs leading-5/);
  assert.match(productCard, /className="mt-auto pt-1\.5/);
  assert.match(productCard, /size-11 shrink-0 self-end/);
});

test("every product image and no-photo state owns the same fixed frame", () => {
  assert.match(productCard, /relative size-23 shrink-0 overflow-hidden/);
  assert.match(productCard, /fill\s+sizes="92px"/);
  assert.match(productCard, /motion-product-image object-cover/);
  assert.match(productCard, /flex h-full w-full items-center justify-center bg-sidebar/);
});

test("recommendation cards keep two title lines and one price baseline", () => {
  assert.match(highlightCard, /flex h-24 w-full items-stretch/);
  assert.match(highlightCard, /relative aspect-square h-full shrink-0/);
  assert.match(highlightCard, /line-clamp-2 min-h-10/);
  assert.match(highlightCard, /className="mt-auto text-sm font-extrabold/);
});

test("cart and detail quantity controls share one control height", () => {
  assert.match(cartItem, /line-clamp-2 min-h-10 font-heading/);
  assert.match(cartItem, /mt-auto flex flex-wrap items-center gap-2 pt-3/);
  assert.match(cartItem, /flex h-12 items-center rounded-xl border/);
  assert.equal((cartItem.match(/flex size-11 items-center justify-center/g) ?? []).length, 2);
  assert.match(productDetail, /flex h-12 shrink-0 items-center rounded-xl border/);
  assert.equal((productDetail.match(/flex size-11 items-center justify-center/g) ?? []).length >= 2, true);
  assert.match(productDetail, /motion-cta h-12 min-w-0 flex-1/);
});

test("category controls and the loading state preserve the live menu geometry", () => {
  assert.match(categoryJump, /h-\[var\(--menu-category-height\)\]/);
  assert.match(categoryJump, /actions \? "h-12 flex-1" : "h-12"/);
  assert.match(loadingSkeleton, /grid items-stretch gap-2 md:grid-cols-2 md:gap-3/);
  assert.match(loadingSkeleton, /flex h-full gap-3 rounded-xl bg-card p-3/);
  assert.match(loadingSkeleton, /size-23 shrink-0 rounded-lg/);
  assert.match(menuExperience, /<MenuLoadingSkeleton label=\{t\("loadingLanguage"\)\}/);
});

/**
 * Arithmetic on the real tokens, not a screenshot: no browser runs in this
 * suite, so the narrowest supported phone is verified by computing the width
 * each lane actually gets and proving the fixed parts still fit inside it.
 */
const globalsCss = read("app/globals.css");

function cssLength(value: string, viewportPx: number): number {
  const clamp = value.match(/clamp\(([^,]+),([^,]+),([^)]+)\)/);
  const toPx = (raw: string): number => {
    const text = raw.trim();
    const rem = text.match(/^([\d.]+)rem$/);
    if (rem) return Number(rem[1]) * 16;
    const vw = text.match(/^([\d.]+)vw$/);
    if (vw) return (Number(vw[1]) * viewportPx) / 100;
    const px = text.match(/^([\d.]+)px$/);
    if (px) return Number(px[1]);
    throw new Error(`unsupported length: ${text}`);
  };
  if (!clamp) return toPx(value);
  return Math.min(toPx(clamp[3]), Math.max(toPx(clamp[1]), toPx(clamp[2])));
}

function token(name: string, viewportPx: number): number {
  const declaration = globalsCss.match(new RegExp(`--${name}:\\s*([^;]+);`));
  assert.ok(declaration, `--${name} is not declared`);
  return cssLength(declaration[1].trim(), viewportPx);
}

test("the cart row still fits the narrowest supported phone at 320px", () => {
  const viewport = 320;
  const gutter = token("menu-gutter", viewport);
  const gridGap = token("menu-grid-gap", viewport);
  const cardPadding = token("menu-card-padding", viewport);
  assert.deepEqual([gutter, gridGap, cardPadding], [16, 12, 14], "token minimums moved");

  // .menu-shell is min(100% - 2*gutter, 64rem); the card adds its own padding
  // and a 1px border per side.
  const shell = viewport - 2 * gutter;
  const cardInner = shell - 2 * cardPadding - 2;

  // grid-cols-[4rem_minmax(0,1fr)] on phones.
  const imageColumn = 4 * 16;
  assert.match(cartItem, /grid-cols-\[4rem_minmax\(0,1fr\)\]/);
  assert.match(
    cartItem,
    /sizes="\(max-width: 639px\) 64px, 88px"/,
    "the cart image request disagrees with its 4rem/5.5rem frames",
  );
  const contentColumn = cardInner - imageColumn - gridGap;

  // The stepper is the one part that may not shrink: two 44px targets around a
  // 28px readout, inside a 1px border.
  const stepper = 44 + 28 + 44 + 2;
  assert.match(cartItem, /flex size-11 items-center justify-center/);
  assert.match(cartItem, /min-w-7 text-center/);
  assert.ok(
    stepper <= contentColumn,
    `the 44px stepper (${stepper}px) does not fit the ${contentColumn}px content column`,
  );

  // The line total is never abbreviated, so the row must be allowed to wrap
  // rather than push a four-figure price past the card edge.
  assert.match(cartItem, /mt-auto flex flex-wrap items-center gap-2 pt-3/);
  assert.match(cartItem, /className="ms-auto shrink-0 text-end text-sm tabular-nums/);
});

test("the product row's fixed columns leave a real text lane at 320px", () => {
  const viewport = 320;
  const shell = viewport - 2 * token("menu-gutter", viewport);
  // p-3 and gap-3 are literal in product-card.tsx; the plate and the add
  // control are the fixed columns either side of the text.
  const inner = shell - 2 * 12;
  const plate = 23 * 4;
  const addControl = 11 * 4;
  const textLane = inner - plate - 12 - addControl - 12;
  assert.ok(textLane > 80, `the dish name lane collapsed to ${textLane}px`);
  assert.match(productCard, /pointer-events-none relative flex min-w-0 flex-1 flex-col/);
});

/**
 * A dish sits under its category, in the markup as well as on the screen.
 *
 * Both the QR menu and the admin editor render `MenuSections`, which titles
 * every category with an `h2` and then maps `ProductCard` inside that section;
 * the takeaway page does the same by hand. `ProductCard` titled the dish with
 * an `h2` too, so every dish was a *sibling* of the category containing it and
 * the whole menu flattened into one run of names — a screen-reader user moving
 * by heading had no section boundary to move between.
 *
 * The two levels are asserted together, because the bug is the relationship
 * rather than either tag on its own: demoting the dish while a category is
 * still an `h3`, or promoting a category back to `h1`, would each re-break it.
 */
test("category headings outrank the dish headings inside them", () => {
  // Categories, the highlight rails and the admin-only empty-category rows are
  // all section-level headings.
  assert.match(menuSections, /<h2\b/);
  assert.equal(/<h3\b/.test(menuSections), false, "a category must not be demoted to h3");

  // The dish is one level below whatever section holds it.
  assert.match(productCard, /<h3\b/);
  assert.equal(/<h2\b/.test(productCard), false, "a dish must not be a sibling of its category");

  // The rails' cards carry no heading at all, so the rail's own h2 keeps its
  // section to itself — demoting anything here would create a gap, not close one.
  assert.equal(/<h[1-6]\b/.test(highlightCard), false);

  // Every surface that renders a card must supply the h2 above it, or the
  // demotion above turns into a skipped level.
  for (const [surface, source] of [
    ["menu sections", menuSections],
    ["takeaway ordering", read("components/guest/guest-order-experience.tsx")],
  ] as const) {
    assert.match(source, /<ProductCard/, `${surface} no longer renders a product card`);
    assert.match(source, /<h2\b/, `${surface} renders a dish with no category heading above it`);
  }
});
