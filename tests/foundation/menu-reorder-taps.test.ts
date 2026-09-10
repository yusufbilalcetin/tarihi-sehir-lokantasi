import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  orderProducts,
  reorderProductDrafts,
  type ProductDraft,
} from "../../components/admin/use-menu-draft";
import type { AdminProductResult } from "../../lib/services/admin-menu-service";

/**
 * Reordering has to compose across taps.
 *
 * A move used to be computed from the memoised list the render handed the
 * callback, so two taps before React re-rendered both started from the same
 * order and produced the same single-step result — the dish travelled one
 * place instead of two. `moveCategory` already avoided this by composing
 * inside its state updater; these cases hold the product side to the same
 * rule.
 *
 * Two different things are held here, and only together. The behavioural
 * cases pin the extracted step: applied in sequence, taps compose. They
 * cannot on their own prove the hook feeds it the previous drafts, because
 * the step did not exist to be called in the broken version — so the last
 * case reads the wiring out of the source. That one is the load-bearing
 * guard against this exact regression returning.
 */

function product(
  id: string,
  name: string,
  sortOrder: number,
  categoryId = "c1",
): AdminProductResult {
  // Only the four fields the ordering actually reads; the rest of the record is
  // irrelevant to it and would only be noise to keep in step with the service.
  return { id, name, sortOrder, categoryId } as unknown as AdminProductResult;
}

const MENU: readonly AdminProductResult[] = [
  product("a", "Ala", 1),
  product("b", "Bul", 2),
  product("c", "Cig", 3),
  product("d", "Dol", 4),
  product("e", "Ezo", 1, "c2"),
];

function idsIn(drafts: Readonly<Record<string, ProductDraft>>, categoryId = "c1"): string {
  return orderProducts(MENU, drafts)
    .filter((item) => item.categoryId === categoryId)
    .map((item) => item.id)
    .join(",");
}

test("two taps before a render move a dish two places, not one", () => {
  const once = reorderProductDrafts(MENU, {}, "d", -1);
  assert.equal(idsIn(once), "a,b,d,c");

  // The second tap starts from the first tap's drafts, which is exactly what a
  // state updater is handed. Starting from `MENU` again is the regression.
  const twice = reorderProductDrafts(MENU, once, "d", -1);
  assert.equal(idsIn(twice), "a,d,b,c");

  const thrice = reorderProductDrafts(MENU, twice, "d", -1);
  assert.equal(idsIn(thrice), "d,a,b,c");
});

test("a move stays inside its own category and renumbers from one", () => {
  const moved = reorderProductDrafts(MENU, {}, "c", -1);
  assert.equal(idsIn(moved), "a,c,b,d");
  // The neighbouring category is untouched, and never renumbered by proxy.
  assert.equal(idsIn(moved, "c2"), "e");
  assert.equal(moved.e, undefined);
  assert.deepEqual(
    orderProducts(MENU, moved)
      .filter((item) => item.categoryId === "c1")
      .map((item) => item.sortOrder),
    [1, 2, 3, 4],
  );
});

test("a move off either end is refused and drafts nothing", () => {
  // The very same object back, not a copy of it: returning the state it was
  // handed is what lets React bail out of the render for a refused tap.
  const staged = reorderProductDrafts(MENU, {}, "d", -1);
  assert.notDeepEqual(staged, {}, "the fixture must carry real drafts");

  // Edges of the staged order (a, b, d, c), not of the server order.
  for (const [id, direction] of [
    ["a", -1],
    ["c", 1],
    ["missing", -1],
    // The only dish in its category cannot move in either direction.
    ["e", -1],
    ["e", 1],
  ] as const) {
    assert.strictEqual(
      reorderProductDrafts(MENU, staged, id, direction),
      staged,
      `${id} ${direction} should have been refused untouched`,
    );
  }
});

test("a menu seeded with one repeated sort value still reorders", () => {
  // The seed leaves the whole column at zero, so there is nothing to swap and
  // the order on screen comes from the name tie-break.
  const flat: readonly AdminProductResult[] = [
    product("a", "Ala", 0),
    product("b", "Bul", 0),
    product("c", "Cig", 0),
  ];
  const moved = reorderProductDrafts(flat, {}, "c", -1);
  assert.equal(
    orderProducts(flat, moved).map((item) => item.id).join(","),
    "a,c,b",
  );
});

test("the move is written through the state updater, not a render-time list", () => {
  const draft = readFileSync(
    new URL("../../components/admin/use-menu-draft.ts", import.meta.url),
    "utf8",
  );
  // Mirrors the guard already held over `setCategoryOrder`.
  assert.match(draft, /setProductDrafts\(\(current\) =>\s*\n?\s*reorderProductDrafts\(/);
  assert.doesNotMatch(
    draft,
    /const siblings = products\.filter/,
    "moveProduct is reading the rendered list again",
  );
});
