"use client";

import { CookingPot } from "lucide-react";

import { ModuleWindow } from "@/components/shared/module-window";
import { KitchenBoard } from "@/components/kitchen/kitchen-board";

/**
 * The kitchen display as an application window.
 *
 * `workspace` is the widest size the system offers, because the board is three
 * columns of tickets and a cook reads it from a step or two back — the room is
 * the point. Closing returns to the kitchen route itself: a cook has nowhere
 * else to be, so the window is the screen rather than a detour from one.
 */
export function KitchenModule() {
  return (
    <ModuleWindow
      title="Mutfak"
      description="Hazırlanmayı bekleyen, hazırlanan ve servise hazır siparişler."
      icon={CookingPot}
      size="workspace"
      closeHref="/kitchen"
    >
      <KitchenBoard inWindow />
    </ModuleWindow>
  );
}
