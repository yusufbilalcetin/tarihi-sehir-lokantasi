"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Eye,
  EyeOff,
  FolderPlus,
  Pencil,
  Plus,
  Save,
  Undo2,
  UtensilsCrossed,
} from "lucide-react";
import { toast } from "sonner";

import {
  CategoryEditDialog,
  FeaturedEditDialog,
  ProductEditDialog,
} from "@/components/admin/menu-editor-dialogs";
import { useMenuDraft } from "@/components/admin/use-menu-draft";
import { CategoryJump } from "@/components/menu/category-jump";
import { MenuPreferencesProvider, useMenuPreferences } from "@/components/menu/menu-preferences-provider";
import { MenuSections } from "@/components/menu/menu-sections";
import { BrandMark } from "@/components/shared/brand-mark";
import { Button } from "@/components/ui/button";
import { buildCustomerMenuSections } from "@/lib/adapters/customer-menu-sections";
import { adminMenuToViewModel } from "@/lib/adapters/menu-view-model";
import type { CustomerMenuPayload } from "@/lib/api/endpoints";
import { adminApi } from "@/lib/api/endpoints";
import type {
  AdminCategoryResult,
  AdminProductResult,
} from "@/lib/services/admin-menu-service";
import { cn } from "@/lib/utils";
import type { Product } from "@/types";

/**
 * The guest's menu, and the place it is edited — the same screen.
 *
 * The old shape was an admin table on the left and a phone-sized picture of the
 * menu on the right, which meant a restaurant manager read their menu at one
 * size and changed it somewhere else entirely. This is the menu itself, at the
 * full width of the admin panel, with the guest's own components: touch what
 * looks wrong and a panel opens for exactly that thing.
 *
 * Editing is decoration on top of {@link MenuSections}, never a second copy of
 * it, so a change to how a dish is drawn changes both at once and neither can
 * drift. Nothing on this canvas can order, call a waiter, ask for a bill or
 * open a table session: it edits content and nothing else.
 */

/**
 * The editor's own settings. Ordering is off because there is no session to
 * order into; images follow the restaurant's real setting so the canvas shows
 * what a guest would see.
 */
function editorSettings(menuImagesEnabled: boolean): CustomerMenuPayload["settings"] {
  return {
    menuEnabled: true,
    orderingEnabled: false,
    customerNotesEnabled: false,
    menuImagesEnabled,
    serviceFeeRate: "0.00",
    taxRate: "0.00",
    maxItemQuantity: 20,
    orderNotesMaxLength: 500,
  };
}

export type MenuEditorFocus = "all" | "categories" | "products";

function EditIcon({ label, onClick }: { readonly label: string; readonly onClick: () => void }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      onClick={onClick}
      // A quiet affordance: the menu should read as a menu until it is touched.
      className="size-9 shrink-0 rounded-lg text-burgundy/70 hover:bg-burgundy/10 hover:text-burgundy"
    >
      <Pencil className="size-4" />
    </Button>
  );
}

export function CustomerMenuEditor({ focus = "all" }: { readonly focus?: MenuEditorFocus }) {
  const draft = useMenuDraft();
  const { menu } = draft;
  const [showHidden, setShowHidden] = useState(false);
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [featuredOpen, setFeaturedOpen] = useState(false);
  /** Focus returns to the card that opened the panel, not to the top. */
  const lastTrigger = useRef<HTMLElement | null>(null);

  const restaurantName = "Tarihi Şehir Lokantası";

  const rememberTrigger = useCallback(() => {
    lastTrigger.current = document.activeElement as HTMLElement | null;
  }, []);
  const restoreFocus = useCallback(() => {
    // Deferred so the dialog has finished unmounting and released the trap.
    window.setTimeout(() => lastTrigger.current?.focus(), 0);
  }, []);

  const openProductEditor = useCallback(
    (productId: string) => {
      rememberTrigger();
      setEditingProductId(productId);
    },
    [rememberTrigger],
  );

  const openCategoryEditor = useCallback(
    (categoryId: string) => {
      rememberTrigger();
      setEditingCategoryId(categoryId);
    },
    [rememberTrigger],
  );

  // The canvas: the administrator's working copy, run through exactly the
  // adapter and derivation a guest's menu uses.
  const { sections, featured, popular, emptyCategories } = useMemo(() => {
    const lens = showHidden
      ? {
          categories: draft.categories.map((category) => ({ ...category, isActive: true })),
          products: draft.products.map((product) => ({ ...product, isActive: true })),
        }
      : { categories: draft.categories, products: draft.products };

    const model = adminMenuToViewModel({
      restaurantName,
      settings: editorSettings(true),
      categories: lens.categories,
      products: lens.products,
    });
    const derived = buildCustomerMenuSections(model.categories, model.products);
    const withProducts = new Set(derived.sections.map((section) => section.category.id));
    return {
      ...derived,
      // Visible to the administrator, invisible to the guest: stated rather
      // than left as a silent gap.
      emptyCategories: model.categories.filter((category) => !withProducts.has(category.id)),
    };
  }, [draft.categories, draft.products, showHidden]);

  const productById = useCallback(
    (id: string): AdminProductResult | null => draft.products.find((item) => item.id === id) ?? null,
    [draft.products],
  );
  const categoryById = useCallback(
    (id: string): AdminCategoryResult | null =>
      draft.categories.find((item) => item.id === id) ?? null,
    [draft.categories],
  );

  const editingProduct = editingProductId ? productById(editingProductId) : null;
  const editingCategory = editingCategoryId ? categoryById(editingCategoryId) : null;

  function archiveProduct(product: AdminProductResult) {
    void menu
      .run(() => adminApi.updateProduct(product.id, { archived: true }), `${product.name} arşivlendi.`)
      .then(() => {
        setEditingProductId(null);
        restoreFocus();
      });
  }

  function archiveCategory(category: AdminCategoryResult) {
    void menu
      .run(
        () => adminApi.updateCategory(category.id, { archived: true }),
        `${category.name} kategorisi arşivlendi.`,
      )
      .then(() => {
        setEditingCategoryId(null);
        restoreFocus();
      });
  }

  async function createCategory() {
    const created = await menu.run(
      () =>
        adminApi.createCategory({
          name: "Yeni Kategori",
          isActive: false,
          sortOrder: draft.categories.length + 1,
        }),
      "Yeni kategori eklendi. Menüde görünmesi için açın.",
    );
    if (created) openCategoryEditor(created.id);
  }

  async function createProduct() {
    const category = draft.categories[0];
    if (!category) {
      toast.error("Önce bir kategori oluşturun.");
      return;
    }
    const created = await menu.run(
      () =>
        adminApi.createProduct({
          categoryId: category.id,
          name: "Yeni Ürün",
          price: "0.01",
          isActive: false,
        }),
      "Yeni ürün eklendi. Menüde görünmesi için açın.",
    );
    if (created) openProductEditor(created.id);
  }

  if (menu.error && draft.categories.length === 0) {
    return (
      <div className="grid min-h-72 place-items-center rounded-xl border bg-card p-8 text-center">
        <div>
          <UtensilsCrossed className="mx-auto size-9 text-muted-foreground" />
          <p className="mt-3 font-bold">Menü yüklenemedi</p>
          <Button variant="outline" className="mt-4" onClick={() => void menu.refetch()}>
            Tekrar Dene
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div
      // The editor's own sticky bar is a layer the public menu knows nothing
      // about, so its height is declared here and the customer chrome offsets
      // itself from a variable rather than from a number copied into two files.
      data-menu-editor="true"
      // Three sticky layers stack here — the shell's own bar, this one, then
      // the guest's header — and every offset below is derived from these two
      // variables rather than from a pixel value copied into three files.
      className="[--admin-topbar:4rem] [--menu-editor-bar:3rem]"
    >
      <div className="sticky top-[var(--admin-topbar)] z-[var(--z-appbar)] -mx-4 mb-2 flex h-[var(--menu-editor-bar)] items-center gap-2 border-b bg-card/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-card/80 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8 xl:-mx-10 xl:px-10">
        <span className="flex shrink-0 items-center gap-1.5 rounded-lg bg-burgundy/10 px-2 py-1 text-xs font-extrabold text-burgundy">
          <Pencil className="size-3.5" aria-hidden="true" />
          <span className="hidden sm:inline">Düzenleme Modu</span>
          <span className="sr-only sm:hidden">Düzenleme Modu</span>
        </span>
        {draft.dirty ? (
          <span className="hidden text-xs font-bold text-copper sm:inline">
            Kaydedilmemiş değişiklikler
          </span>
        ) : null}

        <div className="ms-auto flex items-center gap-1.5">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="min-h-11 min-w-11 px-0 text-xs text-muted-foreground sm:px-3"
            aria-label={showHidden ? "Müşteri görünümüne dön" : "Gizli öğeleri göster"}
            aria-pressed={showHidden}
            onClick={() => setShowHidden((current) => !current)}
          >
            {showHidden ? <EyeOff /> : <Eye />}
            <span className="hidden sm:inline">
              {showHidden ? "Müşteri görünümü" : "Gizlileri Göster"}
            </span>
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="min-h-11 min-w-11 bg-card px-0 sm:px-3"
            aria-label="Yeni kategori"
            onClick={() => void createCategory()}
          >
            <FolderPlus />
            <span className="hidden sm:inline">Yeni Kategori</span>
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="min-h-11 min-w-11 bg-card px-0 sm:px-3"
            aria-label="Yeni ürün"
            onClick={() => void createProduct()}
          >
            <Plus />
            <span className="hidden sm:inline">Yeni Ürün</span>
          </Button>
          {draft.dirty ? (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="min-h-11 min-w-11 bg-card px-0 sm:px-3"
                disabled={menu.saving}
                onClick={draft.discard}
                aria-label="Değişiklikleri geri al"
              >
                <Undo2 />
                <span className="hidden sm:inline">Geri Al</span>
              </Button>
              <Button
                type="button"
                size="sm"
                className="min-h-11 min-w-11 px-0 sm:px-3"
                disabled={menu.saving}
                aria-busy={menu.saving}
                aria-label="Değişiklikleri kaydet"
                onClick={() => void draft.save()}
              >
                <Save />
                <span className="hidden sm:inline">Değişiklikleri Kaydet</span>
              </Button>
            </>
          ) : null}
        </div>
      </div>

      {/*
        From here down it is the guest's menu: the same provider, the same
        header shape, the same category bar, the same cards.
      */}
      <MenuPreferencesProvider>
        <div className="menu-surface -mx-4 overflow-x-clip rounded-none bg-surface sm:-mx-6 lg:mx-0 lg:rounded-2xl lg:border">
          <EditorHeader restaurantName={restaurantName} />

          <div className="menu-shell pb-10">
            <CategoryJump
              sections={sections}
              stickyTopClass="top-[calc(var(--admin-topbar)+var(--menu-editor-bar)+var(--menu-header-height))]"
              renderItemActions={(category, index, total) => (
                <span className="flex shrink-0 items-center gap-0.5">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="size-11 rounded-lg"
                    aria-label={`${category.name} yukarı taşı`}
                    disabled={index === 0}
                    onClick={(event) => {
                      event.stopPropagation();
                      draft.moveCategory(category.id, -1);
                    }}
                  >
                    <ArrowUp className="size-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="size-11 rounded-lg"
                    aria-label={`${category.name} aşağı taşı`}
                    disabled={index === total - 1}
                    onClick={(event) => {
                      event.stopPropagation();
                      draft.moveCategory(category.id, 1);
                    }}
                  >
                    <ArrowDown className="size-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="size-11 rounded-lg text-burgundy/70"
                    aria-label={`${category.name} kategorisini düzenle`}
                    onClick={(event) => {
                      event.stopPropagation();
                      openCategoryEditor(category.id);
                    }}
                  >
                    <Pencil className="size-4" />
                  </Button>
                </span>
              )}
            />

            <div className="pt-4">
              <MenuSections
                sections={sections}
                featured={featured}
                popular={popular}
                canOrder={false}
                onOpenProduct={(product) => openProductEditor(product.id)}
                onAddProduct={(product) => openProductEditor(product.id)}
                emptyCategories={emptyCategories}
                renderFeaturedAction={() => (
                  <EditIcon
                    label="Şefin Önerilerini düzenle"
                    onClick={() => {
                      rememberTrigger();
                      setFeaturedOpen(true);
                    }}
                  />
                )}
                renderCategoryAction={(category) => (
                  <span className="flex items-center gap-1">
                    <EditIcon
                      label={`${category.name} kategorisini düzenle`}
                      onClick={() => openCategoryEditor(category.id)}
                    />
                    {draft.editedCategoryIds.has(category.id) ? (
                      <span className="rounded-md bg-copper/15 px-1.5 py-0.5 text-[11px] font-bold text-copper">
                        Düzenlendi
                      </span>
                    ) : null}
                  </span>
                )}
                renderProductAction={(product, index, total) => (
                  <ProductOverlay
                    product={product}
                    index={index}
                    total={total}
                    edited={draft.editedProductIds.has(product.id)}
                    hidden={!productById(product.id)?.isActive}
                    reorderable={focus !== "categories"}
                    onEdit={() => openProductEditor(product.id)}
                    onMove={(direction) => draft.moveProduct(product.id, direction)}
                  />
                )}
                emptyState={
                  <div className="grid min-h-64 place-items-center px-6 py-12 text-center">
                    <div>
                      <UtensilsCrossed className="mx-auto size-8 text-muted-foreground" />
                      <p className="mt-3 text-sm font-bold">Menüde gösterilecek ürün yok</p>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">
                        Bir kategoriyi görünür yapın veya kategoriye ürün ekleyin.
                      </p>
                    </div>
                  </div>
                }
              />
            </div>
          </div>
        </div>
      </MenuPreferencesProvider>

      {editingProduct ? (
        <ProductEditDialog
          key={editingProduct.id}
          product={editingProduct}
          categories={draft.categories}
          featuredCount={draft.featuredCount}
          saving={menu.saving}
          onOpenChange={(open) => {
            if (open) return;
            setEditingProductId(null);
            restoreFocus();
          }}
          onStage={(change) => draft.stageProduct(editingProduct.id, change)}
          onArchived={() => archiveProduct(editingProduct)}
        />
      ) : null}

      {editingCategory ? (
        <CategoryEditDialog
          key={editingCategory.id}
          category={editingCategory}
          productCount={draft.products.filter((item) => item.categoryId === editingCategory.id).length}
          saving={menu.saving}
          onOpenChange={(open) => {
            if (open) return;
            setEditingCategoryId(null);
            restoreFocus();
          }}
          onStage={(change) => draft.stageCategory(editingCategory.id, change)}
          onArchived={() => archiveCategory(editingCategory)}
        />
      ) : null}

      {featuredOpen ? (
        <FeaturedEditDialog
          products={draft.products}
          categories={draft.categories}
          onOpenChange={(open) => {
            if (open) return;
            setFeaturedOpen(false);
            restoreFocus();
          }}
          onStage={draft.stageProduct}
        />
      ) : null}
    </div>
  );
}

/**
 * The header, in the guest's shape but honest about where it is.
 *
 * A real menu names the guest's table. This one has no table and refuses to
 * invent one — an administrator seeing "Masa --" would rightly read it as a
 * bug — so the second line says what the screen actually is.
 */
function EditorHeader({ restaurantName }: { readonly restaurantName: string }) {
  const { t } = useMenuPreferences();
  return (
    <header className="sticky top-[calc(var(--admin-topbar)+var(--menu-editor-bar))] z-[var(--z-appbar)] border-b border-gold/30 bg-sidebar px-[var(--menu-gutter)] text-[#FBF7EF] lg:rounded-t-2xl">
      <div className="mx-auto flex h-[var(--menu-header-height)] max-w-5xl items-center gap-3">
        <BrandMark compact className="size-9 shrink-0 sm:size-10" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-heading text-sm font-semibold leading-tight sm:text-base">
            {restaurantName}
          </p>
          <p className="mt-0.5 flex items-center gap-1.5 text-xs text-[#F5EBDD]/60">
            <span className="truncate font-semibold text-[#F5EBDD]/85">Menü Düzenleme</span>
            <span aria-hidden="true" className="text-[#F5EBDD]/25">
              ·
            </span>
            <span className="flex shrink-0 items-center gap-1 text-status-success-tint/80">
              <span className="size-1.5 rounded-full bg-order-ready-tint" aria-hidden="true" />
              {t("serviceOpen")}
            </span>
          </p>
        </div>
      </div>
    </header>
  );
}

/**
 * The controls layered over one dish.
 *
 * They live on the card's own hover group and are always reachable by keyboard,
 * so a pointer gets a quiet affordance and a screen reader gets a real button.
 */
function ProductOverlay({
  product,
  index,
  total,
  edited,
  hidden,
  reorderable,
  onEdit,
  onMove,
}: {
  readonly product: Product;
  readonly index: number;
  readonly total: number;
  readonly edited: boolean;
  readonly hidden: boolean;
  readonly reorderable: boolean;
  readonly onEdit: () => void;
  readonly onMove: (direction: -1 | 1) => void;
}) {
  return (
    <>
      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute inset-0 rounded-xl ring-1 ring-transparent transition-colors duration-[var(--motion-quick)]",
          "group-hover/edit:ring-burgundy/25 group-focus-within/edit:ring-burgundy/40",
          edited && "ring-copper/45",
        )}
      />
      {hidden ? (
        <span className="pointer-events-none absolute start-2 top-2 rounded-md bg-foreground/75 px-1.5 py-0.5 text-[11px] font-bold text-background">
          Gizli
        </span>
      ) : null}
      <span className="absolute end-1.5 top-1.5 flex items-center gap-0.5 opacity-0 transition-opacity duration-[var(--motion-quick)] group-hover/edit:opacity-100 group-focus-within/edit:opacity-100 [@media(hover:none)]:opacity-100">
        {reorderable ? (
          <>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="size-11 rounded-lg bg-card/90 text-foreground/70 shadow-sm"
              aria-label={`${product.name} yukarı taşı`}
              disabled={index === 0}
              onClick={onMove.bind(null, -1)}
            >
              <ArrowUp className="size-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="size-11 rounded-lg bg-card/90 text-foreground/70 shadow-sm"
              aria-label={`${product.name} aşağı taşı`}
              disabled={index === total - 1}
              onClick={onMove.bind(null, 1)}
            >
              <ArrowDown className="size-4" />
            </Button>
          </>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="size-11 rounded-lg bg-card/90 text-burgundy shadow-sm"
          aria-label={`${product.name} ürününü düzenle`}
          onClick={onEdit}
        >
          <Pencil className="size-4" />
        </Button>
      </span>
    </>
  );
}
