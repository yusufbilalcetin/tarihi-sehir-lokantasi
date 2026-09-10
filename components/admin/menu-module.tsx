"use client";

import { MenuOverview } from "@/components/admin/menu-manager";

/**
 * The menu routes render their editor straight into the workspace.
 *
 * No *visible* page heading above it: the shell's own bar already names where
 * you are, and a title band would push the customer menu — the thing being
 * edited — down the screen for no information at all. That decision stands,
 * and the shared module-window surface is deliberately not mounted here, so
 * no window chrome comes back with it.
 *
 * The heading itself still has to exist. Without one this was the only admin
 * screen with no level-1 heading anywhere in its document: the page section
 * had nothing to be labelled by and the outline began at the customer menu's
 * category H2s. Above 768px, where the shell's bar is `md:hidden`, that left
 * the screen with no accessible name at all.
 *
 * So the same wiring that surface publishes — one `h1#admin-page-title` and
 * a section that quotes it — is stated here, with the heading visually
 * hidden rather than drawn. An invisible heading is the right shape when a
 * screen genuinely has no visible title, and it is the only way to keep both
 * the layout decision above and the page's name.
 */
export function MenuOverviewModule() {
  return (
    <section className="min-w-0" aria-labelledby="admin-page-title">
      <h1 id="admin-page-title" className="sr-only">
        Menü Yönetimi
      </h1>
      <MenuOverview />
    </section>
  );
}
