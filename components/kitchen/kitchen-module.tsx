"use client";

import { KitchenBoard } from "@/components/kitchen/kitchen-board";

/**
 * The kitchen display.
 *
 * A full operational screen, not a window. A cook reads this board from a step
 * or two back and there is nothing else on the display competing for the room,
 * so the board takes the viewport: `KitchenBoard` supplies its own page chrome
 * and full-height background when it is not asked to sit inside a dialog.
 */
export function KitchenModule() {
  return <KitchenBoard />;
}
