"use client";

import { CustomerMenuEditor } from "@/components/admin/customer-menu-editor";

/**
 * Kategoriler: the same canvas, with the category controls to hand.
 *
 * Ordering and visibility live in the menu's own category bar — the control a
 * guest uses to jump between sections is the control an administrator uses to
 * reorder them.
 */
export function CategoriesManager() {
  return <CustomerMenuEditor focus="categories" />;
}
