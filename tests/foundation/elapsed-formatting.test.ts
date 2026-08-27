import assert from "node:assert/strict";
import test from "node:test";

import { formatElapsed } from "@/lib/format";

/**
 * What this exists to prevent: the kitchen board printing "15899 dk" on a live
 * ticket. Every operational screen rendered `{elapsedMinutes} dk` directly, so
 * anything older than an hour became a number nobody converts while carrying
 * plates — and a ticket left open overnight showed a five-digit figure next to
 * the one that actually needed reading.
 */

test("minutes stay minutes while minutes are still readable", () => {
  assert.equal(formatElapsed(0), "0 dk");
  assert.equal(formatElapsed(1), "1 dk");
  assert.equal(formatElapsed(7), "7 dk");
  assert.equal(formatElapsed(59), "59 dk");
});

test("an hour becomes hours", () => {
  assert.equal(formatElapsed(60), "1 sa");
  assert.equal(formatElapsed(61), "1 sa 1 dk");
  assert.equal(formatElapsed(75), "1 sa 15 dk");
  assert.equal(formatElapsed(120), "2 sa");
  assert.equal(formatElapsed(1439), "23 sa 59 dk");
});

test("past a day the minutes are noise", () => {
  assert.equal(formatElapsed(1440), "1 gün");
  assert.equal(formatElapsed(1500), "1 gün 1 sa");
  // The two figures that were actually on the board when this was found.
  assert.equal(formatElapsed(15899), "11 gün");
  assert.equal(formatElapsed(22288), "15 gün 11 sa");
});

test("a nonsense duration reads as zero rather than as NaN on a ticket", () => {
  assert.equal(formatElapsed(-5), "0 dk");
  assert.equal(formatElapsed(Number.NaN), "0 dk");
  assert.equal(formatElapsed(Number.POSITIVE_INFINITY), "0 dk");
});

test("no operational screen prints a raw minute count any more", async () => {
  const { readFileSync } = await import("node:fs");
  const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

  for (const path of [
    "components/kitchen/kitchen-board.tsx",
    "components/cashier/cashier-dashboard.tsx",
    "components/staff/orders-list.tsx",
    "components/staff/table-grid.tsx",
    "components/staff/staff-attendance-card.tsx",
    "components/staff/waiter-calls-list.tsx",
    "components/admin/dashboard-view.tsx",
    "components/admin/orders-manager.tsx",
    "components/admin/erp-workspace-manager.tsx",
    "lib/adapters/staff-view-model.ts",
  ]) {
    assert.doesNotMatch(
      read(path),
      /\{\s*(?:order\.|selected\.|table\.)?(?:elapsedMinutes|activeMinutes)[^}]*\}\s*dk/,
      `${path} still prints a raw minute count`,
    );
    assert.doesNotMatch(
      read(path),
      /\$\{[^}\n]*(?:activeMinutes|elapsedMinutes|minutes\s*\/\s*60|minutes\s*%\s*60)[^}\n]*\}\s*(?:dk|dakika|sa|saat)/,
      `${path} still formats elapsed time independently`,
    );
  }
});
