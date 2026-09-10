"use client";

import { CustomerMenuEditor } from "@/components/admin/customer-menu-editor";

/**
 * Menü Genel Bakış: the whole menu, editable.
 *
 * There is no separate dashboard here any more. A summary of the menu beside a
 * small picture of the menu was two views of one thing; this is the thing.
 */
export function MenuOverview() {
  return <CustomerMenuEditor focus="all" />;
}
