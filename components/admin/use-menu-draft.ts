"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { useAdminMenu, type AdminMenuState } from "@/components/admin/use-admin-menu";
import { useIsDesktop } from "@/components/shared/use-is-desktop";
import { MENU_HIGHLIGHT_LIMIT } from "@/lib/adapters/customer-menu-sections";
import { adminApi } from "@/lib/api/endpoints";
import type {
  AdminCategoryResult,
  AdminProductResult,
} from "@/lib/services/admin-menu-service";
import type { CatalogTranslations } from "@/lib/i18n/catalog-localization";

/**
 * The administrator's working copy of the menu.
 *
 * Edits are held as a sparse overlay on top of the rows the server keeps
 * sending, not as a snapshot of them: the admin list polls while somebody
 * works, and an overlay merges with whatever arrives instead of being
 * clobbered by it or having to freeze the screen to stay safe.
 *
 * Nothing here reaches a guest until {@link MenuDraft.save} runs, which is the
 * whole point — ten edits, one approval, one transaction for the running order.
 */

export type CategoryDraft = {
  name?: string;
  description?: string | null;
  translations?: CatalogTranslations;
  isActive?: boolean;
  sortOrder?: number;
};

export type ProductDraft = {
  name?: string;
  description?: string | null;
  translations?: CatalogTranslations;
  price?: string;
  categoryId?: string;
  weightLabel?: string | null;
  isActive?: boolean;
  isAvailable?: boolean;
  isFeatured?: boolean;
  tags?: readonly string[];
  allergens?: readonly string[];
  sortOrder?: number;
};

/** Server rows with the staged edits laid over them, in menu order. */
export function orderProducts(
  serverProducts: readonly AdminProductResult[],
  drafts: Readonly<Record<string, ProductDraft>>,
): AdminProductResult[] {
  return serverProducts
    .map((product) => ({ ...product, ...drafts[product.id] }))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "tr"));
}

/**
 * One step of a product's move, as a pure function of the drafts it starts
 * from — never of the rendered list. Two taps in a row have to compose, and
 * the render between them has not happened yet, so the second step must read
 * the first step's drafts rather than the order still on screen.
 */
export function reorderProductDrafts(
  serverProducts: readonly AdminProductResult[],
  drafts: Readonly<Record<string, ProductDraft>>,
  productId: string,
  direction: -1 | 1,
): Record<string, ProductDraft> {
  const ordered = orderProducts(serverProducts, drafts);
  const product = ordered.find((item) => item.id === productId);
  if (!product) return drafts;
  // Only within its own category: that is the only place the order means
  // anything, because the guest's menu groups first and sorts second.
  const siblings = ordered.filter((item) => item.categoryId === product.categoryId);
  const index = siblings.findIndex((item) => item.id === productId);
  const target = index + direction;
  if (index === -1 || target < 0 || target >= siblings.length) return drafts;
  const ids = siblings.map((item) => item.id);
  [ids[index], ids[target]] = [ids[target], ids[index]];
  // Renumbering the whole category, not swapping two values: a menu seeded
  // with a column full of zeroes has nothing to swap.
  const next = { ...drafts };
  ids.forEach((id, position) => {
    next[id] = { ...next[id], sortOrder: position + 1 };
  });
  return next;
}

export interface MenuDraft {
  readonly menu: AdminMenuState;
  readonly categories: readonly AdminCategoryResult[];
  readonly products: readonly AdminProductResult[];
  readonly dirty: boolean;
  readonly editedCategoryIds: ReadonlySet<string>;
  readonly editedProductIds: ReadonlySet<string>;
  readonly featuredCount: number;
  readonly stageCategory: (categoryId: string, change: CategoryDraft) => void;
  readonly stageProduct: (productId: string, change: ProductDraft) => void;
  readonly moveCategory: (categoryId: string, direction: -1 | 1) => void;
  readonly moveProduct: (productId: string, direction: -1 | 1) => void;
  readonly discard: () => void;
  readonly save: () => Promise<boolean>;
}

export function useMenuDraft(): MenuDraft {
  const menu = useAdminMenu();
  const [categoryDrafts, setCategoryDrafts] = useState<Record<string, CategoryDraft>>({});
  const [productDrafts, setProductDrafts] = useState<Record<string, ProductDraft>>({});
  const [categoryOrder, setCategoryOrder] = useState<readonly string[] | null>(null);

  const serverCategories = useMemo(
    () => menu.categories.filter((category) => !category.archived),
    [menu.categories],
  );
  const serverProducts = useMemo(
    () => menu.products.filter((product) => !product.archived),
    [menu.products],
  );

  const categories = useMemo<AdminCategoryResult[]>(() => {
    const merged = serverCategories.map((category) => ({
      ...category,
      ...categoryDrafts[category.id],
    }));
    const ordered = categoryOrder
      ? [...merged].sort((a, b) => {
          const left = categoryOrder.indexOf(a.id);
          const right = categoryOrder.indexOf(b.id);
          return (
            (left === -1 ? Number.MAX_SAFE_INTEGER : left) -
            (right === -1 ? Number.MAX_SAFE_INTEGER : right)
          );
        })
      : [...merged].sort(
          (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "tr"),
        );
    // Renumbering here is what makes the canvas honest: this is the order the
    // save will write.
    return ordered.map((category, index) => ({ ...category, sortOrder: index + 1 }));
  }, [categoryDrafts, categoryOrder, serverCategories]);

  const products = useMemo<AdminProductResult[]>(
    () => orderProducts(serverProducts, productDrafts),
    [productDrafts, serverProducts],
  );

  const editedCategoryIds = useMemo(() => new Set(Object.keys(categoryDrafts)), [categoryDrafts]);
  const editedProductIds = useMemo(() => new Set(Object.keys(productDrafts)), [productDrafts]);
  const dirty = editedCategoryIds.size > 0 || editedProductIds.size > 0 || categoryOrder !== null;

  const visibleCategoryIds = useMemo(
    () => new Set(categories.filter((category) => category.isActive).map((item) => item.id)),
    [categories],
  );
  const featuredCount = products.filter(
    (product) =>
      product.isFeatured && product.isActive && visibleCategoryIds.has(product.categoryId),
  ).length;

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const stageCategory = useCallback((categoryId: string, change: CategoryDraft) => {
    setCategoryDrafts((current) => ({
      ...current,
      [categoryId]: { ...current[categoryId], ...change },
    }));
  }, []);

  const stageProduct = useCallback((productId: string, change: ProductDraft) => {
    setProductDrafts((current) => ({
      ...current,
      [productId]: { ...current[productId], ...change },
    }));
  }, []);

  const moveCategory = useCallback(
    (categoryId: string, direction: -1 | 1) => {
      const fallback = categories.map((category) => category.id);
      // Composed from the previous order rather than from the rendered list, so
      // two taps in a row move a category two places: the render between them
      // has not happened yet.
      setCategoryOrder((current) => {
        const ids = current ? [...current] : fallback;
        const index = ids.indexOf(categoryId);
        const target = index + direction;
        if (index === -1 || target < 0 || target >= ids.length) return current;
        [ids[index], ids[target]] = [ids[target], ids[index]];
        return ids;
      });
    },
    [categories],
  );

  const moveProduct = useCallback(
    (productId: string, direction: -1 | 1) => {
      // Composed from the previous drafts rather than the rendered list, so two
      // taps in a row move a product two places: the render between them has
      // not happened yet.
      setProductDrafts((current) =>
        reorderProductDrafts(serverProducts, current, productId, direction),
      );
    },
    [serverProducts],
  );

  const discard = useCallback(() => {
    setCategoryDrafts({});
    setProductDrafts({});
    setCategoryOrder(null);
  }, []);

  const save = useCallback(async () => {
    if (!dirty) return false;
    const orderedCategoryIds = categoryOrder ? categories.map((item) => item.id) : null;
    const productOrder = Object.entries(productDrafts)
      .filter(([, change]) => change.sortOrder !== undefined)
      .map(([id, change]) => ({ id, sortOrder: change.sortOrder! }));

    const result = await menu.run(async () => {
      for (const [categoryId, change] of Object.entries(categoryDrafts)) {
        const { sortOrder: _order, ...fields } = change;
        if (Object.keys(fields).length > 0) {
          await adminApi.updateCategory(categoryId, {
            ...fields,
            translations: fields.translations
              ? Object.entries(fields.translations).map(([locale, value]) => ({ locale, ...value }))
              : undefined,
          });
        }
      }
      for (const [productId, change] of Object.entries(productDrafts)) {
        const { sortOrder: _order, ...fields } = change;
        if (Object.keys(fields).length > 0) {
          await adminApi.updateProduct(productId, {
            ...fields,
            tags: fields.tags ? [...fields.tags] : undefined,
            allergens: fields.allergens ? [...fields.allergens] : undefined,
            translations: fields.translations
              ? Object.entries(fields.translations).map(([locale, value]) => ({ locale, ...value }))
              : undefined,
          });
        }
      }
      // Both running orders in one transactional write, never a stream of
      // pairwise swaps that can stop halfway.
      if (orderedCategoryIds || productOrder.length > 0) {
        await adminApi.reorderMenu({
          categories: orderedCategoryIds?.map((id, index) => ({ id, sortOrder: index + 1 })),
          products: productOrder.length > 0 ? productOrder : undefined,
        });
      }
      return true;
    }, "Menü güncellendi.");

    // A failure keeps every edit on screen; `run` has already said what broke.
    if (result) discard();
    return Boolean(result);
  }, [categories, categoryDrafts, categoryOrder, discard, dirty, menu, productDrafts]);

  return {
    menu,
    categories,
    products,
    dirty,
    editedCategoryIds,
    editedProductIds,
    featuredCount,
    stageCategory,
    stageProduct,
    moveCategory,
    moveProduct,
    discard,
    save,
  };
}

export { MENU_HIGHLIGHT_LIMIT };

/** Re-exported so the editor keeps one import site for its panel shape. */
export { useIsDesktop };
