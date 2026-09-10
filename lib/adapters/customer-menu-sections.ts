import type { MenuViewCategory } from "@/lib/adapters/menu-view-model";
import type { Product } from "@/types";

/**
 * What the guest's menu is made of, derived once.
 *
 * The category sections, the sticky category bar, its popover and the
 * scroll-spy all have to agree about which categories exist and in what order —
 * and now the administrator's preview has to agree with all four. Four
 * independent `filter` calls that happen to match today is how they stop
 * matching tomorrow, so the derivation lives here and everything reads it.
 *
 * Ordering is not decided here. It arrives already sorted from the database
 * (`categories.sort_order`, then `products.sort_order`), because the order a
 * restaurant chooses is data, not a presentation detail.
 */

/** Three suggestions is a recommendation; ten is the menu a second time. */
export const MENU_HIGHLIGHT_LIMIT = 3;

export interface CustomerMenuSection {
  readonly category: MenuViewCategory;
  readonly products: readonly Product[];
}

export interface CustomerMenuSections {
  /** Categories with at least one visible dish, in the restaurant's order. */
  readonly sections: readonly CustomerMenuSection[];
  /** The chef's picks, already capped at what the rail will draw. */
  readonly featured: readonly Product[];
  /** Earned from real sales, not chosen; also capped. */
  readonly popular: readonly Product[];
}

export function buildCustomerMenuSections(
  categories: readonly MenuViewCategory[],
  products: readonly Product[],
): CustomerMenuSections {
  const sections = categories
    .map((category) => ({
      category,
      products: products.filter((product) => product.categoryId === category.id),
    }))
    // A category with nothing in it is a heading the guest cannot act on.
    .filter((section) => section.products.length > 0);

  // Both rails draw from the visible sections rather than the raw product
  // list, so a dish inside a hidden category can never surface at the top of
  // the menu after being hidden further down it.
  const visible = sections.flatMap((section) => section.products);

  return {
    sections,
    featured: visible.filter((product) => product.featured).slice(0, MENU_HIGHLIGHT_LIMIT),
    popular: visible.filter((product) => product.popular).slice(0, MENU_HIGHLIGHT_LIMIT),
  };
}
