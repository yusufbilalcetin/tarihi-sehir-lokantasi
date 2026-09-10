"use client";

import { CustomerMenuEditor } from "@/components/admin/customer-menu-editor";

/**
 * Ürünler: the same canvas, with the dish controls to hand.
 *
 * A dish is edited where it is read — touch the card, change what is wrong.
 */
export function ProductsManager() {
  return <CustomerMenuEditor focus="products" />;
}
