"use client";

import { MenuOverview } from "@/components/admin/menu-manager";

/**
 * The menu routes render their editor straight into the workspace.
 *
 * No page heading above it: the shell's own bar already names where you are,
 * and a second title would push the customer menu — the thing being edited —
 * down the screen for no information at all.
 */
export function MenuOverviewModule() {
  return <MenuOverview />;
}
